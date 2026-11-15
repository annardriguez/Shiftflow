import { Pool, type PoolClient } from "pg";
import { runtimeConfig } from "./runtime-config";
import { actorContext, AccessError } from "./auth-context";
const cache = globalThis as typeof globalThis & { shiftflowPg?: Pool };
export function appPool() {
  return (cache.shiftflowPg ??= new Pool({
    connectionString: runtimeConfig().appDatabaseUrl,
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    options: "-c search_path=app,pg_catalog",
  }).on("error", () =>
    console.error("Local PostgreSQL connection interrupted."),
  ));
}
export async function tenantTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  manager = false,
): Promise<T> {
  const actor = actorContext(),
    client = await appPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true),set_config('lock_timeout','10000',true),set_config('statement_timeout','20000',true)",
      [actor.userId, actor.tenantId],
    );
    const membership = await client.query(
      "SELECT app.lock_context($1,$2) AS member",
      [actor.membershipId, actor.sessionId],
    );
    const row = membership.rows[0]?.member;
    if (
      !row ||
      row.role !== actor.role ||
      (row.role === "employee" && row.employee_id !== actor.id) ||
      (manager && row.role !== "manager")
    )
      throw new AccessError(
        "Restaurant membership or role changed. Reload or select another restaurant.",
      );
    const value = await work(client);
    await client.query("SELECT app.lock_context($1,$2)", [
      actor.membershipId,
      actor.sessionId,
    ]);
    await client.query("COMMIT");
    return value;
  } catch (e) {
    await client.query("ROLLBACK");
    if ((e as { code?: string }).code === "28000")
      throw new AccessError("Session expired or revoked.", 401);
    throw e;
  } finally {
    client.release();
  }
}
export async function membershipNames() {
  return tenantTransaction(async (c) =>
    Object.fromEntries(
      (await c.query("SELECT * FROM app.member_names()")).rows.map((r) => [
        r.actor_id,
        r.display_name,
      ]),
    ),
  );
}
