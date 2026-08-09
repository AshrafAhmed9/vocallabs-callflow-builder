drop view if exists public.org_usage_current_period;
drop trigger if exists workflow_triggers_gate on public.workflow_triggers;
drop trigger if exists workflow_steps_gate on public.workflow_steps;
drop function if exists public.enforce_step_gating();
drop function if exists public.consume_org_quota(uuid, int);
