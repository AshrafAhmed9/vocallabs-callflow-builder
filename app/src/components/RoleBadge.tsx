const COLORS: Record<string, string> = {
  owner: "bg-violet-100 text-violet-700",
  editor: "bg-sky-100 text-sky-700",
  viewer: "bg-gray-100 text-gray-600",
};

export function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
        COLORS[role] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {role}
    </span>
  );
}
