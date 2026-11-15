/** Compatibility import path; demo sessions are no longer accepted. */
import { getAuth } from "./auth";
import { appPool } from "./database";
import { AccessError, type Actor } from "./auth-context";
export { AccessError };
export const tenantCookie = "shiftflow-tenant";
export async function sessionInfo(request: Request) {
  const session = await getAuth().api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  if (!session) return { session: null, memberships: [] };
  const client = await appPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [
      session.user.id,
    ]);
    const rows = await client.query("SELECT * FROM app.my_memberships()");
    await client.query("COMMIT");
    return { session, memberships: rows.rows };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export function selectedTenant(request: Request) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(tenantCookie + "="))
    ?.slice(tenantCookie.length + 1);
}
export async function resolveSession(request: Request) {
  const info = await sessionInfo(request);
  if (!info.session) return { ...info, actor: null };
  const selected = selectedTenant(request),
    m = selected
      ? info.memberships.find((m) => m.tenant_id === selected)
      : info.memberships[0];
  const actor: Actor | null = m
    ? {
        id: m.role === "employee" ? m.employee_id : m.id,
        userId: info.session.user.id,
        sessionId: info.session.session.id,
        membershipId: m.id,
        tenantId: m.tenant_id,
        tenantName: m.tenant_name,
        email: info.session.user.email,
        role: m.role,
        name: m.display_name,
      }
    : null;
  return { ...info, actor };
}
export async function requireActor(request: Request) {
  const info = await resolveSession(request);
  if (!info.session) throw new AccessError("Sign in to continue.", 401);
  if (!info.actor)
    throw new AccessError(
      "No active membership for this restaurant. Select an authorized restaurant.",
    );
  return info.actor;
}
export async function requireManager(request: Request) {
  const actor = await requireActor(request);
  if (actor.role !== "manager")
    throw new AccessError("Manager access is required.");
  return actor;
}
