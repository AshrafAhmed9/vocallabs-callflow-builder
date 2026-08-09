const COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700 ring-gray-300",
  running: "bg-blue-100 text-blue-700 ring-blue-300",
  paused: "bg-amber-100 text-amber-700 ring-amber-300",
  awaiting_approval: "bg-purple-100 text-purple-700 ring-purple-300",
  completed: "bg-emerald-100 text-emerald-700 ring-emerald-300",
  failed: "bg-red-100 text-red-700 ring-red-300",
  skipped: "bg-slate-100 text-slate-500 ring-slate-300",
};

export function StatusBadge({ status }: { status: string }) {
  const classes = COLORS[status] ?? "bg-gray-100 text-gray-700 ring-gray-300";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${classes}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
