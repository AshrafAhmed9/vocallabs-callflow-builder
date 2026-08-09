-- Atomic quota consumption: SELECT ... FOR UPDATE prevents two concurrent
-- triggers from both slipping past a near-exhausted quota.
create or replace function public.consume_org_quota(p_org_id uuid, p_amount int default 1)
returns boolean
language plpgsql
as $$
declare
  v_limit int;
  v_used int;
  v_period_start timestamptz;
begin
  select quota_limit, quota_used, period_start
    into v_limit, v_used, v_period_start
    from public.organizations
    where id = p_org_id
    for update;

  if v_period_start < date_trunc('month', now()) then
    v_used := 0;
    update public.organizations
      set quota_used = 0, period_start = date_trunc('month', now())
      where id = p_org_id;
  end if;

  if v_used + p_amount > v_limit then
    return false;
  end if;

  update public.organizations
    set quota_used = quota_used + p_amount
    where id = p_org_id;

  return true;
end;
$$;

-- Defense in depth: step-level gating enforced at the DB, not just Hasura
-- permissions, so an admin-secret path can't bypass it either.
create or replace function public.enforce_step_gating()
returns trigger
language plpgsql
as $$
declare
  v_role text := current_setting('hasura.user.x-hasura-role', true);
begin
  if v_role is null or v_role = 'owner' then
    return new;
  end if;

  if TG_TABLE_NAME = 'workflow_steps' and new.type in ('db_write', 'notify') then
    raise exception 'role % may not create/edit % steps', v_role, new.type;
  end if;

  if TG_TABLE_NAME = 'workflow_triggers' and new.type = 'webhook' then
    raise exception 'role % may not create/edit webhook triggers', v_role;
  end if;

  return new;
end;
$$;

create trigger workflow_steps_gate
  before insert or update on public.workflow_steps
  for each row execute function public.enforce_step_gating();

create trigger workflow_triggers_gate
  before insert or update on public.workflow_triggers
  for each row execute function public.enforce_step_gating();

-- Aggregation view: org usage this period + avg run duration + avg step latency.
create or replace view public.org_usage_current_period as
select
  o.id as org_id,
  o.quota_used,
  o.quota_limit,
  count(distinct wr.id) filter (where wr.started_at >= date_trunc('month', now())) as runs_this_month,
  avg(extract(epoch from (wr.finished_at - wr.started_at))) filter (where wr.finished_at is not null) as avg_run_duration_seconds,
  avg(sr.latency_ms) as avg_step_latency_ms
from public.organizations o
left join public.workflow_runs wr on wr.org_id = o.id
left join public.step_runs sr on sr.org_id = o.id
group by o.id, o.quota_used, o.quota_limit;
