// Adversarial cross-org isolation checks against the seeded demo data.
// Run: tsx scripts/verify-security.ts
//
// Prints a markdown PASS/FAIL table to stdout.
import { GraphQLClient, gql } from "graphql-request";
import { ADMIN_SECRET, graphqlUrl } from "../lib/env";
import { signIn, Session } from "../lib/session";

interface Row {
  n: number;
  label: string;
  pass: boolean;
  detail?: string;
}
const rows: Row[] = [];
let n = 0;

function record(label: string, pass: boolean, detail?: string) {
  n++;
  rows.push({ n, label, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${n}. ${label}${detail ? " — " + detail : ""}`);
}

const admin = new GraphQLClient(graphqlUrl(), {
  headers: { "x-hasura-admin-secret": ADMIN_SECRET },
});

function withRole(session: Session, role: string): GraphQLClient {
  return new GraphQLClient(graphqlUrl(), {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-hasura-role": role,
    },
  });
}

function isGraphQLError(err: any): boolean {
  return Boolean(err?.response?.errors?.length);
}

async function getWorkflow(name: string): Promise<{ id: string; org_id: string }> {
  const data: any = await admin.request(
    gql`
      query ($name: String!) {
        workflows(where: { name: { _eq: $name } }, limit: 1) {
          id
          org_id
        }
      }
    `,
    { name }
  );
  const wf = data.workflows[0];
  if (!wf) throw new Error(`Seed workflow "${name}" not found — run seeds/seed.ts first`);
  return wf;
}

async function getOrgId(name: string): Promise<string> {
  const data: any = await admin.request(
    gql`
      query ($name: String!) {
        organizations(where: { name: { _eq: $name } }, limit: 1) {
          id
        }
      }
    `,
    { name }
  );
  return data.organizations[0].id;
}

async function main() {
  const aOwner = await signIn("a-owner@vocallabs.demo");
  const aEditor = await signIn("a-editor@vocallabs.demo");
  const aViewer = await signIn("a-viewer@vocallabs.demo");
  const bOwner = await signIn("b-owner@vocallabs.demo");

  const workflow = await getWorkflow("Inbound Lead Qualification");
  const orgAId = workflow.org_id;
  const orgBId = await getOrgId("Org B — Northwind Telco");

  // 1. b-owner attempts to read Org A's workflow by ID directly.
  {
    const data: any = await bOwner.client.request(
      gql`
        query ($id: uuid!) {
          workflows_by_pk(id: $id) {
            id
          }
        }
      `,
      { id: workflow.id }
    );
    record("b-owner cannot read Org A's workflow by ID", data.workflows_by_pk === null, JSON.stringify(data));
  }

  // 2. b-owner attempts to trigger Org A's workflow run via the Action.
  {
    let blocked = false;
    let detail = "";
    try {
      await bOwner.client.request(
        gql`
          mutation ($id: uuid!) {
            triggerWorkflowRun(workflow_id: $id) {
              run_id
            }
          }
        `,
        { id: workflow.id }
      );
    } catch (err: any) {
      blocked = true;
      detail = err?.response?.errors?.[0]?.message ?? String(err);
    }
    record("b-owner cannot trigger a run on Org A's workflow", blocked, detail);
  }

  // 3. b-owner attempts to approve an Org A step_run by ID (find one first via admin).
  {
    const srData: any = await admin.request(
      gql`
        query ($workflowId: uuid!) {
          workflow_steps(where: { workflow_id: { _eq: $workflowId }, type: { _eq: "approval_gate" } }, limit: 1) {
            id
          }
        }
      `,
      { workflowId: workflow.id }
    );
    const stepId = srData.workflow_steps[0]?.id;
    // Create a synthetic step_run to attempt approval against, if none exists yet.
    let stepRunId: string;
    if (stepId) {
      const runData: any = await admin.request(
        gql`
          mutation ($workflowId: uuid!, $orgId: uuid!) {
            insert_workflow_runs_one(object: { workflow_id: $workflowId, org_id: $orgId, status: "paused", trigger_type: "manual" }) {
              id
            }
          }
        `,
        { workflowId: workflow.id, orgId: orgAId }
      );
      const srInsert: any = await admin.request(
        gql`
          mutation ($runId: uuid!, $stepId: uuid!, $orgId: uuid!) {
            insert_step_runs_one(
              object: { workflow_run_id: $runId, step_id: $stepId, org_id: $orgId, status: "awaiting_approval" }
            ) {
              id
            }
          }
        `,
        { runId: runData.insert_workflow_runs_one.id, stepId, orgId: orgAId }
      );
      stepRunId = srInsert.insert_step_runs_one.id;
    } else {
      stepRunId = "00000000-0000-0000-0000-000000000000";
    }

    let blocked = false;
    let detail = "";
    try {
      await bOwner.client.request(
        gql`
          mutation ($id: uuid!) {
            approveStep(step_run_id: $id) {
              status
            }
          }
        `,
        { id: stepRunId }
      );
    } catch (err: any) {
      blocked = true;
      detail = err?.response?.errors?.[0]?.message ?? String(err);
    }
    record("b-owner cannot approve an Org A step_run by ID", blocked, detail);
  }

  // 4. Role-header elevation: b-owner claims role=owner while reading Org A data.
  {
    const elevated = withRole(bOwner, "owner");
    const data: any = await elevated.request(
      gql`
        query ($id: uuid!) {
          workflows_by_pk(id: $id) {
            id
          }
        }
      `,
      { id: workflow.id }
    );
    record(
      "Claiming X-Hasura-Role: owner does not leak Org A data to b-owner (row filter re-derives from org_members)",
      data.workflows_by_pk === null,
      JSON.stringify(data)
    );
  }

  // 5. Org A viewer attempts to trigger a run.
  {
    let blocked = false;
    let detail = "";
    try {
      await aViewer.client.request(
        gql`
          mutation ($id: uuid!) {
            triggerWorkflowRun(workflow_id: $id) {
              run_id
            }
          }
        `,
        { id: workflow.id }
      );
    } catch (err: any) {
      blocked = true;
      detail = err?.response?.errors?.[0]?.message ?? String(err);
    }
    record("Org A viewer cannot trigger a workflow run", blocked, detail);
  }

  // 6. Org A editor attempts to create a db_write step (Hasura declarative permission should reject).
  {
    let blocked = false;
    let detail = "";
    try {
      await aEditor.client.request(
        gql`
          mutation ($workflowId: uuid!) {
            insert_workflow_steps_one(
              object: { workflow_id: $workflowId, position: 99, type: "db_write", name: "sneaky", config: {} }
            ) {
              id
            }
          }
        `,
        { workflowId: workflow.id }
      );
    } catch (err: any) {
      blocked = isGraphQLError(err);
      detail = err?.response?.errors?.[0]?.message ?? String(err);
    }
    record("Org A editor cannot insert a db_write step (Hasura permission)", blocked, detail);
  }

  // 7. Org A editor attempts to create a webhook trigger (Hasura declarative permission should reject).
  {
    let blocked = false;
    let detail = "";
    try {
      await aEditor.client.request(
        gql`
          mutation ($workflowId: uuid!) {
            insert_workflow_triggers_one(object: { workflow_id: $workflowId, type: "webhook", config: {} }) {
              id
            }
          }
        `,
        { workflowId: workflow.id }
      );
    } catch (err: any) {
      blocked = isGraphQLError(err);
      detail = err?.response?.errors?.[0]?.message ?? String(err);
    }
    record("Org A editor cannot insert a webhook trigger (Hasura permission)", blocked, detail);
  }

  // 8. DB-trigger defense in depth: simulate a would-be bypass of Hasura's
  // declarative permission (e.g. a future bug) by using the admin secret
  // together with an explicit x-hasura-role: editor header, which still
  // sets the Postgres session var enforce_step_gating() reads. This must
  // still be rejected, at the database level.
  {
    const adminAsEditor = new GraphQLClient(graphqlUrl(), {
      headers: {
        "x-hasura-admin-secret": ADMIN_SECRET,
        "x-hasura-role": "editor",
        "x-hasura-user-id": aEditor.userId,
      },
    });
    let blocked = false;
    let detail = "";
    try {
      await adminAsEditor.request(
        gql`
          mutation ($workflowId: uuid!) {
            insert_workflow_steps_one(
              object: { workflow_id: $workflowId, position: 98, type: "db_write", name: "bypass-attempt", config: {} }
            ) {
              id
            }
          }
        `,
        { workflowId: workflow.id }
      );
    } catch (err: any) {
      blocked = true;
      detail = err?.response?.errors?.[0]?.message ?? String(err);
    }
    record(
      "DB trigger enforce_step_gating() rejects a db_write step even with role=editor set directly (defense in depth)",
      blocked,
      detail
    );
  }

  // 9. Concurrent quota consumption: only one of two concurrent triggers should
  // actually consume the last unit of quota.
  {
    const orgData: any = await admin.request(
      gql`
        query ($id: uuid!) {
          organizations_by_pk(id: $id) {
            quota_limit
            quota_used
          }
        }
      `,
      { id: orgAId }
    );
    const before = orgData.organizations_by_pk;
    await admin.request(
      gql`
        mutation ($id: uuid!, $used: Int!) {
          update_organizations_by_pk(pk_columns: { id: $id }, _set: { quota_used: $used }) {
            id
          }
        }
      `,
      { id: orgAId, used: before.quota_limit - 1 }
    );

    const results = await Promise.allSettled([
      aOwner.client.request(
        gql`
          mutation ($id: uuid!) {
            triggerWorkflowRun(workflow_id: $id) {
              run_id
              status
            }
          }
        `,
        { id: workflow.id }
      ),
      aOwner.client.request(
        gql`
          mutation ($id: uuid!) {
            triggerWorkflowRun(workflow_id: $id) {
              run_id
              status
            }
          }
        `,
        { id: workflow.id }
      ),
    ]);

    const afterData: any = await admin.request(
      gql`
        query ($id: uuid!) {
          organizations_by_pk(id: $id) {
            quota_used
          }
        }
      `,
      { id: orgAId }
    );
    const diff = afterData.organizations_by_pk.quota_used - (before.quota_limit - 1);

    // Restore quota so re-runs of this script and verify.ts are not blocked.
    await admin.request(
      gql`
        mutation ($id: uuid!, $used: Int!) {
          update_organizations_by_pk(pk_columns: { id: $id }, _set: { quota_used: $used }) {
            id
          }
        }
      `,
      { id: orgAId, used: before.quota_used }
    );

    record(
      "Concurrent triggers with 1 unit of quota left: exactly one unit consumed (consume_org_quota is atomic)",
      diff === 1,
      `quota_used delta was ${diff} (results: ${results.map((r) => r.status).join(", ")})`
    );
  }

  // 10. Webhook replay: identical payload should return the first run, not create a new one.
  {
    const triggerData: any = await admin.request(
      gql`
        query ($workflowId: uuid!) {
          workflow_triggers(where: { workflow_id: { _eq: $workflowId }, type: { _eq: "webhook" } }, limit: 1) {
            webhook_token
          }
        }
      `,
      { workflowId: workflow.id }
    );
    const token = triggerData.workflow_triggers[0]?.webhook_token;
    if (!token) {
      record("Webhook replay returns the same run_id (idempotent)", false, "no webhook trigger found for seed workflow");
    } else {
      const publicClient = new GraphQLClient(graphqlUrl(), {});
      const payload = { idempotency_key: "verify-security-replay-test" };
      const first: any = await publicClient.request(
        gql`
          mutation ($id: uuid!, $token: uuid!, $payload: json) {
            webhookTriggerRun(workflow_id: $id, token: $token, payload: $payload) {
              run_id
              status
            }
          }
        `,
        { id: workflow.id, token, payload }
      );
      const second: any = await publicClient.request(
        gql`
          mutation ($id: uuid!, $token: uuid!, $payload: json) {
            webhookTriggerRun(workflow_id: $id, token: $token, payload: $payload) {
              run_id
              status
            }
          }
        `,
        { id: workflow.id, token, payload }
      );
      record(
        "Webhook replay with identical payload returns the first call's run_id, not a new run",
        first.webhookTriggerRun.run_id === second.webhookTriggerRun.run_id,
        `first=${first.webhookTriggerRun.run_id} second=${second.webhookTriggerRun.run_id}`
      );
    }
  }

  printTable();
}

function printTable() {
  console.log("\n## Security verification results\n");
  console.log("| # | Check | Result |");
  console.log("|---|-------|--------|");
  for (const r of rows) {
    console.log(`| ${r.n} | ${r.label} | ${r.pass ? "PASS" : "FAIL"} |`);
  }
  const passCount = rows.filter((r) => r.pass).length;
  console.log(`\n${passCount}/${rows.length} checks passed.`);
  if (passCount !== rows.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("verify-security.ts crashed:", err);
  process.exit(1);
});
