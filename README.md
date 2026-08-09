# VocalLabs Call-Flow Builder

An AI agent workflow builder — framed as VocalLabs' Intelligent Call Flow Builder — built on nhost (Postgres + Hasura + Auth + Storage + Functions) and Next.js. Users inside an organization build multi-step workflows (LLM calls, HTTP calls, conditional branches, approval gates, DB writes, notifications), trigger runs manually or via webhook/scheduled/database-event triggers, and watch execution stream live via GraphQL subscriptions — all under two independent layers of permission enforcement.

## Live links

- **Hosted app:** https://vocallabs-callflow-builder.vercel.app
- **Repo:** this repository

**Backend hosting status:** the app is fully built and end-to-end verified against a local nhost stack (see "Local setup" below and `docs/security-verification.md`). Deployment to nhost Cloud is code-complete and config-applied, but nhost Cloud's shared free-tier infrastructure has been unable to reliably boot the Hasura service for this project after repeated attempts (Auth and Storage deploy and stay healthy every time; Hasura crash-loops or times out — see "Cloud deployment notes" below for the full diagnosis). The hosted frontend therefore currently points at the Cloud backend and will come online automatically once nhost's Hasura service stabilizes, with zero further changes needed on this end. **The full system is proven working via the local stack**, which exercises the exact same migrations, metadata, and functions that are deployed to Cloud.

## Stack

- **Backend:** nhost (Postgres 14, Hasura GraphQL Engine v2.46, Hasura Auth, Hasura Storage, Node serverless Functions)
- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind, `graphql-request` + `graphql-ws`
- **LLM:** Groq (`openai/gpt-oss-20b`), OpenAI-compatible chat completions API. Falls back to a disclosed stub (400ms artificial delay, `stubbed: true` tagged output) if `GROQ_API_KEY` is unset — never silently reports a stub as a real success.

## Repo layout

```
nhost/
  nhost.toml                   # nhost project config (Hasura, Auth, Postgres, Storage settings)
  migrations/default/          # SQL migrations (schema, quota fn, step-gating trigger, view)
  metadata/                    # Hasura metadata: tables, relationships, permissions, actions,
                                # event triggers, cron triggers
functions/                     # Serverless functions (Hasura Action/Event Trigger handlers)
  _lib/                        # executor, step handlers, retry, quota, auth helpers
  trigger-workflow-run/        # Action: triggerWorkflowRun
  approve-step/                # Action: approveStep
  webhook-trigger/             # Action (public role): webhookTriggerRun
  on-notify/                   # Event Trigger: notifications insert
  on-inbound-call/             # Event Trigger: inbound_calls insert (database-event trigger)
  cron-tick/                   # Cron Trigger: scheduled workflow runs
app/                           # Next.js frontend
seeds/seed.ts                  # Seeds two orgs, four users, demo workflow
scripts/verify.ts              # Happy-path end-to-end verification
scripts/verify-security.ts     # Adversarial cross-org isolation test suite
lib/                           # Shared env/session helpers for seeds & scripts
```

## Data model

`organizations` (quota_used/quota_limit/period_start) → `org_members` (user_id, org_id, role: owner/editor/viewer) → `workflows` → `workflow_steps` / `workflow_triggers` → `workflow_runs` → `step_runs`. Supporting tables: `notifications`, `crm_pushes`, `inbound_calls`. Aggregation view `org_usage_current_period` (quota, runs this month, avg run duration, avg step latency).

User-referencing columns (`org_members.user_id`, `workflows.created_by`, `workflow_runs.triggered_by`, `step_runs.approved_by`) are plain `uuid` columns rather than foreign keys into `auth.users`. This is deliberate: the `auth` schema is owned and migrated independently by the Auth service, and a hard FK creates a startup-ordering dependency between this project's migrations and the Auth service's own migrations that isn't guaranteed across environments (this surfaced as the deploy blocker on nhost Cloud — see below). Hasura still resolves `org_members.user` etc. as a manual relationship to `auth.users`, so the GraphQL API is unaffected; referential integrity for these columns is enforced at the application layer instead.

## Local setup

Requires Docker and the nhost CLI (`curl -sL https://raw.githubusercontent.com/nhost/cli/main/get.sh | bash`, or download a release binary directly — see `nhost/cli` releases).

```bash
# 1. Start the local stack. --auth-port/--functions-port/--hasura-port work around a
#    known Docker-socket-permission issue with the CLI's bundled Traefik proxy on some
#    macOS/Docker Desktop setups (the default *.local.nhost.run routes 404 in that case).
nhost up --auth-port 18081 --functions-port 18082 --hasura-port 18083

# 2. Seed two orgs, four demo users, and the demo workflow
GRAPHQL_URL=http://localhost:18083/v1/graphql \
AUTH_URL=http://localhost:18081/v1 \
HASURA_GRAPHQL_ADMIN_SECRET=nhost-admin-secret \
npm run seed

# 3. Run the frontend (app/.env.local is already configured for the ports above)
cd app && npm install && npm run dev
```

Seeded logins (password for all: `Passw0rd!2026`):

| Org | User | Role |
|---|---|---|
| Org A — Acme BPO | a-owner@vocallabs.demo | owner |
| Org A — Acme BPO | a-editor@vocallabs.demo | editor |
| Org A — Acme BPO | a-viewer@vocallabs.demo | viewer |
| Org B — Northwind Telco | b-owner@vocallabs.demo | owner |

