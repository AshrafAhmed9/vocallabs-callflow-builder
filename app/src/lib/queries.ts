import { gql } from "graphql-request";

/** Orgs the current user belongs to, with their per-org role. */
export const MY_MEMBERSHIPS = gql`
  query MyMemberships($uid: uuid!) {
    org_members(where: { user_id: { _eq: $uid } }) {
      id
      org_id
      role
      organization {
        id
        name
        quota_limit
        quota_used
        period_start
      }
    }
  }
`;

export const ORG_USAGE = gql`
  query OrgUsage($orgId: uuid!) {
    organizations_by_pk(id: $orgId) {
      id
      usage {
        quota_used
        quota_limit
        runs_this_month
        avg_run_duration_seconds
        avg_step_latency_ms
      }
    }
  }
`;

/** Workflow list: steps, triggers, and most recent run in one query. */
export const WORKFLOW_LIST = gql`
  query WorkflowList($orgId: uuid!) {
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { updated_at: desc }) {
      id
      org_id
      name
      description
      created_by
      created_at
      updated_at
      workflow_steps(order_by: { position: asc }) {
        id
        workflow_id
        position
        type
        name
        config
      }
      workflow_triggers {
        id
        workflow_id
        type
        config
        webhook_token
        enabled
      }
      workflow_runs(order_by: { started_at: desc }, limit: 1) {
        id
        status
        started_at
        finished_at
        trigger_type
      }
    }
  }
`;

export const WORKFLOW_DETAIL = gql`
  query WorkflowDetail($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      org_id
      name
      description
      created_by
      created_at
      updated_at
      workflow_steps(order_by: { position: asc }) {
        id
        workflow_id
        position
        type
        name
        config
      }
      workflow_triggers {
        id
        workflow_id
        type
        config
        webhook_token
        enabled
      }
      workflow_runs(order_by: { started_at: desc }, limit: 5) {
        id
        status
        started_at
        finished_at
        trigger_type
      }
    }
  }
`;

export const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($orgId: uuid!, $name: String!, $description: String) {
    insert_workflows_one(
      object: { org_id: $orgId, name: $name, description: $description }
    ) {
      id
    }
  }
`;

export const CREATE_STEP = gql`
  mutation CreateStep(
    $workflowId: uuid!
    $position: Int!
    $type: String!
    $name: String!
    $config: jsonb!
  ) {
    insert_workflow_steps_one(
      object: {
        workflow_id: $workflowId
        position: $position
        type: $type
        name: $name
        config: $config
      }
    ) {
      id
    }
  }
`;

export const UPDATE_STEP = gql`
  mutation UpdateStep($id: uuid!, $name: String!, $config: jsonb!) {
    update_workflow_steps_by_pk(
      pk_columns: { id: $id }
      _set: { name: $name, config: $config }
    ) {
      id
    }
  }
`;

export const UPDATE_STEP_POSITION = gql`
  mutation UpdateStepPosition($id: uuid!, $position: Int!) {
    update_workflow_steps_by_pk(pk_columns: { id: $id }, _set: { position: $position }) {
      id
    }
  }
`;

export const DELETE_STEP = gql`
  mutation DeleteStep($id: uuid!) {
    delete_workflow_steps_by_pk(id: $id) {
      id
    }
  }
`;

export const UPSERT_TRIGGER = gql`
  mutation UpsertTrigger(
    $workflowId: uuid!
    $type: String!
    $config: jsonb!
    $enabled: Boolean!
  ) {
    insert_workflow_triggers_one(
      object: { workflow_id: $workflowId, type: $type, config: $config, enabled: $enabled }
      on_conflict: {
        constraint: workflow_triggers_workflow_id_type_key
        update_columns: [config, enabled]
      }
    ) {
      id
      webhook_token
    }
  }
`;

export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflowId: uuid!) {
    triggerWorkflowRun(workflow_id: $workflowId) {
      run_id
      status
    }
  }
`;

export const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!) {
    approveStep(step_run_id: $stepRunId) {
      run_id
      status
    }
  }
`;

export const RUN_DETAIL = gql`
  query RunDetail($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id
      workflow_id
      org_id
      status
      triggered_by
      trigger_type
      started_at
      finished_at
      workflow {
        id
        name
      }
    }
  }
`;

export const STEP_RUNS_SUBSCRIPTION = gql`
  subscription StepRuns($runId: uuid!) {
    step_runs(
      where: { workflow_run_id: { _eq: $runId } }
      order_by: { started_at: asc }
    ) {
      id
      workflow_run_id
      step_id
      org_id
      status
      input
      output
      error
      attempt
      latency_ms
      tokens_used
      approved_by
      approved_at
      started_at
      finished_at
      step {
        name
        type
        position
      }
    }
  }
`;
