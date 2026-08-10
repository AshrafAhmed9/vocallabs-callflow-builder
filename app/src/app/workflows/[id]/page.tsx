"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useOrg, useGqlClient } from "@/lib/OrgContext";
import {
  CREATE_STEP,
  DELETE_STEP,
  UPDATE_STEP,
  UPDATE_STEP_POSITION,
  UPSERT_TRIGGER,
  WORKFLOW_DETAIL,
} from "@/lib/queries";
import type { StepType, Workflow, WorkflowStep } from "@/lib/types";
import { RunButton } from "@/components/RunButton";
import { StatusBadge } from "@/components/StatusBadge";
import { StepEditor } from "@/components/StepEditor";
import { TriggerEditor } from "@/components/TriggerEditor";

const ALL_STEP_TYPES: { type: StepType; label: string; ownerOnly?: boolean }[] = [
  { type: "llm_call", label: "LLM call" },
  { type: "http_request", label: "HTTP request" },
  { type: "conditional_branch", label: "Conditional branch" },
  { type: "approval_gate", label: "Approval gate" },
  { type: "db_write", label: "Database write", ownerOnly: true },
  { type: "notify", label: "Notify", ownerOnly: true },
];

export default function WorkflowBuilderPage({
  params,
}: PageProps<"/workflows/[id]">) {
  const { id } = use(params);
  const { role } = useOrg();
  const client = useGqlClient();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canEdit = role === "owner" || role === "editor";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.request<{ workflows_by_pk: Workflow | null }>(
        WORKFLOW_DETAIL,
        { id, isOwner: role === "owner" }
      );
      setWorkflow(data.workflows_by_pk);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflow");
    } finally {
      setLoading(false);
    }
  }, [client, id, role]);

  useEffect(() => {
    load();
  }, [load]);

  async function addStep(type: StepType) {
    if (!workflow) return;
    const position = workflow.steps.length;
    await client.request(CREATE_STEP, {
      workflowId: workflow.id,
      position,
      type,
      name: ALL_STEP_TYPES.find((t) => t.type === type)?.label ?? type,
      config: {},
    });
    load();
  }

  async function saveStep(step: WorkflowStep, name: string, config: Record<string, unknown>) {
    await client.request(UPDATE_STEP, { id: step.id, name, config });
    load();
  }

  async function deleteStep(step: WorkflowStep) {
    await client.request(DELETE_STEP, { id: step.id });
    load();
  }

  async function moveStep(step: WorkflowStep, direction: "up" | "down") {
    if (!workflow) return;
    const steps = [...workflow.steps].sort((a, b) => a.position - b.position);
    const index = steps.findIndex((s) => s.id === step.id);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= steps.length) return;
    const other = steps[swapWith];
    await Promise.all([
      client.request(UPDATE_STEP_POSITION, { id: step.id, position: other.position }),
      client.request(UPDATE_STEP_POSITION, { id: other.id, position: step.position }),
    ]);
    load();
  }

  async function saveTrigger(
    trigger: Workflow["triggers"][number],
    config: Record<string, unknown>,
    enabled: boolean
  ) {
    await client.request(UPSERT_TRIGGER, {
      workflowId: id,
      type: trigger.type,
      config,
      enabled,
    });
    load();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading workflow…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!workflow) return <p className="text-sm text-gray-500">Workflow not found.</p>;

  const sortedSteps = [...workflow.steps].sort((a, b) => a.position - b.position);
  const lastRun = workflow.runs[0];
  const addableTypes = ALL_STEP_TYPES.filter((t) => !t.ownerOnly || role === "owner");

  return (
    <div>
      <div className="mb-2">
        <Link href="/workflows" className="text-sm text-gray-500 hover:underline">
          ← Call flows
        </Link>
      </div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{workflow.name}</h1>
          {workflow.description && (
            <p className="mt-1 text-sm text-gray-500">{workflow.description}</p>
          )}
          {lastRun && (
            <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
              Last run <StatusBadge status={lastRun.status} />
              <Link
                href={`/workflows/${workflow.id}/runs/${lastRun.id}`}
                className="text-gray-500 hover:underline"
              >
                view
              </Link>
            </div>
          )}
        </div>
        <RunButton workflowId={workflow.id} />
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Steps</h2>
          <div className="space-y-3">
            {sortedSteps.map((step, i) => (
              <StepEditor
                key={step.id}
                step={step}
                canEdit={canEdit}
                isFirst={i === 0}
                isLast={i === sortedSteps.length - 1}
                onSave={(name, config) => saveStep(step, name, config)}
                onDelete={() => deleteStep(step)}
                onMove={(dir) => moveStep(step, dir)}
              />
            ))}
            {sortedSteps.length === 0 && (
              <p className="text-sm text-gray-400">No steps yet.</p>
            )}
          </div>

          {canEdit && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-gray-500">Add step</p>
              <div className="flex flex-wrap gap-2">
                {addableTypes.map((t) => (
                  <button
                    key={t.type}
                    onClick={() => addStep(t.type)}
                    className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    + {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Triggers</h2>
          <div className="space-y-3">
            {workflow.triggers.map((trigger) => (
              <TriggerEditor
                key={trigger.id}
                trigger={trigger}
                role={role}
                onSave={(config, enabled) => saveTrigger(trigger, config, enabled)}
              />
            ))}
            {workflow.triggers.length === 0 && (
              <p className="text-sm text-gray-400">
                Manual run is always available. No other triggers configured.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
