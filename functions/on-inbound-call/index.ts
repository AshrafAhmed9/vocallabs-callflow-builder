// Hasura Event Trigger handler for inbound_calls INSERT.
// If the inserted row has a workflow_id, this is the "database event
// trigger" the assignment describes: start a run for that workflow.
//
// There is no caller to authorize against org membership for — the org_id
// comes from the inbound_calls row itself, which is trusted because it was
// inserted server-side (either by seed data or another trusted function).
// Quota is still enforced.
import { adminRequest } from "../_lib/admin-client";
import { hasQuotaAvailable } from "../_lib/quota";
import { executeRun } from "../_lib/executor";

const GET_STEPS = /* GraphQL */ `
  query GetSteps($workflowId: uuid!) {
    workflow_steps(where: { workflow_id: { _eq: $workflowId } }, order_by: { position: asc }) {
      id
    }
  }
`;

const INSERT_RUN = /* GraphQL */ `
  mutation InsertRun($workflowId: uuid!, $orgId: uuid!) {
    insert_workflow_runs_one(
      object: {
        workflow_id: $workflowId
        org_id: $orgId
        trigger_type: "database_event"
        status: "pending"
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

export default async function handler(req: any, res: any) {
  try {
    const row = req.body?.event?.data?.new;
    if (!row) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    if (!row.workflow_id) {
      // No workflow attached to this inbound call — nothing to trigger.
      return res.status(200).json({ ok: true, skipped: true });
    }

    const orgId = row.org_id;
    const workflowId = row.workflow_id;

    const quotaOk = await hasQuotaAvailable(orgId);
    if (!quotaOk) {
      console.warn(`[on-inbound-call] quota exhausted for org ${orgId}, skipping run`);
      return res.status(200).json({ ok: true, skipped: true, reason: "quota_exhausted" });
    }

    const runData = await adminRequest<{ insert_workflow_runs_one: { id: string } }>(INSERT_RUN, {
      workflowId,
      orgId,
    });
    const runId = runData.insert_workflow_runs_one.id;

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

    return res.status(200).json({ ok: true, run_id: runId, status: result.status });
  } catch (err: any) {
    console.error("[on-inbound-call] error:", err);
    return res.status(500).json({ message: err.message ?? "Internal error" });
  }
}
