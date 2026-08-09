"use client";

import { useState } from "react";
import { NHOST_GRAPHQL_URL } from "@/lib/env";
import type { OrgRole, WorkflowTrigger } from "@/lib/types";

function webhookUrl(token: string) {
  // Webhook ingestion is expected to be exposed by a serverless function /
  // action on the same nhost project; derive a plausible URL from the
  // configured GraphQL endpoint's origin as a placeholder until the backend
  // team confirms the real route.
  try {
    const origin = new URL(NHOST_GRAPHQL_URL).origin.replace("graphql.", "functions.");
    return `${origin}/webhooks/${token}`;
  } catch {
    return `/webhooks/${token}`;
  }
}

interface Props {
  trigger: WorkflowTrigger;
  role: OrgRole | null;
  onSave: (config: Record<string, unknown>, enabled: boolean) => Promise<void>;
}

export function TriggerEditor({ trigger, role, onSave }: Props) {
  const [interval, setIntervalValue] = useState(
    (trigger.config?.interval_minutes as number) ?? 60
  );
  const [enabled, setEnabled] = useState(trigger.enabled);
  const canEdit = role === "owner" || role === "editor";

  // webhook triggers are owner-only in the UI (defense in depth; server enforces).
  if (trigger.type === "webhook" && role !== "owner") return null;

  if (trigger.type === "manual") {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <span className="font-medium">Manual</span>
        <p className="text-xs text-gray-500">Always available via the Run button.</p>
      </div>
    );
  }

  if (trigger.type === "database_event") {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <span className="font-medium">Database event</span>
        <p className="text-xs text-gray-500">
          Fires on row changes configured by an administrator. Read-only here.
        </p>
        <pre className="mt-2 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-500">
          {JSON.stringify(trigger.config, null, 2)}
        </pre>
      </div>
    );
  }

  if (trigger.type === "webhook") {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-medium">Webhook</span>
          <label className="flex items-center gap-1 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={enabled}
              onChange={async (e) => {
                setEnabled(e.target.checked);
                await onSave(trigger.config, e.target.checked);
              }}
            />
            enabled
          </label>
        </div>
        {trigger.webhook_token ? (
          <p className="mt-1 break-all rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-600">
            {webhookUrl(trigger.webhook_token)}
          </p>
        ) : (
          <p className="mt-1 text-xs text-gray-400">Token not yet issued.</p>
        )}
        <p className="mt-1 text-[11px] text-gray-400">
          Visible to owners only. POST a call transcript payload to trigger this flow.
        </p>
      </div>
    );
  }

  // scheduled
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">Scheduled</span>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={enabled}
            onChange={async (e) => {
              setEnabled(e.target.checked);
              await onSave({ ...trigger.config, interval_minutes: interval }, e.target.checked);
            }}
          />
          enabled
        </label>
      </div>
      <label className="mt-2 block text-xs text-gray-500">
        Run every
        <span className="ml-2 inline-flex items-center gap-1">
          <input
            type="number"
            min={1}
            disabled={!canEdit}
            value={interval}
            onChange={(e) => setIntervalValue(Number(e.target.value))}
            onBlur={() => canEdit && onSave({ ...trigger.config, interval_minutes: interval }, enabled)}
            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          minutes
        </span>
      </label>
    </div>
  );
}