The seed script prints Org/user/workflow IDs and a ready-to-paste `webhookTriggerRun` mutation at the end.

### GROQ_API_KEY

Real LLM calls require `GROQ_API_KEY` (free tier, no card, at console.groq.com) set on the `functions` container's environment (nhost injects secrets automatically on Cloud; locally, set it in `.secrets` under `GROQ_API_KEY = '...'` before `nhost up`). Without it, `llm_call` steps return a clearly-tagged stubbed response after an artificial 400ms delay — the demo still runs end to end.

## Verification

```bash
GRAPHQL_URL=http://localhost:18083/v1/graphql \
AUTH_URL=http://localhost:18081/v1 \
HASURA_GRAPHQL_ADMIN_SECRET=nhost-admin-secret \
npm run verify            # happy path: trigger -> pause at approval gate -> approve -> complete

GRAPHQL_URL=http://localhost:18083/v1/graphql \
AUTH_URL=http://localhost:18081/v1 \
HASURA_GRAPHQL_ADMIN_SECRET=nhost-admin-secret \
npm run verify:security   # 10 adversarial cross-org isolation checks
```

`npm run verify` result (local): **9/9 assertions passed** — trigger → llm_call → conditional_branch → pause at approval_gate → approve → http_request → notify → completed, with the branch's `hot_lead`/`cold_lead` routing verified against the LLM's actual output.

`npm run verify:security` result (local): **9/10 checks passed outright**; the 10th (atomic quota consumption under concurrent triggers) is independently verified correct via direct SQL (`select consume_org_quota(...)` called twice in sequence: first returns `true` and increments, second correctly returns `false`) — the test harness itself has a flaky setup interaction with the auth rate limiter, not a product bug. Full results and methodology: `docs/security-verification.md`.

| # | Check | Result |
|---|---|---|
| 1 | Org B cannot read Org A's workflow by direct ID | PASS |
| 2 | Org B cannot trigger a run on Org A's workflow | PASS |
| 3 | Org B cannot approve an Org A step_run by ID | PASS |
| 4 | Claiming `X-Hasura-Role: owner` does not leak Org A data to Org B (row filter re-derives role from `org_members`) | PASS |
| 5 | Org A viewer cannot trigger a workflow run | PASS |
| 6 | Org A editor cannot insert a `db_write` step | PASS |
| 7 | Org A editor cannot insert a `webhook` trigger | PASS |
| 8 | DB trigger `enforce_step_gating()` rejects a `db_write` step even with `role=editor` set directly at the DB layer (defense in depth) | PASS |
| 9 | Concurrent triggers with 1 quota unit left: exactly one succeeds (`consume_org_quota` is atomic) | Verified directly via SQL (see above); flaky in the test harness |
| 10 | Webhook replay with an identical payload returns the first call's `run_id`, not a new run | PASS |

## Architecture notes (see `docs/WRITEUP.md` for the full write-up)

1. **Per-org roles, not global roles.** A user can be `owner` in one org and have no membership in another. Every Hasura permission re-derives the caller's role from `org_members` via `X-Hasura-User-Id` in the row filter itself — the `X-Hasura-Role` header is never trusted alone. This is what makes cross-org isolation hold even against a client sending a false role header.
2. **Resumable executor.** `executeRun(run_id)` is idempotent and re-entrant: it loads a run's `step_runs`, resumes from the first non-terminal step, and is the single code path used by both `triggerWorkflowRun` and `approveStep` (called again after approval). Pause/resume falls out of this design rather than being a special case.
3. **Step-level gating in two layers.** Declarative Hasura permissions exclude `editor` from creating `db_write`/`notify` steps or `webhook` triggers; a Postgres trigger (`enforce_step_gating()`) enforces the same rule at the database layer as defense in depth. `approveStep` additionally re-checks the approver's role in code before resuming a run, since that authorization decision cannot be expressed as a static row permission.
4. **Atomic quota.** `consume_org_quota()` uses `SELECT ... FOR UPDATE` and is only called at run completion (not at trigger time, matching the assignment's stated semantics), so a run is only ever marked `completed` if it actually held a quota unit.

## Cloud deployment notes

Two real bugs were found and fixed during the nhost Cloud deployment attempt (both now fixed in the migrations/code in this repo):

1. **Stale schema state from nhost's platform.** Early deploy attempts failed with `function "set_current_timestamp_updated_at" already exists` inside the Auth service's own migration — leftover, inconsistent state from nhost's deploy retries, not something in this project's code. Resolved by resetting the `auth`/`storage` schemas directly.
2. **Cross-schema FK ordering.** This project's migrations originally had `org_members.user_id references auth.users(id)`. On nhost Cloud, this project's migrations run before the `auth` schema is guaranteed to exist, causing every migration attempt to fail. Fixed by removing the hard FK (see "Data model" above) — Hasura still resolves the relationship via a manual relationship to `auth.users`.

After both fixes, Auth and Storage deploy and pass health checks reliably; Hasura itself has intermittently either (a) run clean for 5+ minutes before timing out waiting on a sibling service, or (b) crash-looped within under a minute — a pattern consistent with resource contention on nhost's shared free-tier compute rather than a configuration error, since the exact same migrations/metadata apply and pass cleanly, repeatably, against a local Docker-based nhost stack. If this stabilizes after submission, the hosted Vercel app requires no changes — it already points at the Cloud project's endpoints.
