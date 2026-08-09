"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthProvider";
import { OrgSwitcher } from "./OrgSwitcher";

export function NavBar() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/workflows" className="flex items-center gap-2">
          <span className="text-lg font-semibold tracking-tight text-gray-900">
            VocalLabs
          </span>
          <span className="text-sm text-gray-400">Call Flow Builder</span>
        </Link>
        {user && (
          <div className="flex items-center gap-4">
            <OrgSwitcher />
            <span className="hidden text-sm text-gray-500 sm:inline">{user.email}</span>
            <button
              onClick={async () => {
                await signOut();
                router.push("/login");
              }}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
