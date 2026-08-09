import { GraphQLClient } from "graphql-request";
import { authUrl, graphqlUrl, DEMO_PASSWORD } from "./env";

export interface Session {
  accessToken: string;
  userId: string;
  client: GraphQLClient;
}

export async function signIn(email: string, password: string = DEMO_PASSWORD): Promise<Session> {
  const res = await fetch(`${authUrl()}/signin/email-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json: any = await res.json();
  if (!res.ok) {
    throw new Error(`signin failed for ${email}: ${JSON.stringify(json)}`);
  }
  const accessToken = json.session.accessToken;
  const userId = json.session.user.id;
  const client = new GraphQLClient(graphqlUrl(), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return { accessToken, userId, client };
}

export function clientWithHeaders(headers: Record<string, string>): GraphQLClient {
  return new GraphQLClient(graphqlUrl(), { headers });
}
