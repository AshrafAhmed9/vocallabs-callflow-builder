"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { configureSubscriptionAuth, makeGraphQLClient } from "./graphql-client";
import { MY_MEMBERSHIPS, ORG_USAGE } from "./queries";
import type { OrgMembership, OrgRole, OrgUsage } from "./types";

interface OrgContextValue {
  memberships: OrgMembership[];
  orgId: string | null;
  role: OrgRole | null;
  usage: OrgUsage | null;
  isLoading: boolean;
  switchOrg: (orgId: string) => void;
  refetchMemberships: () => Promise<void>;
  refetchUsage: () => Promise<void>;
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined);

const STORAGE_KEY = "vocallabs.selectedOrgId";

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user, accessToken } = useAuth();
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [usage, setUsage] = useState<OrgUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const role = useMemo(
    () => memberships.find((m) => m.org_id === orgId)?.role ?? null,
    [memberships, orgId]
  );

  // Always give subscriptions access to the *current* token/role via a
  // getter (avoids re-creating the ws client on every change).
  useEffect(() => {
    configureSubscriptionAuth(() => ({ accessToken, orgRole: role }));
  }, [accessToken, role]);

  const refetchMemberships = useCallback(async () => {
    if (!user || !accessToken) {
      setMemberships([]);
      setOrgId(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      // Membership lookup itself doesn't need x-hasura-role scoped to a
      // specific org yet, "user" role (default post-login) is sufficient;
      // Hasura permissions on org_members filter by user_id = the JWT claim.
      const client = makeGraphQLClient({ accessToken, orgRole: null });
      const data = await client.request<{ org_members: OrgMembership[] }>(
        MY_MEMBERSHIPS,
        { uid: user.id }
      );
      const list = data.org_members ?? [];
      setMemberships(list);
      setOrgId((prev) => {
        const stored =
          typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
        const candidate = prev ?? stored;
        if (candidate && list.some((m) => m.org_id === candidate)) return candidate;
        return list[0]?.org_id ?? null;
      });
    } catch {
      setMemberships([]);
    } finally {
      setIsLoading(false);
    }
  }, [user, accessToken]);

  const refetchUsage = useCallback(async () => {
    if (!orgId || !accessToken || !role) {
      setUsage(null);
      return;
    }
    try {
      const client = makeGraphQLClient({ accessToken, orgRole: role });
      const data = await client.request<{
        organizations_by_pk: { usage: OrgUsage | null } | null;
      }>(ORG_USAGE, { orgId });
      setUsage(data.organizations_by_pk?.usage ?? null);
    } catch {
      setUsage(null);
    }
  }, [orgId, accessToken, role]);

  useEffect(() => {
    refetchMemberships();
  }, [refetchMemberships]);

  useEffect(() => {
    refetchUsage();
  }, [refetchUsage]);

  const switchOrg = useCallback((next: string) => {
    setOrgId(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  return (
    <OrgContext.Provider
      value={{
        memberships,
        orgId,
        role,
        usage,
        isLoading,
        switchOrg,
        refetchMemberships,
        refetchUsage,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}

/** Convenience hook returning a GraphQL client bound to current auth + org role. */
export function useGqlClient() {
  const { accessToken } = useAuth();
  const { role } = useOrg();
  return useMemo(() => makeGraphQLClient({ accessToken, orgRole: role }), [accessToken, role]);
}
