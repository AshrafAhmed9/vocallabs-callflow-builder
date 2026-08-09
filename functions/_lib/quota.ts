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

const CONSUME_QUOTA_SQL = /* GraphQL */ `
  mutation ConsumeQuota($orgId: uuid!, $amount: Int!) {
    consume_org_quota(args: { p_org_id: $orgId, p_amount: $amount }) {
      consume_org_quota
    }
  }
`;

// consume_org_quota() is exposed as a Hasura custom function; if it hasn't
// been tracked as a query/mutation function we fall back to raw SQL via
// run_sql (admin only). We try the GraphQL function first.
export async function consumeOrgQuota(
  orgId: string,
  amount = 1
): Promise<boolean> {
  try {
    const data = await adminRequest<{
      consume_org_quota: { consume_org_quota: boolean }[];
    }>(CONSUME_QUOTA_SQL, { orgId, amount });
    return Boolean(data.consume_org_quota?.[0]?.consume_org_quota ?? true);
  } catch {
    // Fallback: call the SQL function directly via Hasura's /v2/query (admin).
    const url = (process.env.NHOST_GRAPHQL_URL || "http://localhost:1337/v1/graphql").replace(
      /\/v1\/graphql$/,
      "/v2/query"
    );
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
    const json: any = await res.json();
    const val = json?.result?.[1]?.[0];
    return val === "t" || val === true;
  }
}
