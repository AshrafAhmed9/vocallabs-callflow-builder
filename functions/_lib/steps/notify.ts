// notify step: inserts a notifications row. The actual "send" happens in
// the on-notify Hasura Event Trigger handler (stubbed as a console log).
import { adminRequest } from "../admin-client";

const INSERT_NOTIFICATION = /* GraphQL */ `
  mutation InsertNotification($orgId: uuid!, $stepRunId: uuid!, $channel: String!, $message: String!) {
    insert_notifications_one(
      object: { org_id: $orgId, step_run_id: $stepRunId, channel: $channel, message: $message }
    ) {
      id
    }
  }
`;

function interpolate(template: string, previousOutput: unknown): string {
  const prevStr =
    typeof previousOutput === "string" ? previousOutput : JSON.stringify(previousOutput ?? "");
  return template.replace(/\{\{\s*previous_output\s*\}\}/g, prevStr);
}

export async function runNotify(
  config: any,
  previousOutput: unknown,
  ctx: { orgId: string; stepRunId: string }
): Promise<{ output: any }> {
  const channel = config?.channel || "slack";
  const message = interpolate(config?.message || "Workflow notification", previousOutput);
  const data = await adminRequest<{ insert_notifications_one: { id: string } }>(
    INSERT_NOTIFICATION,
    { orgId: ctx.orgId, stepRunId: ctx.stepRunId, channel, message }
  );
  return { output: { notification_id: data.insert_notifications_one.id, channel, message } };
}
