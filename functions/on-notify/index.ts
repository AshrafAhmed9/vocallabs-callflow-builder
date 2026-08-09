// Hasura Event Trigger handler for notifications INSERT.
// This is a stubbed Slack/email send: it just logs and stamps sent_at.
import { adminRequest } from "../_lib/admin-client";

const MARK_SENT = /* GraphQL */ `
  mutation MarkSent($id: uuid!, $now: timestamptz!) {
    update_notifications_by_pk(pk_columns: { id: $id }, _set: { sent_at: $now }) {
      id
    }
  }
`;

export default async function handler(req: any, res: any) {
  try {
    const row = req.body?.event?.data?.new;
    if (!row) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    // STUB: real implementation would call Slack/email/SMS provider here.
    console.log(`[SLACK ALERT] (stubbed send) org=${row.org_id} channel=${row.channel}: ${row.message}`);

    await adminRequest(MARK_SENT, { id: row.id, now: new Date().toISOString() });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("[on-notify] error:", err);
    return res.status(500).json({ message: err.message ?? "Internal error" });
  }
}
