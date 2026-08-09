// db_write step: inserts the resolved output into crm_pushes (stand-in CRM
// table) via the admin client.
import { adminRequest } from "../admin-client";

const INSERT_CRM_PUSH = /* GraphQL */ `
  mutation InsertCrmPush($orgId: uuid!, $stepRunId: uuid!, $payload: jsonb!) {
    insert_crm_pushes_one(
      object: { org_id: $orgId, step_run_id: $stepRunId, payload: $payload }
    ) {
      id
    }
  }
`;

export async function runDbWrite(
  config: any,
  previousOutput: unknown,
  ctx: { orgId: string; stepRunId: string }
): Promise<{ output: any }> {
  const payload = config?.payload ?? previousOutput ?? {};
  const data = await adminRequest<{ insert_crm_pushes_one: { id: string } }>(
    INSERT_CRM_PUSH,
    { orgId: ctx.orgId, stepRunId: ctx.stepRunId, payload }
  );
  return { output: { crm_push_id: data.insert_crm_pushes_one.id, payload } };
}
