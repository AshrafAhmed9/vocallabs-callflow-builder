# Recording script — Final Task scenario

Local stack must be running (`nhost up --auth-port 18081 --functions-port 18082 --hasura-port 18083`) and seeded (`npm run seed`). Frontend: `cd app && npm run dev`.

Logins (password for all: `Passw0rd!2026`):
- a-owner@vocallabs.demo — Org A owner
- a-editor@vocallabs.demo — Org A editor
- a-viewer@vocallabs.demo — Org A viewer
- b-owner@vocallabs.demo — Org B owner

## 1. Two orgs, two sets of users (0:00–0:30)

- Log in as **a-owner**. Show the org switcher — only "Org A — Acme BPO" listed, role badge "owner".
- Open the workflow list. Show "Inbound Lead Qualification" — the pre-seeded demo workflow with 5 steps and 2 triggers (manual + webhook).

## 2. Workflow with 3+ step types, including a real conditional branch (0:30–1:00)

- Open the workflow builder. Point out the step sequence:
  1. `llm_call` — "Score buying intent" (real Groq call if `GROQ_API_KEY` is set)
  2. `conditional_branch` — "Route by intent" (routes on `intent == hot_lead`)
  3. `approval_gate` — "Supervisor sign-off"
  4. `http_request` — "Push to CRM (stand-in)" (POSTs to httpbin.org)
  5. `notify` — "Alert the rep"

## 3. Manual trigger (1:00–1:20)

- Click **Run**. Navigate to the run view.
- Show the subscription-driven live timeline updating with no refresh: `llm_call` → completed (show its output, the `intent` field), `conditional_branch` → completed (show `condition_result`), `approval_gate` → **paused / awaiting_approval**.
- Point out the run's overall status badge also reads **paused**.

## 4. Approval gate + role-gated approve (1:20–1:50)

- Still as a-owner: click **Approve**. Show the run resume live — `http_request` completes (show its response body), `notify` completes, overall status → **completed**.
- Briefly note: only owner/editor can see the Approve button — log in as **a-viewer** in a second tab and show it's absent/disabled there.

## 5. Second trigger mechanism — webhook (1:50–2:20)

- Open the workflow builder as owner, show the webhook trigger's token (owner-only visible column).
- In a terminal, fire it:
  ```bash
  curl -s http://localhost:18083/v1/graphql \
    -H 'content-type: application/json' \
    -d '{"query":"mutation($id:uuid!,$token:uuid!){ webhookTriggerRun(workflow_id:$id, token:$token, payload:{}) { run_id status } }","variables":{"id":"<workflow_id>","token":"<webhook_token>"}}'
  ```
- Switch back to the app, open the new run from the workflow list (no button click started it) — show it streaming live the same way.

## 6. Cross-org isolation, including direct ID guessing (2:20–3:00)

- Log out, log in as **b-owner** (Org B — Northwind Telco).
- Show the workflow list is empty for Org B.
- Copy Org A's workflow ID and run ID from the earlier tab. As b-owner, paste them directly into the URL bar (`/workflows/<org-a-id>` and `/workflows/<org-a-id>/runs/<run-id>`) — show both resolve to nothing / a permission-denied state, not Org A's data.
- Open browser dev tools, paste a raw GraphQL query for `workflows_by_pk(id: "<org-a-workflow-id>")` against the GraphQL endpoint using b-owner's session token — show it returns `null`.
- Attempt to call `triggerWorkflowRun`/`approveStep` on Org A's IDs as b-owner — show the GraphQL error (action not permitted for this role/org).

## Optional — narrate while running `npm run verify:security`

Running the adversarial suite live (`npm run verify:security`) and showing the PASS table is a strong closer: it's the same 6 isolation guarantees the manual walkthrough just demonstrated, but automated and repeatable.
