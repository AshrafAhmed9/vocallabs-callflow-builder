# VocalLabs Call-Flow Builder

An AI agent workflow builder — framed as VocalLabs' Intelligent Call Flow Builder — built on Postgres + Hasura + Hasura Auth + Node serverless functions, and Next.js. Users inside an organization build multi-step workflows (LLM calls, HTTP calls, conditional branches, approval gates, DB writes, notifications), trigger runs manually or via webhook/scheduled/database-event triggers, and watch execution stream live via GraphQL subscriptions — all under two independent layers of permission enforcement.

## Live links

- **Hosted app:** https://vocallabs-callflow-builder.vercel.app
- **GraphQL API:** https://vocallabs-hasura.onrender.com/v1/graphql
- **Auth API:** https://vocallabs-auth.onrender.com
- **Repo:** this repository

**Everything below is verified against this exact hosted deployment**, not just locally: `npm run verify` (happy path) passes 9/9 and `npm run verify:security` (adversarial cross-org isolation) passes 10/10 against the live Render backend — see "Verification" below for the commands and `docs/security-verification.md` for full results.

## Stack

- **Backend:** Postgres 16, Hasura GraphQL Engine v2.42, Hasura Auth (`nhost/hasura-auth`), Node/Express serverless-function handlers — all deployed as independent services on Render (nhost Cloud's shared free-tier infrastructure repeatedly failed to boot Hasura reliably during initial deployment; see "Deployment notes" below for the full diagnosis and why this project runs the same nhost-authored components directly on Render instead).
- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind, `graphql-request` + `graphql-ws`, hosted on Vercel.
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

Real LLM calls require `GROQ_API_KEY` (free tier, no card, at console.groq.com) set on the functions service's environment. Without it, `llm_call` steps return a clearly-tagged stubbed response after an artificial 400ms delay — the demo still runs end to end. It's set on the hosted deployment; for local dev, set it in `.secrets` under `GROQ_API_KEY = '...'` before `nhost up`.

## Verification

Against the **live hosted deployment**:

```bash
GRAPHQL_URL=https://vocallabs-hasura.onrender.com/v1/graphql \
AUTH_URL=https://vocallabs-auth.onrender.com \
HASURA_GRAPHQL_ADMIN_SECRET=<see notes to reviewer / ask> \
npm run verify            # happy path: trigger -> pause at approval gate -> approve -> complete

GRAPHQL_URL=https://vocallabs-hasura.onrender.com/v1/graphql \
AUTH_URL=https://vocallabs-auth.onrender.com \
HASURA_GRAPHQL_ADMIN_SECRET=<see notes to reviewer / ask> \
npm run verify:security   # 10 adversarial cross-org isolation checks
```

(Substitute `GRAPHQL_URL=http://localhost:18083/v1/graphql`, `AUTH_URL=http://localhost:18081/v1`, `HASURA_GRAPHQL_ADMIN_SECRET=nhost-admin-secret` to run against the local stack instead.)

`npm run verify` result: **9/9 assertions passed** — trigger → llm_call → conditional_branch → pause at approval_gate → approve → http_request → notify → completed, with the branch's `hot_lead`/`cold_lead` routing verified against the LLM's actual output.

`npm run verify:security` result: **10/10 checks passed**, against the live hosted deployment. Full results and methodology: `docs/security-verification.md`.

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
| 9 | Concurrent triggers with 1 quota unit left: exactly one succeeds (`consume_org_quota` is atomic) | PASS |
| 10 | Webhook replay with an identical payload returns the first call's `run_id`, not a new run | PASS |

## Architecture notes (see `docs/WRITEUP.md` for the full write-up)

1. **Per-org roles, not global roles.** A user can be `owner` in one org and have no membership in another. Every Hasura permission re-derives the caller's role from `org_members` via `X-Hasura-User-Id` in the row filter itself — the `X-Hasura-Role` header is never trusted alone. This is what makes cross-org isolation hold even against a client sending a false role header.
2. **Resumable executor.** `executeRun(run_id)` is idempotent and re-entrant: it loads a run's `step_runs`, resumes from the first non-terminal step, and is the single code path used by both `triggerWorkflowRun` and `approveStep` (called again after approval). Pause/resume falls out of this design rather than being a special case.
3. **Step-level gating in two layers.** Declarative Hasura permissions exclude `editor` from creating `db_write`/`notify` steps or `webhook` triggers; a Postgres trigger (`enforce_step_gating()`) enforces the same rule at the database layer as defense in depth. `approveStep` additionally re-checks the approver's role in code before resuming a run, since that authorization decision cannot be expressed as a static row permission.
4. **Atomic quota.** `consume_org_quota()` uses `SELECT ... FOR UPDATE` and is only called at run completion (not at trigger time, matching the assignment's stated semantics), so a run is only ever marked `completed` if it actually held a quota unit.

## Deployment notes

The backend is deployed as four independent services on Render (Postgres, Hasura, Hasura Auth, and a small Express server wrapping the same function handlers nhost would auto-route) rather than on nhost Cloud, after nhost Cloud's shared free-tier infrastructure repeatedly failed to boot the Hasura service — Auth and Storage deployed and passed health checks reliably every time, but Hasura either crash-looped within under a minute or, once, ran clean for 5+ minutes before timing out waiting on a sibling service, a pattern consistent with resource contention on shared free-tier compute rather than a configuration error (the exact same migrations/metadata apply and pass cleanly, repeatably, against a local Docker-based nhost stack). Render's free tier gives each service dedicated compute instead, which deployed successfully on the first real attempt once configured correctly.

Two real, reusable bugs were found and fixed along the way (both fixed in the migrations/code in this repo, independent of which platform they run on):

1. **Cross-schema FK ordering.** This project's migrations originally had `org_members.user_id references auth.users(id)`. On a fresh deploy, this project's migrations can run before the `auth` schema is guaranteed to exist, causing migrations to fail outright. Fixed by removing the hard FK (see "Data model" above) — Hasura still resolves the relationship via a manual relationship to `auth.users`, so the GraphQL API is unaffected.
2. **hasura-auth requires the `auth` schema to exist before its own migrations run** — it creates its tables inside the schema but not the schema itself. Fixed by creating an empty `auth` schema (and `storage`, unused here) ahead of the Auth service's first boot.

Platform-specific configuration notes for anyone reproducing this on Render specifically: Render's managed Postgres requires `?sslmode=require` on every connection string, including `POSTGRES_MIGRATIONS_CONNECTION` (a variable distinct from `POSTGRES_CONNECTION`, used by hasura-auth specifically for its schema migration step) and `PGSSLMODE=require` as a plain env var (some code paths in hasura-auth's migration runner don't parse `sslmode` from the connection URI). hasura-auth's default role/allowed-roles (`user`/`me`) don't match this project's `owner`/`editor`/`viewer` roles — set via `AUTH_USER_DEFAULT_ROLE=viewer` and `AUTH_USER_DEFAULT_ALLOWED_ROLES=owner,editor,viewer,me`. Hasura's `HASURA_GRAPHQL_UNAUTHORIZED_ROLE` must be `public` (not `viewer`) for the `webhookTriggerRun` action's `role: public` permission to be reachable by unauthenticated requests — the whole point of that trigger being callable by an external telephony system with no user session.
