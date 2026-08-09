"use client";

import { useState } from "react";
import type { StepType, WorkflowStep } from "@/lib/types";

const STEP_TYPE_LABELS: Record<StepType, string> = {
  llm_call: "LLM call (score / summarize transcript)",
  http_request: "HTTP request",
  db_write: "Database write",
  notify: "Notify (rep alert)",
  conditional_branch: "Conditional branch (hot/cold routing)",
  approval_gate: "Supervisor approval gate",
};

const OPERATORS = ["equals", "not_equals", "greater_than", "less_than", "contains"];

interface Props {
  step: WorkflowStep;
  canEdit: boolean;
  onSave: (name: string, config: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (direction: "up" | "down") => Promise<void>;
  isFirst: boolean;
  isLast: boolean;
}

export function StepEditor({ step, canEdit, onSave, onDelete, onMove, isFirst, isLast }: Props) {
  const [name, setName] = useState(step.name);
  const [config, setConfig] = useState<Record<string, unknown>>(step.config ?? {});
  const [jsonText, setJsonText] = useState(JSON.stringify(step.config ?? {}, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(nextConfig: Record<string, unknown>) {
    setSaving(true);
    try {
      await onSave(name, nextConfig);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
              {step.position + 1}
            </span>
            <input
              value={name}
              disabled={!canEdit}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => canEdit && save(config)}
              className="flex-1 rounded-md border border-transparent px-1 py-0.5 text-sm font-medium hover:border-gray-200 focus:border-gray-300 focus:outline-none disabled:bg-transparent"
            />
          </div>
          <p className="ml-7 mt-0.5 text-xs text-gray-500">{STEP_TYPE_LABELS[step.type]}</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <button
              disabled={isFirst}
              onClick={() => onMove("up")}
              className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30"
            >
              ↑
            </button>
            <button
              disabled={isLast}
              onClick={() => onMove("down")}
              className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30"
            >
              ↓
            </button>
            <button
              onClick={onDelete}
              className="rounded border border-red-200 px-1.5 py-0.5 text-xs text-red-600"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="ml-7 mt-3">
        {step.type === "llm_call" ? (
          <label className="block text-xs font-medium text-gray-500">
            Prompt
            <textarea
              disabled={!canEdit}
              value={(config.prompt as string) ?? ""}
              onChange={(e) => setConfig({ ...config, prompt: e.target.value })}
              onBlur={() => canEdit && save(config)}
              rows={3}
              placeholder="Score this call transcript 0-100 for purchase intent and summarize the lead's stated needs…"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
        ) : step.type === "conditional_branch" ? (
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs font-medium text-gray-500">
              Field
              <input
                disabled={!canEdit}
                value={(config.field as string) ?? ""}
                onChange={(e) => setConfig({ ...config, field: e.target.value })}
                onBlur={() => canEdit && save(config)}
                placeholder="lead_score"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-gray-500">
              Operator
              <select
                disabled={!canEdit}
                value={(config.operator as string) ?? OPERATORS[0]}
                onChange={(e) => {
                  const next = { ...config, operator: e.target.value };
                  setConfig(next);
                  canEdit && save(next);
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                {OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {op.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-gray-500">
              Value
              <input
                disabled={!canEdit}
                value={(config.value as string) ?? ""}
                onChange={(e) => setConfig({ ...config, value: e.target.value })}
                onBlur={() => canEdit && save(config)}
                placeholder="70 (hot lead threshold)"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        ) : (
          <label className="block text-xs font-medium text-gray-500">
            Config (JSON)
            <textarea
              disabled={!canEdit}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              onBlur={() => {
                try {
                  const parsed = JSON.parse(jsonText || "{}");
                  setJsonError(null);
                  setConfig(parsed);
                  if (canEdit) save(parsed);
                } catch {
                  setJsonError("Invalid JSON");
                }
              }}
              rows={3}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs"
            />
            {jsonError && <span className="text-xs text-red-600">{jsonError}</span>}
          </label>
        )}
        {saving && <span className="mt-1 block text-[11px] text-gray-400">Saving…</span>}
      </div>
    </div>
  );
}
