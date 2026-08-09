// Seeds two orgs, four users, org_members, a demo workflow (Org A) with
// steps/triggers, and one unlinked inbound_calls row.
//
// Run: tsx seeds/seed.ts
//
// Password for all seeded users (documented here per the assignment):
const DEMO_PASSWORD = "Passw0rd!2026";

import { GraphQLClient, gql } from "graphql-request";
import { ADMIN_SECRET, authUrl, graphqlUrl } from "../lib/env";

const admin = new GraphQLClient(graphqlUrl(), {
  headers: { "x-hasura-admin-secret": ADMIN_SECRET },
});

async function signup(email: string, displayName: string): Promise<string> {
  const res = await fetch(`${authUrl()}/signup/email-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: DEMO_PASSWORD,
      options: { displayName },
    }),
  });
  const json: any = await res.json();
  if (!res.ok) {
    // If the user already exists (re-running the seed), look them up by
    // email through the admin GraphQL API instead of failing.
    if (JSON.stringify(json).toLowerCase().includes("already")) {
      const data: any = await admin.request(
        gql`
          query ($email: citext!) {
            users(where: { email: { _eq: $email } }, limit: 1) {
              id
            }
          }
        `,
        { email }
      );
      const id = data.users[0]?.id;
      if (id) {
        console.log(`  (already existed) ${email} -> ${id}`);
        return id;
      }
    }
    throw new Error(`signup failed for ${email}: ${JSON.stringify(json)}`);
  }
  const id = json?.session?.user?.id ?? json?.user?.id;
  console.log(`  created user ${email} -> ${id}`);
  return id;
}

async function main() {
  console.log(`GraphQL URL: ${graphqlUrl()}`);
  console.log(`Auth URL:    ${authUrl()}`);
  console.log(`Demo password for all seeded users: ${DEMO_PASSWORD}\n`);

  console.log("Creating users...");
  const aOwner = await signup("a-owner@vocallabs.demo", "Org A Owner");
  const aEditor = await signup("a-editor@vocallabs.demo", "Org A Editor");
  const aViewer = await signup("a-viewer@vocallabs.demo", "Org A Viewer");
  const bOwner = await signup("b-owner@vocallabs.demo", "Org B Owner");

  console.log("\nCreating organizations...");
  const orgsData: any = await admin.request(
    gql`
      mutation {
        org_a: insert_organizations_one(object: { name: "Org A — Acme BPO", quota_limit: 1000 }) {
          id
        }
        org_b: insert_organizations_one(object: { name: "Org B — Northwind Telco", quota_limit: 1000 }) {
          id
        }
      }
    `
  );
  const orgAId = orgsData.org_a.id;
  const orgBId = orgsData.org_b.id;
  console.log(`  Org A: ${orgAId}`);
  console.log(`  Org B: ${orgBId}`);

  console.log("\nCreating org_members...");
  await admin.request(
    gql`
      mutation ($objects: [org_members_insert_input!]!) {
        insert_org_members(objects: $objects) {
          affected_rows
        }
      }
    `,
    {
      objects: [
        { org_id: orgAId, user_id: aOwner, role: "owner" },
        { org_id: orgAId, user_id: aEditor, role: "editor" },
        { org_id: orgAId, user_id: aViewer, role: "viewer" },
        { org_id: orgBId, user_id: bOwner, role: "owner" },
      ],
    }
  );
  console.log("  done");

  console.log("\nCreating demo workflow in Org A...");
  const wfData: any = await admin.request(
    gql`
      mutation ($orgId: uuid!, $createdBy: uuid!) {
        insert_workflows_one(
          object: {
            org_id: $orgId
            name: "Inbound Lead Qualification"
            description: "Scores an inbound transcript, routes hot leads to a supervisor-approved CRM push."
            created_by: $createdBy
          }
        ) {
          id
        }
      }
    `,
    { orgId: orgAId, createdBy: aOwner }
  );
  const workflowId = wfData.insert_workflows_one.id;
  console.log(`  workflow: ${workflowId}`);

  const stepsData: any = await admin.request(
    gql`
      mutation ($objects: [workflow_steps_insert_input!]!) {
        insert_workflow_steps(objects: $objects) {
          returning {
            id
            position
            type
          }
        }
      }
    `,
    {
      objects: [
        {
          workflow_id: workflowId,
          position: 1,
          type: "llm_call",
          name: "Score buying intent",
          config: {
            prompt:
              'You are a sales qualification assistant. Read this call transcript and output ONLY minified JSON like {"intent":"hot_lead","reason":"..."} or {"intent":"cold_lead","reason":"..."}.\n\nTranscript: "Hi, I saw your ad for the enterprise voice AI platform and we need to roll this out to 200 agents by next quarter, budget is approved, who do I talk to about a contract?"',
          },
        },
        {
          workflow_id: workflowId,
          position: 2,
          type: "conditional_branch",
          name: "Route by intent",
          config: {
            field: "intent",
            operator: "eq",
            value: "hot_lead",
            on_true_skip_to: null,
            on_false_skip_to: 5,
          },
        },
        {
          workflow_id: workflowId,
          position: 3,
          type: "approval_gate",
          name: "Supervisor sign-off",
          config: {},
        },
        {
          workflow_id: workflowId,
          position: 4,
          type: "http_request",
          name: "Push to CRM (stand-in)",
          config: {
            url: "https://httpbin.org/post",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: { source: "vocallabs-demo", lead: "{{previous_output}}" },
          },
        },
        {
          workflow_id: workflowId,
          position: 5,
          type: "notify",
          name: "Alert the rep",
          config: {
            channel: "slack",
            message: "Lead qualification finished for workflow run — check the CRM push result.",
          },
        },
      ],
    }
  );
  console.log(`  inserted ${stepsData.insert_workflow_steps.returning.length} steps`);

  const triggersData: any = await admin.request(
    gql`
      mutation ($objects: [workflow_triggers_insert_input!]!) {
        insert_workflow_triggers(objects: $objects) {
          returning {
            id
            type
            webhook_token
          }
        }
      }
    `,
    {
      objects: [
        { workflow_id: workflowId, type: "manual", config: {}, enabled: true },
        { workflow_id: workflowId, type: "webhook", config: {}, enabled: true },
      ],
    }
  );
  const webhookTrigger = triggersData.insert_workflow_triggers.returning.find(
    (t: any) => t.type === "webhook"
  );

  console.log("\nInserting one unlinked inbound_calls row (Org A)...");
  const callData: any = await admin.request(
    gql`
      mutation ($orgId: uuid!) {
        insert_inbound_calls_one(
          object: {
            org_id: $orgId
            caller_number: "+15550123456"
            transcript: "Hi, I'm just calling to check on the status of my existing support ticket, not looking to buy anything right now."
          }
        ) {
          id
        }
      }
    `,
    { orgId: orgAId }
  );

  console.log("\n===== SEED SUMMARY =====");
  console.log(`Org A (Acme BPO):        ${orgAId}`);
  console.log(`  owner  a-owner@vocallabs.demo  -> ${aOwner}`);
  console.log(`  editor a-editor@vocallabs.demo -> ${aEditor}`);
  console.log(`  viewer a-viewer@vocallabs.demo -> ${aViewer}`);
  console.log(`Org B (Northwind Telco): ${orgBId}`);
  console.log(`  owner  b-owner@vocallabs.demo  -> ${bOwner}`);
  console.log(`Password (all users):    ${DEMO_PASSWORD}`);
  console.log(`Workflow "Inbound Lead Qualification": ${workflowId}`);
  console.log(`Webhook trigger id:      ${webhookTrigger.id}`);
  console.log(`Webhook token:           ${webhookTrigger.webhook_token}`);
  console.log(
    `Webhook call (GraphQL Action): mutation { webhookTriggerRun(workflow_id: "${workflowId}", token: "${webhookTrigger.webhook_token}", payload: {}) { run_id status } }`
  );
  console.log(`Unlinked inbound_calls row: ${callData.insert_inbound_calls_one.id}`);
  console.log("=========================\n");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
