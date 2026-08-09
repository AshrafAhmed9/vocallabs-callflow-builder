-- One trigger per type per workflow (matches the frontend's upsert-by-type
-- editor UI: manual/webhook/scheduled/database_event each have a single slot).
alter table public.workflow_triggers
  add constraint workflow_triggers_workflow_id_type_key unique (workflow_id, type);
