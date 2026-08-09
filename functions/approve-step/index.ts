// Hasura Action handler for `approveStep(step_run_id: uuid!)`.
import { adminRequest } from "../_lib/admin-client";
import { getSessionUserId, requireRole } from "../_lib/auth";
import { executeRun } from "../_lib/executor";

const GET_STEP_RUN = /* GraphQL */ `
  query GetStepRun($id: uuid!) {
    step_runs_by_pk(id: $id) {
      id
      status
      workflow_run_id
      org_id
      run {
        id
        status
      }
    }
  }
`;

const APPROVE_STEP_RUN = /* GraphQL */ `
  mutation ApproveStepRun($id: uuid!, $approvedBy: uuid!, $now: timestamptz!) {
    update_step_runs_by_pk(
      pk_columns: { id: $id }
      _set: { status: "completed", approved_by: $approvedBy, approved_at: $now, finished_at: $now }
    ) {
      id
      status
    }
  }
`;

const RESUME_RUN = /* GraphQL */ `
  mutation ResumeRun($id: uuid!) {
    update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: "running" }) {
      id
    }
  }
`;

function sendJson(res: any, status: number, body: any) {
  res.status(status).json(body);
}

export default async function handler(req: any, res: any) {
  try {
    const input = req.body?.input ?? {};
    const stepRunId = input.step_run_id;
    const userId = getSessionUserId(req.body);

    if (!stepRunId || !userId) {
      return sendJson(res, 400, { message: "step_run_id and an authenticated session are required" });
    }

    const data = await adminRequest<{
      step_runs_by_pk: {
        id: string;
        status: string;
        workflow_run_id: string;
        org_id: string;
        run: { id: string; status: string };
      } | null;
    }>(GET_STEP_RUN, { id: stepRunId });

    const stepRun = data.step_runs_by_pk;
    if (!stepRun) {
      return sendJson(res, 404, { message: "step_run not found" });
    }

    // This check MUST happen here in code — it is not merely assumed from a
    // database permission, since this handler runs with the admin secret.
    await requireRole(stepRun.org_id, userId, ["owner", "editor"]);

    if (stepRun.status !== "awaiting_approval") {
      return sendJson(res, 400, {
        message: `step_run ${stepRunId} is not awaiting approval (status: ${stepRun.status})`,
      });
    }

    const now = new Date().toISOString();
    await adminRequest(APPROVE_STEP_RUN, { id: stepRunId, approvedBy: userId, now });
    await adminRequest(RESUME_RUN, { id: stepRun.workflow_run_id });

    const result = await executeRun(stepRun.workflow_run_id);

    return sendJson(res, 200, {
      step_run_id: stepRunId,
      status: "completed",
      run_status: result.status,
    });
  } catch (err: any) {
    console.error("[approve-step] error:", err);
    return sendJson(res, err.statusCode ?? 500, { message: err.message ?? "Internal error" });
  }
}
