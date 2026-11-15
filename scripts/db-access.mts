/** Offline local administration; no HTTP route imports this module. */
import { adminPool, provisionAccount } from "./db-admin";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "../src/lib/runtime-config";
const args = process.argv.slice(2),
  operation = args.shift() ?? "list";
const option = (name: string) => {
  const at = args.indexOf("--" + name);
  return at >= 0 ? args[at + 1] : undefined;
};
const pool = await adminPool();
try {
  if (operation === "list") {
    const rows = await pool.query(
      'SELECT m.id,m.tenant_id,t.name AS restaurant,u.email,m.display_name,m.role,m.employee_id,m.active FROM app.memberships m JOIN app.tenants t ON t.id=m.tenant_id JOIN auth."user" u ON u.id=m.user_id ORDER BY t.name,m.role,m.display_name',
    );
    console.table(rows.rows);
  } else if (operation === "provision") {
    const tenantId = option("tenant"),
      employeeId = option("employee"),
      email = option("email"),
      role = option("role") ?? "employee";
    if (
      !tenantId ||
      !email ||
      (!email.endsWith(".shiftflow.test") &&
        !email.endsWith("@shiftflow.test")) ||
      !["employee", "manager"].includes(role)
    )
      throw new Error(
        "Use --tenant UUID --email fictional@shiftflow.test --role employee|manager [--employee ID] [--name NAME].",
      );
    const row = (
      await pool.query(
        "SELECT payload FROM app.workspaces WHERE tenant_id=$1",
        [tenantId],
      )
    ).rows[0];
    if (!row) throw new Error("Unknown restaurant");
    const person = row.payload.employees.find(
      (e: { id: string }) => e.id === employeeId,
    );
    if (role === "employee" && !person)
      throw new Error(
        "Employee profile must exist in the selected restaurant.",
      );
    const name = option("name") ?? person?.name;
    if (!name) throw new Error("Manager display name is required.");
    const account = await provisionAccount(pool, {
      email,
      name,
      role: role as "manager" | "employee",
      employeeId: role === "employee" ? employeeId : undefined,
    });
    const member = randomUUID();
    await pool.query(
      "INSERT INTO app.memberships(id,tenant_id,user_id,role,employee_id,display_name) VALUES($1,$2,$3,$4,$5,$6)",
      [
        member,
        tenantId,
        account.id,
        role,
        role === "employee" ? employeeId : null,
        name,
      ],
    );
    const dir = path.join(dataDirectory(), "accounts");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, account.id + ".json");
    await writeFile(
      file,
      JSON.stringify({ ...account, membershipId: member, tenantId }, null, 2),
      { mode: 0o600, flag: "wx" },
    );
    console.log("Account provisioned. Private generated credentials: " + file);
  } else if (["disable", "enable", "role"].includes(operation)) {
    const id = option("membership");
    if (!id) throw new Error("Pass --membership UUID");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const before = (
        await c.query("SELECT * FROM app.memberships WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if (!before) throw new Error("Unknown membership");
      if (operation === "role") {
        const role = option("role"),
          employeeId = option("employee");
        if (!["manager", "employee"].includes(role ?? ""))
          throw new Error("Pass --role manager|employee");
        if (role === "employee") {
          const w = (
            await c.query(
              "SELECT payload FROM app.workspaces WHERE tenant_id=$1",
              [before.tenant_id],
            )
          ).rows[0].payload;
          if (!w.employees.some((e: { id: string }) => e.id === employeeId))
            throw new Error("Employee must belong to this restaurant.");
        }
        await c.query(
          "UPDATE app.memberships SET role=$1,employee_id=$2 WHERE id=$3",
          [role, role === "employee" ? employeeId : null, id],
        );
      } else
        await c.query("UPDATE app.memberships SET active=$1 WHERE id=$2", [
          operation === "enable",
          id,
        ]);
      const after = (
        await c.query("SELECT * FROM app.memberships WHERE id=$1", [id])
      ).rows[0];
      await c.query('DELETE FROM auth.session WHERE "userId"=$1', [
        before.user_id,
      ]);
      const at = new Date().toISOString(),
        eventId = randomUUID();
      await c.query(
        "INSERT INTO app.audit_events(tenant_id,id,at,payload) VALUES($1,$2,$3,$4)",
        [
          before.tenant_id,
          eventId,
          at,
          JSON.stringify({
            id: eventId,
            at,
            actorId: "local-database-administrator",
            message: "Membership " + operation + "; all user sessions revoked.",
            details: { before, after, databaseRole: "sf_admin" },
          }),
        ],
      );
      await c.query("COMMIT");
      console.log(
        "Membership updated; existing user sessions revoked. Administrator change recorded in PostgreSQL audit history.",
      );
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  } else throw new Error("Use list, provision, disable, enable or role.");
} finally {
  await pool.end();
}
