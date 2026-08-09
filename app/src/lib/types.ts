export type OrgRole = "owner" | "editor" | "viewer";

export type StepType =
  | "llm_call"
  | "http_request"
  | "db_write"
  | "notify"
  | "conditional_branch"
  | "approval_gate";

export type TriggerType = "manual" | "webhook" | "scheduled" | "database_event";

export type RunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export type StepRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "skipped";

export interface Organization {
  id: string;
  name: string;
  quota_limit: number;
  quota_used: number;
  period_start: string;
}

export interface OrgMembership {
  id: string;
  org_id: string;
  role: OrgRole;
  organization: Organization;
}

export interface OrgUsage {
  quota_used: number;
  quota_limit: number;
  runs_this_month: number;
  avg_run_duration_seconds: number | null;
  avg_step_latency_ms: number | null;
}

export interface WorkflowStep {
  id: string;
  workflow_id: string;
  position: number;
  type: StepType;
  name: string;
  config: Record<string, unknown>;
}

export interface WorkflowTrigger {
  id: string;
  workflow_id: string;
  type: TriggerType;
  config: Record<string, unknown>;
  webhook_token: string | null;
  enabled: boolean;
}

export interface WorkflowRunSummary {
  id: string;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  trigger_type: string;
}

export interface Workflow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  workflow_steps: WorkflowStep[];
  workflow_triggers: WorkflowTrigger[];
  workflow_runs: WorkflowRunSummary[];
}

export interface StepRun {
  id: string;
  workflow_run_id: string;
  step_id: string;
  org_id: string;
  status: StepRunStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  attempt: number;
  latency_ms: number | null;
  tokens_used: number | null;
  approved_by: string | null;
  approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  step?: { name: string; type: StepType; position: number };
}
