"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrg, useGqlClient } from "@/lib/OrgContext";
import { TRIGGER_WORKFLOW_RUN } from "@/lib/queries";

export function RunButton({ workflowId }: { workflowId: string }) {
  const { role } = useOrg();
  const client = useGqlClient();
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hidden entirely for viewers - not just disabled.
  if (role === "viewer" || role === null) return null;

  const handleRun = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const data = await client.request<{
        triggerWorkflowRun: { run_id: string; status: string };
      }>(TRIGGER_WORKFLOW_RUN, { workflowId });
      router.push(`/workflows/${workflowId}/runs/${data.triggerWorkflowRun.run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger run");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleRun}
        disabled={isRunning}
        className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {isRunning ? "Starting…" : "Run"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
