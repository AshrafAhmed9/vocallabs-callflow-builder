"use client";

import { useState } from "react";
import { useOrg } from "@/lib/OrgContext";
import { RoleBadge } from "./RoleBadge";
import { QuotaWidget } from "./QuotaWidget";

export function OrgSwitcher() {
  const { memberships, orgId, role, switchOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const current = memberships.find((m) => m.org_id === orgId);

  if (memberships.length === 0) {
    return <span className="text-sm text-gray-400">No organizations</span>;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-gray-50"
      >
        <span className="font-medium text-gray-800">
          {current?.organization.name ?? "Select org"}
        </span>
        {role && <RoleBadge role={role} />}
        <svg width="12" height="12" viewBox="0 0 12 12" className="text-gray-400">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          <div className="mb-2 px-2">
            <QuotaWidget />
          </div>
          <ul className="max-h-64 overflow-auto">
            {memberships.map((m) => (
              <li key={m.org_id}>
                <button
                  onClick={() => {
                    switchOrg(m.org_id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50 ${
                    m.org_id === orgId ? "bg-gray-50" : ""
                  }`}
                >
                  <span>{m.organization.name}</span>
                  <RoleBadge role={m.role} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
