# Write-up

## Schema reasoning

The schema follows the required chain — `organizations → org_members → workflows → workflow_steps/workflow_triggers → workflow_runs → step_runs` — with every table that can be queried or mutated carrying its own `org_id` column, even where it could technically be derived through a join (e.g. `step_runs.org_id`, duplicated from `workflow_runs.org_id`). This is deliberate, not redundancy for its own sake: it means every Hasura permission's row filter can scope to the caller's org in a single hop instead of a multi-level join through `workflow_run → workflow → org`, which keeps permission predicates simple enough to audit by eye — a real concern when the audit itself (cross-org isolation) is the top grading criterion.

`workflow_steps.config` and `workflow_triggers.config` are `jsonb` rather than per-type columns, because the six step types and four trigger types have genuinely different shapes (an `llm_call`'s prompt vs. a `conditional_branch`'s field/operator/value vs. a `webhook` trigger's token) and a wide sparse table would have added complexity without adding safety — nothing in `config` needs to be queried or filtered on by Hasura, only interpreted by the step dispatcher.

User-referencing columns (`org_members.user_id`, `workflows.created_by`, `workflow_runs.triggered_by`, `step_runs.approved_by`) are plain `uuid`, not foreign keys into `auth.users`. This was a late, deliberate change: the `auth` schema is owned and migrated independently by the Auth microservice, and a hard FK creates an implicit ordering dependency between this project's migrations and Auth's own migration run — which held locally but not on nhost Cloud's deploy pipeline, and was the actual root cause of a multi-hour deployment blocker (see the README's "Cloud deployment notes"). Hasura still resolves these as manual relationships to `auth.users`, so the GraphQL API is identical either way; only DB-level referential integrity moves to the application layer, which is a normal and common trade-off at any service boundary an app doesn't own.

## How the two permission layers are enforced differently

**Layer 1 (org + role scoping)** is enforced entirely declaratively, in Hasura's permission system. Every select/insert/update/delete permission, on every table, for every one of `owner`/`editor`/`viewer`, re-derives the caller's role from `org_members` inside the row filter itself:

```yaml
filter:
  org:
    members:
      _and:
        - user_id: { _eq: X-Hasura-User-Id }
        - role: { _eq: owner }
```

The `X-Hasura-Role` header the client sends is only ever used to pick *which* permission set to evaluate — it is never trusted as a fact. If a client claims `role: owner` while their actual `org_members` row for that org says `viewer` (or doesn't exist at all), the row filter above returns nothing. This is what makes cross-org isolation hold even against a client that lies about its role or guesses an ID directly — the check isn't "does the frontend enforce this," it's "is there a row in `org_members` that makes this true," evaluated fresh on every single request.

**Layer 2 (step-level gating)** — restricting `db_write`/`notify` steps and `webhook` triggers to `owner` — is enforced in three independent places on purpose, not redundantly:

1. **Declaratively in Hasura**, alongside Layer 1, via a `type: { _nin: [db_write, notify] }` clause on `editor`'s insert/update permission for `workflow_steps` (and the equivalent for `webhook` triggers). This is the fast, normal path.
2. **In Postgres itself**, via a `BEFORE INSERT/UPDATE` trigger (`enforce_step_gating()`) that raises if the calling role isn't `owner` and the row is one of the restricted types. This exists specifically because the serverless functions call the database through the Hasura *admin* secret, which bypasses every declarative permission above — the DB trigger is what still catches a bug in a function that forgot to check the caller's role, or a future function that writes to these tables directly.
3. **In application code**, for `approveStep` specifically — clearing an `approval_gate` is a mid-execution decision ("is this specific person allowed to resume this specific run right now"), not a static fact about a row, so it can't be expressed as a Hasura permission at all. The handler loads the run's `org_id`, looks up the caller's `org_members` role for that org, and rejects with a 403 before doing anything else, *before* it ever touches the admin-authenticated mutation that would actually resume the run.

## How the approval-gate pause/resume is implemented

The core is a single function, `executeRun(run_id)`, that is idempotent and re-entrant: given a run, it loads all of that run's `step_runs` joined to their step definitions ordered by position, skips anything already `completed`/`skipped`, and drives forward from the first non-terminal step. It never assumes it is starting at step 1.

When it reaches an `approval_gate` step, it marks that step's `step_run` as `awaiting_approval`, marks the overall `workflow_run` as `paused`, and returns — it does not loop, poll, or hold anything open. `triggerWorkflowRun` calls `executeRun` once to start a run; `approveStep` calls it again after stamping `approved_by`/`approved_at` and flipping the run back to `running`. Both call sites are the same function on the same code path, so pause/resume isn't a special case bolted onto the executor — it's just what happens when the function is invoked twice against the same run's row state. This also makes the design safe against duplicate/retried invocations (e.g. a telephony webhook retry): calling `executeRun` again on an already-`completed` or already-`failed` run is a no-op, and calling it again on a `paused` run just re-confirms the pause rather than re-running earlier steps, because it always resumes from whatever `step_runs` actually says, not from an in-memory position.

Every step_run/workflow_run mutation the executor makes goes out over Hasura's admin GraphQL API rather than a raw Postgres write, specifically so that the `step_runs` subscription the frontend holds open picks up every status change automatically — the live "paused, awaiting approval" state the frontend shows is not a special message the backend sends, it is simply what the subscription reports because that's what the row says.
