// End-to-end happy-path verification against the seeded demo data.
// Run: tsx scripts/verify.ts
import { gql } from "graphql-request";
import { signIn } from "../lib/session";

let passCount = 0;
let failCount = 0;

function assertTrue(label: string, cond: boolean, extra?: any) {
  if (cond) {
    console.log(`PASS: ${label}`);
    passCount++;
  } else {
    console.log(`FAIL: ${label}${extra !== undefined ? " -- " + JSON.stringify(extra) : ""}`);
    failCount++;
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const owner = await signIn("a-owner@vocallabs.demo", undefined, "owner");

  const wfData: any = await owner.client.request(gql`
    query {
      workflows(where: { name: { _eq: "Inbound Lead Qualification" } }, limit: 1) {
        id
        org_id
      }
    }
  `);
  const workflow = wfData.workflows[0];
  assertTrue("Seeded demo workflow exists and is readable by a-owner", Boolean(workflow), wfData);
  if (!workflow) {
    printSummary();
    return;
  }

  console.log(`\nTriggering workflow run for workflow ${workflow.id} as a-owner...`);
  const triggerData: any = await owner.client.request(
    gql`
      mutation ($workflowId: uuid!) {
        triggerWorkflowRun(workflow_id: $workflowId) {
          run_id
          status
        }
      }
    `,
    { workflowId: workflow.id }
  );
  const runId = triggerData.triggerWorkflowRun.run_id;
  console.log(`  run_id=${runId} initial status=${triggerData.triggerWorkflowRun.status}`);

  // Poll until the run pauses at the approval gate (or completes/fails).
  // Execution is synchronous, so the trigger call may already return a
  // terminal/paused status — always fetch step_runs at least once.
  let runStatus = triggerData.triggerWorkflowRun.status;
  let stepRuns: any[] = [];
  for (
    let i = 0;
    i === 0 || (i < 30 && runStatus !== "paused" && runStatus !== "completed" && runStatus !== "failed");
    i++
  ) {
    if (i > 0) await sleep(500);
    const poll: any = await owner.client.request(
      gql`
        query ($runId: uuid!) {
          workflow_runs_by_pk(id: $runId) {
            status
          }
          step_runs(where: { workflow_run_id: { _eq: $runId } }, order_by: { step: { position: asc } }) {
            id
            status
            output
            step {
              position
              type
            }
          }
        }
      `,
      { runId }
    );
    runStatus = poll.workflow_runs_by_pk.status;
    stepRuns = poll.step_runs;
  }

  assertTrue("Run reached 'paused' at the approval gate", runStatus === "paused", { runStatus, stepRuns });

  const llmStep = stepRuns.find((s) => s.step.type === "llm_call");
  const branchStep = stepRuns.find((s) => s.step.type === "conditional_branch");
  const approvalStep = stepRuns.find((s) => s.step.type === "approval_gate");
  const httpStepBefore = stepRuns.find((s) => s.step.type === "http_request");

  assertTrue("llm_call step completed with an intent in its output", Boolean(llmStep?.output?.intent), llmStep);
  assertTrue(
    "conditional_branch step recorded a condition_result",
    branchStep?.output?.condition_result !== undefined,
    branchStep
  );
  assertTrue("approval_gate step is awaiting_approval", approvalStep?.status === "awaiting_approval", approvalStep);

  const hotLead = llmStep?.output?.intent === "hot_lead";
  if (hotLead) {
    assertTrue(
      "hot_lead: conditional branch did NOT skip ahead (approval gate reached, http_request not yet run)",
      branchStep?.output?.skip_to === null && httpStepBefore?.status !== "completed",
      { branchStep, httpStepBefore }
    );
  } else {
    console.log("  (llm_call classified this as cold_lead — branch should have skipped to notify; run should not have paused)");
  }

  console.log(`\nApproving step_run ${approvalStep?.id} as a-owner...`);
  const approveData: any = await owner.client.request(
    gql`
      mutation ($stepRunId: uuid!) {
        approveStep(step_run_id: $stepRunId) {
          step_run_id
          status
          run_status
        }
      }
    `,
    { stepRunId: approvalStep.id }
  );
  console.log(`  approve result: ${JSON.stringify(approveData.approveStep)}`);

  // Poll until completed/failed.
  runStatus = approveData.approveStep.run_status;
  for (let i = 0; i === 0 || (i < 30 && runStatus !== "completed" && runStatus !== "failed"); i++) {
    if (i > 0) await sleep(500);
    const poll: any = await owner.client.request(
      gql`
        query ($runId: uuid!) {
          workflow_runs_by_pk(id: $runId) {
            status
          }
          step_runs(where: { workflow_run_id: { _eq: $runId } }, order_by: { step: { position: asc } }) {
            id
            status
            output
            step {
              position
              type
            }
          }
        }
      `,
      { runId }
    );
    runStatus = poll.workflow_runs_by_pk.status;
    stepRuns = poll.step_runs;
  }

  assertTrue("Run reached 'completed' after approval", runStatus === "completed", { runStatus, stepRuns });

  const httpStep = stepRuns.find((s) => s.step.type === "http_request");
  assertTrue(
    "http_request step completed with an output.body",
    httpStep?.status === "completed" && httpStep?.output?.body !== undefined,
    httpStep
  );

  const notifyStep = stepRuns.find((s) => s.step.type === "notify");
  assertTrue("notify step completed", notifyStep?.status === "completed", notifyStep);

  printSummary();
}

function printSummary() {
  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("verify.ts crashed:", err);
  process.exit(1);
});
