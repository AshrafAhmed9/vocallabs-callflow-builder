import { adminRequest } from "./admin-client";

const GET_ORG_QUOTA = /* GraphQL */ `
  query GetOrgQuota($orgId: uuid!) {
    organizations_by_pk(id: $orgId) {
      quota_used
      quota_limit
    }
  }
`;

// Read-only check: does NOT consume quota. Quota is only actually consumed
// (via the DB's consume_org_quota() function, which does SELECT...FOR UPDATE)
// when a run completes — see executor.ts.
export async function hasQuotaAvailable(orgId: string): Promise<boolean> {
  const data = await adminRequest<{
    organizations_by_pk: { quota_used: number; quota_limit: number } | null;
  }>(GET_ORG_QUOTA, { orgId });
  const org = data.organizations_by_pk;
  if (!org) return false;
  return org.quota_used < org.quota_limit;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// consume_org_quota() returns a plain boolean, which Hasura's GraphQL layer
// cannot expose as a tracked custom mutation (it requires a composite/table
// return type) — so this always goes through Hasura's /v2/query run_sql
// endpoint (admin only). orgId is validated as a UUID before interpolation
// since run_sql has no parameter binding.
export async function consumeOrgQuota(
  orgId: string,
  amount = 1
): Promise<boolean> {
  if (!UUID_RE.test(orgId)) throw new Error(`consumeOrgQuota: invalid orgId "${orgId}"`);
  if (!Number.isInteger(amount) || amount < 1) throw new Error(`consumeOrgQuota: invalid amount ${amount}`);

  // Strip whatever trailing /v1 or /v1/graphql the base GraphQL URL has,
  // robustly, rather than matching one exact suffix.
  const base = (process.env.NHOST_GRAPHQL_URL || "http://localhost:1337/v1/graphql").replace(
    /\/v1(\/graphql)?\/?$/,
    ""
  );
  const url = `${base}/v2/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hasura-admin-secret": process.env.HASURA_GRAPHQL_ADMIN_SECRET || "",
    },
    body: JSON.stringify({
      type: "run_sql",
      args: {
        source: "default",
        sql: `select public.consume_org_quota('${orgId}', ${amount});`,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`consume_org_quota run_sql failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const json: any = await res.json();
  const val = json?.result?.[1]?.[0];
  return val === "t" || val === true;
}
