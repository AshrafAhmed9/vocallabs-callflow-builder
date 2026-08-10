"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useOrg, useGqlClient } from "@/lib/OrgContext";
import { CREATE_WORKFLOW, WORKFLOW_LIST } from "@/lib/queries";
import type { Workflow } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { RunButton } from "@/components/RunButton";

export default function WorkflowListPage() {
  const { orgId, role, isLoading: orgLoading, refetchUsage } = useOrg();
  const client = useGqlClient();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const load = useCallback(async () => {
    if (!orgId) {
      setWorkflows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await client.request<{ workflows: Workflow[] }>(WORKFLOW_LIST, {
        orgId,
        isOwner: role === "owner",
      });
      setWorkflows(data.workflows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, [client, orgId, role]);

  useEffect(() => {
    load();
    refetchUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function handleCreate() {
    if (!orgId || !newName.trim()) return;
    try {
      await client.request(CREATE_WORKFLOW, {
        orgId,
        name: newName.trim(),
        description: newDescription.trim() || null,
      });
      setNewName("");
      setNewDescription("");
      setShowNew(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workflow");
    }
  }

  if (orgLoading) {
    return <p className="text-sm text-gray-400">Loading organizations…</p>;
  }
  if (!orgId) {
    return (
      <p className="text-sm text-gray-500">
        You don&apos;t belong to any organization yet. Ask an owner to invite you.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Call flows</h1>
          <p className="text-sm text-gray-500">
            Lead-qualification and support workflows for this organization.
          </p>
        </div>
        {(role === "owner" || role === "editor") && (
          <button
            onClick={() => setShowNew((v) => !v)}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            New workflow
          </button>
        )}
      </div>

      {showNew && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Inbound Lead Qualification"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Score transcript, route hot leads, push to CRM"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleCreate}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
            >
              Create
            </button>
            <button
              onClick={() => setShowNew(false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-400">Loading workflows…</p>
      ) : workflows.length === 0 ? (
        <p className="text-sm text-gray-500">
          No call flows yet. Create one to start scoring and routing calls.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {workflows.map((wf) => {
            const lastRun = wf.runs[0];
            return (
              <div
                key={wf.id}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <Link href={`/workflows/${wf.id}`} className="block">
                    <h2 className="font-medium text-gray-900 hover:underline">{wf.name}</h2>
                    {wf.description && (
                      <p className="mt-1 text-sm text-gray-500">{wf.description}</p>
                    )}
                  </Link>
                  <RunButton workflowId={wf.id} />
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
                  <span>{wf.steps.length} steps</span>
                  <span>·</span>
                  <span>{wf.triggers.length} triggers</span>
                  {lastRun && (
                    <>
                      <span>·</span>
                      <StatusBadge status={lastRun.status} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
