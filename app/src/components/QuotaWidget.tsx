"use client";

import { useOrg } from "@/lib/OrgContext";

export function QuotaWidget() {
  const { usage } = useOrg();
  if (!usage) return null;
  const pct =
    usage.quota_limit > 0
      ? Math.min(100, Math.round((usage.quota_used / usage.quota_limit) * 100))
      : 0;
  const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="w-44 text-xs">
      <div className="flex justify-between text-gray-500">
        <span>Quota</span>
        <span>
          {usage.quota_used} / {usage.quota_limit}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
