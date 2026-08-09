"use client";

import { GraphQLClient } from "graphql-request";
import { createClient as createWsClient, type Client as WsClient } from "graphql-ws";
import { NHOST_GRAPHQL_URL, NHOST_GRAPHQL_WS_URL } from "./env";

export type OrgRole = "owner" | "editor" | "viewer";

export interface GqlHeaders {
  accessToken: string | null;
  orgRole: OrgRole | null;
}

/**
 * Returns a graphql-request client configured with the current auth + org
 * headers. Callers should re-create/re-derive this whenever the access token
 * or selected org role changes (see OrgContext / useAuth).
 */
export function makeGraphQLClient({ accessToken, orgRole }: GqlHeaders) {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (orgRole) headers["x-hasura-role"] = orgRole;
  return new GraphQLClient(NHOST_GRAPHQL_URL, { headers });
}

/**
 * Lazily creates (and caches) a single graphql-ws client. graphql-ws supports
 * dynamically resolving connectionParams per-connection via a function, so we
 * pass a getter that always reads the *current* token/role instead of baking
 * them in at creation time.
 */
let wsClient: WsClient | null = null;
let getAuthParams: () => GqlHeaders = () => ({ accessToken: null, orgRole: null });

export function configureSubscriptionAuth(getter: () => GqlHeaders) {
  getAuthParams = getter;
}

export function getWsClient(): WsClient {
  if (wsClient) return wsClient;
  wsClient = createWsClient({
    url: NHOST_GRAPHQL_WS_URL,
    connectionParams: () => {
      const { accessToken, orgRole } = getAuthParams();
      const headers: Record<string, string> = {};
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      if (orgRole) headers["x-hasura-role"] = orgRole;
      // Hasura's graphql-ws implementation reads auth from connectionParams
      // headers (or top-level "headers" key depending on version) - we send
      // both shapes for compatibility.
      return { headers, Authorization: headers.Authorization, "x-hasura-role": orgRole ?? undefined };
    },
  });
  return wsClient;
}

export function resetWsClient() {
  wsClient?.dispose();
  wsClient = null;
}
