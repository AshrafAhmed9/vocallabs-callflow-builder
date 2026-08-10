# Security verification

Adversarial cross-org isolation checks, run via `npm run verify:security` against the **live hosted deployment** (Hasura + Auth on Render, seeded via `npm run seed`). Org A = "Acme BPO" (owner/editor/viewer seeded), Org B = "Northwind Telco" (owner seeded).

## Results

**10/10 passed**, against the live production backend.

| # | Check | Result | Detail |
|---|---|---|---|
| 1 | b-owner (Org B) cannot read Org A's workflow by direct ID | **PASS** | `workflows_by_pk` returns `null` |
| 2 | b-owner cannot trigger a run on Org A's workflow | **PASS** | Action not present in b-owner's schema (`no mutations exist`) |
| 3 | b-owner cannot approve an Org A step_run by ID | **PASS** | Action not present in b-owner's schema |
| 4 | Claiming `X-Hasura-Role: owner` does not leak Org A data to b-owner | **PASS** | Row filter re-derives role from `org_members`; still returns `null` even with the elevated role header |
| 5 | Org A viewer cannot trigger a workflow run | **PASS** | Action not present in viewer's schema |
| 6 | Org A editor cannot insert a `db_write` step | **PASS** | Rejected by Hasura's declarative permission (`type: {_nin: [db_write, notify]}`) |
| 7 | Org A editor cannot insert a `webhook` trigger | **PASS** | Rejected by Hasura's declarative permission |
| 8 | DB trigger `enforce_step_gating()` rejects a `db_write` step even with `role=editor` set directly at the DB session level | **PASS** | Defense-in-depth: this check bypasses Hasura's declarative permission (via `x-hasura-admin-secret` + `x-hasura-role: editor` headers together) to confirm the Postgres trigger independently enforces the same rule |
| 9 | Concurrent triggers with 1 quota unit left: exactly one succeeds | **PASS** | `quota_used` delta was exactly 1 across two concurrent `triggerWorkflowRun` calls (see below for how this is verified given the demo workflow's approval gate) |
| 10 | Webhook replay with an identical payload returns the first call's `run_id`, not a new run | **PASS** | Two `webhookTriggerRun` calls with the same `idempotency_key` return the same `run_id` |

## Note on check 9 — how the atomic quota race is actually exercised

The seeded demo workflow contains an `approval_gate` step, so a `triggerWorkflowRun` call pauses before completion — and `consume_org_quota()` is only called at run *completion* (matching the assignment's stated semantics: "increments the org's quota usage on completion"). The test therefore: sets `quota_used = quota_limit - 1`, fires two concurrent `triggerWorkflowRun` calls (both reach the approval gate and pause), approves both paused runs, polls until both reach a terminal state, then asserts the net `quota_used` delta is exactly `1` — not `0` (both lost) and not `2` (the race wasn't actually atomic).

The underlying `consume_org_quota()` SQL function was also verified directly and independently, in immediate sequence:

```sql
update organizations set quota_used = 999, quota_limit = 1000 where name = 'Org A — Acme BPO';

select consume_org_quota(id, 1) from organizations where name = 'Org A — Acme BPO';
-- => true         (999 -> 1000, one unit was available)

select consume_org_quota(id, 1) from organizations where name = 'Org A — Acme BPO';
-- => false         (1000 = 1000, no unit available — correctly rejected)

select quota_used from organizations where name = 'Org A — Acme BPO';
-- => 1000           (incremented exactly once, not twice)
```

This confirms the `SELECT ... FOR UPDATE`-based atomic check-and-increment behaves correctly under sequential calls representing the two branches of a race (one winner, one loser, exactly one increment). The executor (`functions/_lib/executor.ts`) was hardened during this investigation so a run is only ever marked `completed` if `consumeOrgQuota()` returns `true` — if it returns `false` (lost the race), the run is marked `failed` with a clear error, rather than silently completing without actually holding a quota unit.

## Methodology notes

- Checks 1–5 use the actual seeded org/workflow/step IDs, fetched via an admin-privileged lookup at the start of the script (not hardcoded), so the test is against real data, not fixtures.
- Check 4 specifically tests the header-spoofing attack: authenticating as a legitimate Org B user but manually setting `x-hasura-role: owner` on the request, to confirm the row filter's re-derivation of role from `org_members` — not the header — is what gates access.
- Check 8 authenticates with the raw Hasura admin secret (which normally bypasses all declarative permissions) plus a spoofed `x-hasura-role: editor` session variable, specifically to reach the Postgres trigger's enforcement path rather than Hasura's declarative one — proving the two layers are independent, not that one silently relies on the other.
- Check 10 uses a fixed `idempotency_key` payload value and asserts the second call's `run_id` equals the first call's, confirming the `(workflow_id, dedupe_key)` unique constraint plus the handler's constraint-violation catch path work together correctly under a simulated telephony-provider retry.
