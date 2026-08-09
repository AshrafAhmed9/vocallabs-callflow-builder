// Shared env/URL resolution for seeds/scripts. Works against both `nhost up`
// (local dev, default ports below) and a deployed Cloud project by setting
// NHOST_SUBDOMAIN/NHOST_REGION or the raw GRAPHQL_URL/AUTH_URL env vars.
export const ADMIN_SECRET = process.env.HASURA_GRAPHQL_ADMIN_SECRET || "nhost-admin-secret";

export function graphqlUrl(): string {
  if (process.env.GRAPHQL_URL) return process.env.GRAPHQL_URL;
  const sub = process.env.NHOST_SUBDOMAIN;
  const region = process.env.NHOST_REGION;
  if (sub && region) return `https://${sub}.graphql.${region}.nhost.run/v1`;
  return "http://localhost:1337/v1/graphql";
}

export function authUrl(): string {
  if (process.env.AUTH_URL) return process.env.AUTH_URL;
  const sub = process.env.NHOST_SUBDOMAIN;
  const region = process.env.NHOST_REGION;
  if (sub && region) return `https://${sub}.auth.${region}.nhost.run/v1`;
  return "http://localhost:1337/v1/auth";
}

export const DEMO_PASSWORD = "Passw0rd!2026";
