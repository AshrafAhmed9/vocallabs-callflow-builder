-- Core schema for the AI Agent Workflow Builder (VocalLabs call-flow engine demo)

create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quota_limit int not null default 1000,
  quota_used int not null default 0,
  period_start timestamptz not null default date_trunc('month', now()),
  created_at timestamptz not null default now()
);

create table public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  position int not null,
  type text not null check (type in ('llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate')),
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workflow_id, position)
);

create table public.workflow_triggers (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  type text not null check (type in ('manual', 'webhook', 'scheduled', 'database_event')),
  config jsonb not null default '{}'::jsonb,
  webhook_token uuid default gen_random_uuid(),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'paused', 'completed', 'failed')),
  triggered_by uuid references auth.users(id),
  trigger_type text not null default 'manual',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  dedupe_key text
);
create unique index workflow_runs_dedupe_idx on public.workflow_runs (workflow_id, dedupe_key) where dedupe_key is not null;

create table public.step_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  step_id uuid not null references public.workflow_steps(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'paused', 'awaiting_approval', 'completed', 'failed', 'skipped')),
  input jsonb,
  output jsonb,
  error text,
  attempt int not null default 0,
  latency_ms int,
  tokens_used int,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  step_run_id uuid references public.step_runs(id) on delete cascade,
  channel text not null default 'slack',
  message text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.crm_pushes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  step_run_id uuid references public.step_runs(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table public.inbound_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  caller_number text,
  transcript text,
  workflow_id uuid references public.workflows(id),
  created_at timestamptz not null default now()
);

create index on public.org_members (user_id);
create index on public.workflows (org_id);
create index on public.workflow_steps (workflow_id);
create index on public.workflow_triggers (workflow_id);
create index on public.workflow_runs (org_id);
create index on public.workflow_runs (workflow_id);
create index on public.step_runs (workflow_run_id);
create index on public.step_runs (org_id);
