"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useOrg, useGqlClient } from "@/lib/OrgContext";
import { useSubscription } from "@/lib/useSubscription";
import { APPROVE_STEP, STEP_RUNS_SUBSCRIPTION } from "@/lib/queries";
import type { StepRun } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

function ExpandableJson({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === null || value === undefined) return null;
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-gray-500 hover:underline"
      >
        {open ? "▾" : "▸"} {label}
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">
          {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ApproveButton({ stepRunId }: { stepRunId: string }) {
  const client = useGqlClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        disabled={isSubmitting}
        onClick={async () => {
          setIsSubmitting(true);
          setError(null);
          try {
            await client.request(APPROVE_STEP, { stepRunId });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Approval failed");
          } finally {
            setIsSubmitting(false);
          }
        }}
        className="rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
      >
        {isSubmitting ? "Approving…" : "Approve"}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

export default function RunViewPage({
  params,
}: PageProps<"/workflows/[id]/runs/[runId]">) {
  const { id, runId } = use(params);
  const { role } = useOrg();
  const { data, error, isLoading } = useSubscription<{ step_runs: StepRun[] }>(
    STEP_RUNS_SUBSCRIPTION,
    { runId },
    Boolean(runId)
  );

  const canApprove = role === "owner" || role === "editor";
  const steps = [...(data?.step_runs ?? [])].sort(
    (a, b) => (a.step?.position ?? 0) - (b.step?.position ?? 0)
  );

  return (
    <div>
      <div className="mb-2">
        <Link href={`/workflows/${id}`} className="text-sm text-gray-500 hover:underline">
          ← Back to workflow
        </Link>
      </div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Run timeline</h1>
      <p className="mb-6 text-xs text-gray-400">
        Live updates via GraphQL subscription — run {runId}
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-600">
          Subscription error: {error.message}
        </p>
      )}
      {isLoading && !data && <p className="text-sm text-gray-400">Connecting…</p>}

      <ol className="space-y-3">
        {steps.map((sr) => (
          <li key={sr.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">
                    {sr.step?.name ?? sr.step_id}
                  </span>
                  <StatusBadge status={sr.status} />
                </div>
                <div className="mt-1 flex gap-3 text-[11px] text-gray-400">
                  {sr.latency_ms !== null && <span>{sr.latency_ms}ms</span>}
                  {sr.tokens_used !== null && <span>{sr.tokens_used} tokens</span>}
                  {sr.attempt > 1 && <span>attempt {sr.attempt}</span>}
                </div>
              </div>

              {sr.status === "awaiting_approval" &&
                (canApprove ? (
                  <ApproveButton stepRunId={sr.id} />
                ) : (
                  <span className="rounded-md bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
                    Awaiting approval — viewers cannot approve
                  </span>
                ))}
            </div>

            <ExpandableJson label="Input" value={sr.input} />
            <ExpandableJson label="Output" value={sr.output} />
            {sr.error && (
              <ExpandableJson label="Error" value={sr.error} />
            )}
          </li>
        ))}
        {!isLoading && steps.length === 0 && !error && (
          <p className="text-sm text-gray-400">No step runs yet.</p>
        )}
      </ol>
    </div>
  );
}
