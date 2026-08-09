// Hasura Cron Trigger handler, runs every 5 minutes.
// Deliberately simple: find enabled 'scheduled' triggers whose
// config.interval_minutes has elapsed since the workflow's last run, and
// start a run for each one due. Not a full cron engine — just enough to
// prove the mechanism works for the demo.
import { adminRequest } from "../_lib/admin-client";
import { hasQuotaAvailable } from "../_lib/quota";
import { executeRun } from "../_lib/executor";

const GET_SCHEDULED_TRIGGERS = /* GraphQL */ `
  query GetScheduledTriggers {
    workflow_triggers(where: { type: { _eq: "scheduled" }, enabled: { _eq: true } }) {
      id
      workflow_id
      config
      workflow {
        org_id
        runs(order_by: { started_at: desc }, limit: 1) {
          started_at
        }
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

const INSERT_RUN = /* GraphQL */ `
  mutation InsertRun($workflowId: uuid!, $orgId: uuid!) {
    insert_workflow_runs_one(
      object: {
        workflow_id: $workflowId
        org_id: $orgId
        trigger_type: "scheduled"
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

function isDue(lastStartedAt: string | null, intervalMinutes: number): boolean {
  if (!lastStartedAt) return true;
  const last = new Date(lastStartedAt).getTime();
  const dueAt = last + intervalMinutes * 60_000;
  return Date.now() >= dueAt;
}

export default async function handler(req: any, res: any) {
  try {
    const data = await adminRequest<{
      workflow_triggers: {
        id: string;
        workflow_id: string;
        config: any;
        workflow: { org_id: string; runs: { started_at: string }[] };
      }[];
    }>(GET_SCHEDULED_TRIGGERS);

    const started: string[] = [];

    for (const trigger of data.workflow_triggers) {
      const intervalMinutes = trigger.config?.interval_minutes;
      if (!intervalMinutes || typeof intervalMinutes !== "number") continue;

      const lastRun = trigger.workflow.runs[0]?.started_at ?? null;
      if (!isDue(lastRun, intervalMinutes)) continue;

      const orgId = trigger.workflow.org_id;
      const workflowId = trigger.workflow_id;

      const quotaOk = await hasQuotaAvailable(orgId);
      if (!quotaOk) {
        console.warn(`[cron-tick] quota exhausted for org ${orgId}, skipping scheduled trigger ${trigger.id}`);
        continue;
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

      await executeRun(runId);
      started.push(runId);
    }

    return res.status(200).json({ ok: true, started_runs: started });
  } catch (err: any) {
    console.error("[cron-tick] error:", err);
    return res.status(500).json({ message: err.message ?? "Internal error" });
  }
}
