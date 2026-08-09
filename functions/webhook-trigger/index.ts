// Hasura Action handler for `webhookTriggerRun(workflow_id, token, payload)`.
// Role: public. There is no user session — the `token` param matched
// against workflow_triggers.webhook_token IS the authentication mechanism.
import * as crypto from "node:crypto";
import { adminRequest } from "../_lib/admin-client";
import { hasQuotaAvailable } from "../_lib/quota";
import { executeRun } from "../_lib/executor";

const GET_TRIGGER = /* GraphQL */ `
  query GetTrigger($workflowId: uuid!, $token: uuid!) {
    workflow_triggers(
      where: {
        workflow_id: { _eq: $workflowId }
        type: { _eq: "webhook" }
        webhook_token: { _eq: $token }
        enabled: { _eq: true }
      }
      limit: 1
    ) {
      id
      workflow_id
      workflow {
        org_id
      }
    }
  }
`;

const GET_STEPS = /* GraphQL */ `
  query GetSteps($workflowId: uuid!) {
    workflow_steps(where: { workflow_id: { _eq: $workflowId } }, order_by: { position: asc }) {
      id
    }
  }
`;

const FIND_RUN_BY_DEDUPE = /* GraphQL */ `
  query FindRunByDedupe($workflowId: uuid!, $dedupeKey: String!) {
    workflow_runs(where: { workflow_id: { _eq: $workflowId }, dedupe_key: { _eq: $dedupeKey } }, limit: 1) {
      id
      status
    }
  }
`;

const INSERT_RUN = /* GraphQL */ `
  mutation InsertRun($workflowId: uuid!, $orgId: uuid!, $triggerType: String!, $dedupeKey: String) {
    insert_workflow_runs_one(
      object: {
        workflow_id: $workflowId
        org_id: $orgId
        trigger_type: $triggerType
        status: "pending"
        dedupe_key: $dedupeKey
      }
    ) {
      id
    }
  }
`;

const INSERT_STEP_RUNS = /* GraphQL */ `
  mutation InsertStepRuns($objects: [step_runs_insert_input!]!) {
    insert_step_runs(objects: $objects) {
      affected_rows
    }
  }
`;

function sendJson(res: any, status: number, body: any) {
  res.status(status).json(body);
}

function hashPayload(payload: unknown): string {
  const str = JSON.stringify(payload ?? {});
  return crypto.createHash("sha256").update(str).digest("hex");
}

export default async function handler(req: any, res: any) {
  try {
    const input = req.body?.input ?? {};
    const workflowId = input.workflow_id;
    const token = input.token;
    const payload = input.payload ?? {};

    if (!workflowId || !token) {
      return sendJson(res, 400, { message: "workflow_id and token are required" });
    }

    const triggerData = await adminRequest<{
      workflow_triggers: { id: string; workflow_id: string; workflow: { org_id: string } }[];
    }>(GET_TRIGGER, { workflowId, token });

    const trigger = triggerData.workflow_triggers[0];
    if (!trigger) {
      return sendJson(res, 404, { message: "No matching enabled webhook trigger for this workflow_id/token" });
    }

    const orgId = trigger.workflow.org_id;

    // Idempotency key: prefer an explicit payload.idempotency_key, else hash
    // the payload. The DB's unique (workflow_id, dedupe_key) index is the
    // real source of truth; we check first for a fast, friendly response,
    // then also handle the constraint violation race below.
    const dedupeKey: string = payload?.idempotency_key
      ? String(payload.idempotency_key)
      : hashPayload(payload);

    const existing = await adminRequest<{ workflow_runs: { id: string; status: string }[] }>(
      FIND_RUN_BY_DEDUPE,
      { workflowId, dedupeKey }
    );
    if (existing.workflow_runs[0]) {
      const run = existing.workflow_runs[0];
      return sendJson(res, 200, { run_id: run.id, status: run.status });
    }

    const quotaOk = await hasQuotaAvailable(orgId);
    if (!quotaOk) {
      return sendJson(res, 400, { message: "Org quota exhausted for this billing period" });
    }

    let runId: string;
    try {
      const runData = await adminRequest<{ insert_workflow_runs_one: { id: string } }>(INSERT_RUN, {
        workflowId,
        orgId,
        triggerType: "webhook",
        dedupeKey,
      });
      runId = runData.insert_workflow_runs_one.id;
    } catch (err: any) {
      // Unique constraint on (workflow_id, dedupe_key) — a concurrent
      // retry beat us to it. Telephony-style retries must be safe: return
      // the existing run instead of erroring.
      const msg = String(err?.message ?? "");
      if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
        const retry = await adminRequest<{ workflow_runs: { id: string; status: string }[] }>(
          FIND_RUN_BY_DEDUPE,
          { workflowId, dedupeKey }
        );
        const run = retry.workflow_runs[0];
        if (run) return sendJson(res, 200, { run_id: run.id, status: run.status });
      }
      throw err;
    }

    const stepsData = await adminRequest<{ workflow_steps: { id: string }[] }>(GET_STEPS, {
      workflowId,
    });
    const objects = stepsData.workflow_steps.map((s) => ({
      workflow_run_id: runId,
      step_id: s.id,
      org_id: orgId,
      status: "pending",
    }));
    if (objects.length > 0) {
      await adminRequest(INSERT_STEP_RUNS, { objects });
    }

    const result = await executeRun(runId);

    return sendJson(res, 200, { run_id: runId, status: result.status });
  } catch (err: any) {
    console.error("[webhook-trigger] error:", err);
    return sendJson(res, err.statusCode ?? 500, { message: err.message ?? "Internal error" });
  }
}
