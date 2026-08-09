// Admin GraphQL client used by all serverless functions.
//
// IMPORTANT: calls made with the admin secret bypass every Hasura row
// permission we defined in nhost/metadata. That's exactly why every
// handler that uses this client re-derives the caller's org membership
// and role in code before doing anything — see trigger-workflow-run,
// approve-step, webhook-trigger and on-inbound-call.
import { GraphQLClient } from "graphql-request";

function requiredEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function graphqlUrl(): string {
  return (
    process.env.NHOST_GRAPHQL_URL ||
    process.env.HASURA_GRAPHQL_URL ||
    "http://localhost:1337/v1/graphql"
  );
}

export function authUrl(): string {
  return process.env.NHOST_AUTH_URL || "http://localhost:1337/v1/auth";
}

let client: GraphQLClient | null = null;

export function adminClient(): GraphQLClient {
  if (client) return client;
  const url = graphqlUrl();
  const adminSecret = requiredEnv("HASURA_GRAPHQL_ADMIN_SECRET");
  client = new GraphQLClient(url, {
    headers: {
      "x-hasura-admin-secret": adminSecret,
    },
  });
  return client;
}

export async function adminRequest<T = any>(
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  return adminClient().request<T>(query, variables);
}
