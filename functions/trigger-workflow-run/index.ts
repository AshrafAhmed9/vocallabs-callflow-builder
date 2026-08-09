// Hasura Action handler for `triggerWorkflowRun(workflow_id: uuid!)`.
// Requires a logged-in session (Authorization header forwarded by Hasura;
// session_variables include x-hasura-user-id).
import { adminRequest } from "../_lib/admin-client";
import { getSessionUserId, requireRole } from "../_lib/auth";
import { hasQuotaAvailable } from "../_lib/quota";
import { executeRun } from "../_lib/executor";

const GET_WORKFLOW = /* GraphQL */ `
  query GetWorkflow($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      org_id
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

const INSERT_RUN = /* GraphQL */ `
  mutation InsertRun($workflowId: uuid!, $orgId: uuid!, $triggeredBy: uuid, $triggerType: String!) {
    insert_workflow_runs_one(
      object: {
        workflow_id: $workflowId
        org_id: $orgId
        triggered_by: $triggeredBy
        trigger_type: $triggerType
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

function sendJson(res: any, status: number, body: any) {
  res.status(status).json(body);
}

export default async function handler(req: any, res: any) {
  try {
    const input = req.body?.input ?? {};
    const workflowId = input.workflow_id;
    const userId = getSessionUserId(req.body);

    if (!workflowId || !userId) {
      return sendJson(res, 400, { message: "workflow_id and an authenticated session are required" });
    }

    const wfData = await adminRequest<{ workflows_by_pk: { id: string; org_id: string } | null }>(
      GET_WORKFLOW,
      { id: workflowId }
    );
    const workflow = wfData.workflows_by_pk;
    if (!workflow) {
      return sendJson(res, 404, { message: "Workflow not found" });
    }

    // Re-affirm org membership + role at the mutation boundary — Actions
    // bypass Hasura's declarative row permissions entirely.
    await requireRole(workflow.org_id, userId, ["owner", "editor"]);

    const quotaOk = await hasQuotaAvailable(workflow.org_id);
    if (!quotaOk) {
      return sendJson(res, 400, { message: "Org quota exhausted for this billing period" });
    }

    const runData = await adminRequest<{ insert_workflow_runs_one: { id: string } }>(INSERT_RUN, {
      workflowId,
      orgId: workflow.org_id,
      triggeredBy: userId,
      triggerType: "manual",
    });
    const runId = runData.insert_workflow_runs_one.id;

    const stepsData = await adminRequest<{ workflow_steps: { id: string }[] }>(GET_STEPS, {
      workflowId,
    });
    const objects = stepsData.workflow_steps.map((s) => ({
      workflow_run_id: runId,
      step_id: s.id,
      org_id: workflow.org_id,
      status: "pending",
    }));
    if (objects.length > 0) {
      await adminRequest(INSERT_STEP_RUNS, { objects });
    }

    const result = await executeRun(runId);

    return sendJson(res, 200, { run_id: runId, status: result.status });
  } catch (err: any) {
    console.error("[trigger-workflow-run] error:", err);
    return sendJson(res, err.statusCode ?? 500, { message: err.message ?? "Internal error" });
  }
}
