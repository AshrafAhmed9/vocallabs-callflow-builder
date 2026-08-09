// Shared authorization helpers. Every Action handler MUST call one of these
// before mutating anything, because Hasura Actions run outside the row
// permission system entirely (the action's own GraphQL layer only checks
// "who is allowed to CALL this action", not "what org data may they touch").
import { adminRequest } from "./admin-client";

export type MemberRole = "owner" | "editor" | "viewer";

const GET_MEMBERSHIP = /* GraphQL */ `
  query GetMembership($orgId: uuid!, $userId: uuid!) {
    org_members(where: { org_id: { _eq: $orgId }, user_id: { _eq: $userId } }) {
      role
    }
  }
`;

export async function getMembershipRole(
  orgId: string,
  userId: string
): Promise<MemberRole | null> {
  const data = await adminRequest<{ org_members: { role: MemberRole }[] }>(
    GET_MEMBERSHIP,
    { orgId, userId }
  );
  return data.org_members[0]?.role ?? null;
}

export async function requireRole(
  orgId: string,
  userId: string,
  allowed: MemberRole[]
): Promise<MemberRole> {
  const role = await getMembershipRole(orgId, userId);
  if (!role || !allowed.includes(role)) {
    const err: any = new Error(
      `Not authorized: user is not a member of org ${orgId} with an allowed role (${allowed.join(
        ", "
      )})`
    );
    err.statusCode = 403;
    throw err;
  }
  return role;
}

export function getSessionUserId(body: any): string | null {
  return (
    body?.session_variables?.["x-hasura-user-id"] ??
    body?.sessionVariables?.["x-hasura-user-id"] ??
    null
  );
}
