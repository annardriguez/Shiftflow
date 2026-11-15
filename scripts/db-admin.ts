/** Offline provisioning only. Never imported by an HTTP route or client component. */
import { Pool } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import { dataDirectory } from "../src/lib/runtime-config";
import { migrateWorkspace } from "../src/lib/migrate";
import type { Workspace } from "../src/lib/types";
export interface ProvisionedAccount {
  id: string;
  actorId: string;
  email: string;
  password: string;
  name: string;
  role: "manager" | "employee";
  employeeId?: string;
}
export async function adminPool(directory = dataDirectory()) {
  const a = JSON.parse(
    await readFile(path.join(directory, "postgres-admin.json"), "utf8"),
  );
  return new Pool({
    host: "127.0.0.1",
    port: a.port,
    user: "sf_admin",
    password: a.password,
    database: new URL(
      JSON.parse(
        await readFile(path.join(directory, "runtime.json"), "utf8"),
      ).appDatabaseUrl,
    ).pathname.slice(1),
    max: 2,
  });
}
export async function provisionAccount(
  pool: Pool,
  info: {
    email: string;
    name: string;
    role: "manager" | "employee";
    employeeId?: string;
    password?: string;
    id?: string;
  },
): Promise<ProvisionedAccount> {
  info = { ...info, email: info.email.trim().toLowerCase() };
  const old = await pool.query('SELECT id FROM auth."user" WHERE email=$1', [
    info.email,
  ]);
  if (old.rowCount)
    throw new Error(
      "Account already exists; provisioning never resets an existing password.",
    );
  const id = info.id ?? randomUUID(),
    password = info.password ?? randomBytes(18).toString("base64url"),
    hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      'INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',
      [id, info.name, info.email],
    );
    await client.query(
      'INSERT INTO auth.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',
      [randomUUID(), id, hash],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { ...info, id, password, actorId: info.employeeId ?? "" };
}
export async function provisionTenant(
  pool: Pool,
  input: Workspace,
  name: string,
  accounts: ProvisionedAccount[],
  id = randomUUID(),
) {
  const workspace = structuredClone(migrateWorkspace(input));
  workspace.tenantId = id;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("INSERT INTO app.tenants(id,name) VALUES($1,$2)", [id, name]);
    await c.query(
      "INSERT INTO app.workspaces(tenant_id,revision,payload) VALUES($1,$2,$3)",
      [id, workspace.revision, JSON.stringify(workspace)],
    );
    const actors: Record<string, string> = {};
    for (const a of accounts) {
      const member = randomUUID();
      await c.query(
        "INSERT INTO app.memberships(id,tenant_id,user_id,role,employee_id,display_name) VALUES($1,$2,$3,$4,$5,$6)",
        [member, id, a.id, a.role, a.employeeId ?? null, a.name],
      );
      actors[a.employeeId ?? "demo-manager"] = a.employeeId ?? member;
    }
    for (const e of workspace.audit)
      await c.query(
        "INSERT INTO app.audit_events(tenant_id,id,at,payload) VALUES($1,$2,$3,$4)",
        [id, e.id, e.at, JSON.stringify(e)],
      );
    for (const r of workspace.requests ?? [])
      for (let i = 0; i < r.history.length; i++)
        await c.query(
          "INSERT INTO app.request_events(tenant_id,request_id,event_index,payload) VALUES($1,$2,$3,$4)",
          [id, r.id, i, JSON.stringify(r.history[i])],
        );
    await c.query("COMMIT");
    return { id, workspace, actors };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
