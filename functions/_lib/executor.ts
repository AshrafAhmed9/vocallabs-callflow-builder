// executeRun(runId): idempotent/re-entrant workflow run executor.
//
// All step_run / workflow_run mutations go out over the admin GraphQL
// client (not a raw pg driver) so Hasura's live queries/subscriptions fire
// naturally for clients watching a run.
import { adminRequest } from "./admin-client";
import { withRetry } from "./retry";
import { consumeOrgQuota } from "./quota";
import { runLlmCall } from "./steps/llm-call";
import { runHttpRequest } from "./steps/http-request";
import { runDbWrite } from "./steps/db-write";
import { runNotify } from "./steps/notify";
import { runConditionalBranch } from "./steps/conditional-branch";
import { runApprovalGate } from "./steps/approval-gate";

const GET_RUN = /* GraphQL */ `
  query GetRun($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id
      workflow_id
      org_id
      status
    }
    step_runs(
      where: { workflow_run_id: { _eq: $runId } }
      order_by: { step: { position: asc } }
    ) {
      id
      step_id
      status
      output
      attempt
      step {
        id
        position
        type
        config
      }
    }
  }
`;

const UPDATE_RUN_STATUS = /* GraphQL */ `
  mutation UpdateRunStatus($runId: uuid!, $status: String!, $finishedAt: timestamptz) {
    update_workflow_runs_by_pk(
      pk_columns: { id: $runId }
      _set: { status: $status, finished_at: $finishedAt }
    ) {
      id
    }
  }
`;

const UPDATE_STEP_RUN = /* GraphQL */ `
  mutation UpdateStepRun(
    $id: uuid!
    $set: step_runs_set_input!
  ) {
    update_step_runs_by_pk(pk_columns: { id: $id }, _set: $set) {
      id
      status
    }
  }
`;

interface StepRunRow {
  id: string;
  step_id: string;
  status: string;
  output: any;
  attempt: number;
  step: { id: string; position: number; type: string; config: any };
}

async function setStepRun(id: string, set: Record<string, any>) {
  await adminRequest(UPDATE_STEP_RUN, { id, set });
}

async function setRunStatus(runId: string, status: string, finished = false) {
  await adminRequest(UPDATE_RUN_STATUS, {
    runId,
    status,
    finishedAt: finished ? new Date().toISOString() : null,
  });
}

async function dispatchStep(
  type: string,
  config: any,
  previousOutput: unknown,
  ctx: { orgId: string; stepRunId: string }
): Promise<{ output: any; pause?: boolean; skip_to?: number | null; tokens_used?: number | null }> {
  switch (type) {
    case "llm_call": {
      const { output, tokens_used } = await withRetry(() => runLlmCall(config, previousOutput), 2);
      return { output, tokens_used };
    }
    case "http_request": {
      const { output } = await withRetry(() => runHttpRequest(config, previousOutput), 2);
      return { output };
    }
    case "db_write":
      return runDbWrite(config, previousOutput, ctx);
    case "notify":
      return runNotify(config, previousOutput, ctx);
    case "conditional_branch":
      return runConditionalBranch(config, previousOutput);
    case "approval_gate":
      return runApprovalGate();
    default:
      throw new Error(`Unknown step type: ${type}`);
  }
}

