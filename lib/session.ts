import { GraphQLClient } from "graphql-request";
import { authUrl, graphqlUrl, DEMO_PASSWORD } from "./env";

export interface Session {
  accessToken: string;
  userId: string;
  client: GraphQLClient;
}

export async function signIn(
  email: string,
  password: string = DEMO_PASSWORD,
  role?: string
): Promise<Session> {
  const res = await fetch(`${authUrl()}/signin/email-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`signin failed for ${email}: ${res.status} ${text || "(empty body — likely rate-limited)"}`);
  }
  const json: any = JSON.parse(text);
  const accessToken = json.session.accessToken;
  const userId = json.session.user.id;
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  if (role) headers["x-hasura-role"] = role;
  const client = new GraphQLClient(graphqlUrl(), { headers });
  return { accessToken, userId, client };
}

export function clientWithHeaders(headers: Record<string, string>): GraphQLClient {
  return new GraphQLClient(graphqlUrl(), { headers });
}