export async function executeRun(runId: string): Promise<{ status: string }> {
  const data = await adminRequest<{
    workflow_runs_by_pk: { id: string; workflow_id: string; org_id: string; status: string } | null;
    step_runs: StepRunRow[];
  }>(GET_RUN, { runId });

  const run = data.workflow_runs_by_pk;
  if (!run) throw new Error(`workflow_run ${runId} not found`);

  // Idempotency guard: a completed/failed/paused run shouldn't be re-driven
  // by a re-entrant call (e.g. a duplicate webhook retry landing after
  // executeRun already finished). Only pending/running runs proceed.
  if (run.status === "completed" || run.status === "failed") {
    return { status: run.status };
  }

  if (run.status === "pending") {
    await setRunStatus(runId, "running");
  }

  const stepRuns = data.step_runs;
  let previousOutput: unknown = null;
  // seed previousOutput from the last completed step, in case this is a
  // resumed/re-entrant call
  for (const sr of stepRuns) {
    if (sr.status === "completed") previousOutput = sr.output;
  }

  let skipUntilPosition: number | null = null;

  for (const stepRun of stepRuns) {
    if (stepRun.status === "completed" || stepRun.status === "skipped") {
      continue;
    }

    if (skipUntilPosition !== null) {
      if (stepRun.step.position < skipUntilPosition) {
        await setStepRun(stepRun.id, { status: "skipped", finished_at: new Date().toISOString() });
        continue;
      } else {
        skipUntilPosition = null;
      }
    }

    // Anything left with status awaiting_approval must STOP here — a human
    // needs to call approveStep, which will re-invoke executeRun.
    if (stepRun.status === "awaiting_approval" || stepRun.status === "paused") {
      await setRunStatus(runId, "paused");
      return { status: "paused" };
    }

    const startedAt = Date.now();
    await setStepRun(stepRun.id, { status: "running", started_at: new Date(startedAt).toISOString() });

    try {
      const result = await dispatchStep(stepRun.step.type, stepRun.step.config, previousOutput, {
        orgId: run.org_id,
        stepRunId: stepRun.id,
      });
      const latencyMs = Date.now() - startedAt;

      if (result.pause) {
        await setStepRun(stepRun.id, {
          status: "awaiting_approval",
          output: result.output,
          latency_ms: latencyMs,
          finished_at: null,
        });
        await setRunStatus(runId, "paused");
        return { status: "paused" };
      }

      await setStepRun(stepRun.id, {
        status: "completed",
        output: result.output,
        latency_ms: latencyMs,
        tokens_used: result.tokens_used ?? null,
        finished_at: new Date().toISOString(),
      });

      previousOutput = result.output;

      if (typeof result.skip_to === "number") {
        skipUntilPosition = result.skip_to;
      }
    } catch (err: any) {
      const nextAttempt = (stepRun.attempt ?? 0) + 1;
      if (nextAttempt < 2) {
        // one retry with a small backoff
        await new Promise((r) => setTimeout(r, 300));
        await setStepRun(stepRun.id, { status: "pending", attempt: nextAttempt });
        try {
          const startedAt2 = Date.now();
          await setStepRun(stepRun.id, { status: "running", started_at: new Date(startedAt2).toISOString() });
          const result = await dispatchStep(stepRun.step.type, stepRun.step.config, previousOutput, {
            orgId: run.org_id,
            stepRunId: stepRun.id,
          });
          const latencyMs = Date.now() - startedAt2;
          await setStepRun(stepRun.id, {
            status: "completed",
            output: result.output,
            latency_ms: latencyMs,
            tokens_used: result.tokens_used ?? null,
            finished_at: new Date().toISOString(),
          });
          previousOutput = result.output;
          if (typeof result.skip_to === "number") skipUntilPosition = result.skip_to;
          continue;
        } catch (err2: any) {
          await setStepRun(stepRun.id, {
            status: "failed",
            error: String(err2?.message ?? err2),
            attempt: nextAttempt,
            finished_at: new Date().toISOString(),
          });
          await setRunStatus(runId, "failed", true);
          return { status: "failed" };
        }
      } else {
        await setStepRun(stepRun.id, {
          status: "failed",
          error: String(err?.message ?? err),
          attempt: nextAttempt,
          finished_at: new Date().toISOString(),
        });
        await setRunStatus(runId, "failed", true);
        return { status: "failed" };
      }
    }
  }

  await setRunStatus(runId, "completed", true);
  await consumeOrgQuota(run.org_id, 1);
  return { status: "completed" };
}
