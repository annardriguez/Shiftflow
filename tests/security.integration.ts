import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const exec = promisify(execFile);
import { spawn, type ChildProcess } from "node:child_process";
import { PgHarness, freePort } from "./pg-harness";
import { workflowFixture } from "./workforce-fixture";
import { provisionAccount, provisionTenant } from "../scripts/db-admin";
let h: PgHarness,
  tenantA: string,
  tenantB: string,
  app: Pool,
  second: ChildProcess | undefined;
before(async () => {
  h = await PgHarness.create(workflowFixture());
  tenantA = h.tenantId;
  const b = workflowFixture();
  b.restaurant.name = "Other Restaurant";
  b.employees = b.employees.map((e) => ({ ...e, name: "Other " + e.name }));
  const bm = await provisionAccount(h.pool, {
    email: "other-manager@shiftflow.test",
    name: "Other Manager",
    role: "manager",
  });
  const be = await provisionAccount(h.pool, {
    email: "other-employee@shiftflow.test",
    name: "Other Employee",
    role: "employee",
    employeeId: "emp-1",
  });
  h.accounts["other-manager"] = bm;
  h.accounts["other-employee"] = be;
  tenantB = (await provisionTenant(h.pool, b, "Other Restaurant", [bm, be])).id;
  const multi = await provisionAccount(h.pool, {
    email: "multi@shiftflow.test",
    name: "Multi Restaurant User",
    role: "manager",
  });
  h.accounts.multi = multi;
  await h.pool.query(
    "INSERT INTO app.memberships(id,tenant_id,user_id,role,employee_id,display_name) VALUES($1,$2,$3,'manager',null,$4),($5,$6,$3,'employee','emp-2',$4)",
    [randomUUID(), tenantA, multi.id, multi.name, randomUUID(), tenantB],
  );
  const config = JSON.parse(
    await readFile(path.join(h.directory, "runtime.json"), "utf8"),
  );
  app = new Pool({ connectionString: config.appDatabaseUrl, max: 2 });
  await h.start();
});
after(async () => {
  if (second && second.exitCode === null) {
    const ended = new Promise((r) => second!.once("exit", r));
    second.kill("SIGTERM");
    await ended;
  }
  await app?.end();
  if (h) await h.dispose();
});
async function manager() {
  h.tenantId = tenantA;
  await h.login("demo-manager");
}
async function post(url: string, body: unknown) {
  return h.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: h.base },
    body: JSON.stringify(body),
  });
}
test(
  "authentication, roles, PostgreSQL RLS and tenant boundaries",
  { timeout: 120000 },
  async (t) => {
    await t.test(
      "no automatic manager sessions, legacy selector or public registration",
      async () => {
        const r = await globalThis.fetch(h.base + "/api/session");
        const session = await r.json();
        assert.equal(session.actor, null);
        assert.equal(r.headers.get("set-cookie"), null);
        assert.equal(
          (await globalThis.fetch(h.base + "/api/workspace")).status,
          401,
        );
        assert.equal(
          (await post("/api/demo-session", { id: "demo-manager" })).status,
          410,
        );
        assert.equal(
          (
            await post("/api/auth/sign-up/email", {
              email: "intruder@shiftflow.test",
              password: "not-a-real-password",
              name: "Intruder",
              role: "manager",
            })
          ).status,
          404,
        );
      },
    );
    await t.test(
      "correct password required; cookies protected; forged claims cannot grant manager access",
      async () => {
        const a = h.accounts["emp-1"];
        const bad = await post("/api/auth/sign-in/email", {
          email: a.email,
          password: "not-the-correct-password",
        });
        assert.equal(bad.status, 401);
        await manager();
        const cookie = [...h.cookies.values()][0];
        assert.ok(cookie);
        const response = await post("/api/auth/sign-in/email", {
          email: a.email,
          password: a.password,
        });
        assert.equal(response.status, 200);
        const headers = response.headers.getSetCookie().join(";").toLowerCase();
        assert.match(headers, /httponly/);
        assert.match(headers, /samesite=strict/);
        const employee = await h.fetch("/api/workspace", {
          headers: {
            "x-role": "manager",
            "x-user-id": h.accounts["demo-manager"].id,
          },
        });
        assert.equal(employee.status, 403);
        assert.equal(
          (
            await post("/api/workspace", {
              type: "budgets",
              week: "2026-11-16",
              budgets: [12, 12, 12, 12, 12, 12, 12],
              revision: 0,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await post("/api/session/tenant", {
              tenantId: tenantB,
              role: "manager",
            })
          ).status,
          422,
        );
      },
    );
    await t.test(
      "foreign tenant selection, cookies, headers and run IDs are denied",
      async () => {
        await manager();
        assert.equal(
          (await post("/api/session/tenant", { tenantId: tenantB })).status,
          403,
        );
        assert.equal(
          (
            await h.fetch("/api/workspace", {
              headers: { "x-shiftflow-tenant": tenantB },
            })
          ).status,
          409,
        );
        const w = await h.workspace();
        assert.equal(
          (
            await post("/api/workspace", {
              type: "budgets",
              week: "2026-11-16",
              budgets: [12, 12, 12, 12, 12, 12, 12],
              revision: w.revision,
              tenantId: tenantB,
            })
          ).status,
          403,
        );
        const id = randomUUID();
        await h.pool.query(
          "INSERT INTO app.schedule_runs(tenant_id,id,payload,created_at) VALUES($1,$2,$3,now())",
          [
            tenantB,
            id,
            JSON.stringify({
              id,
              week: "2026-11-16",
              revision: 0,
              createdAt: new Date().toISOString(),
              alternatives: [],
            }),
          ],
        );
        assert.equal(
          (
            await post("/api/planning", {
              action: "validate",
              id,
              strategy: "balanced",
              shifts: [],
            })
          ).status,
          422,
        );
        assert.ok(
          !(await (await h.fetch("/api/planning")).json()).some(
            (r: any) => r.id === id,
          ),
        );
        h.cookies.set("shiftflow-tenant", tenantB);
        h.tenantId = tenantB;
        assert.equal((await h.fetch("/api/workspace")).status, 403);
        await manager();
      },
    );
    await t.test(
      "same employee IDs and request IDs cannot cross tenant boundaries",
      async () => {
        await h.login("emp-1");
        const feed = await (await h.fetch("/api/workforce")).json();
        assert.equal(feed.employee.name, "Nora de Vries");
        assert.equal(feed.employees, undefined);
        const privateId = randomUUID();
        const w = (
          await h.pool.query(
            "SELECT payload FROM app.workspaces WHERE tenant_id=$1",
            [tenantB],
          )
        ).rows[0].payload;
        w.revision++;
        w.requests = [
          {
            id: privateId,
            status: "pending-manager",
            requesterId: "emp-1",
            version: 0,
            kind: "time-off",
            dates: ["2026-11-17"],
            history: [],
            note: "Private to other restaurant",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            externalSync: "not_connected",
          },
        ];
        await h.pool.query(
          "UPDATE app.workspaces SET payload=$1,revision=$2 WHERE tenant_id=$3",
          [JSON.stringify(w), w.revision, tenantB],
        );
        assert.ok(
          !(await (await h.fetch("/api/workforce")).json()).requests.some(
            (r: any) => r.id === privateId,
          ),
        );
        assert.equal(
          (
            await post("/api/workforce", {
              action: "cancel",
              id: privateId,
              version: 0,
              revision: feed.revision,
              note: "",
            })
          ).status,
          422,
        );
        h.tenantId = tenantB;
        await h.login("other-employee");
        const other = await (await h.fetch("/api/workforce")).json();
        assert.equal(other.employee.id, "emp-1");
        assert.equal(other.employee.name, "Other Nora de Vries");
        await manager();
      },
    );
    await t.test(
      "RLS fails closed without context and blocks unscoped foreign SQL",
      async () => {
        const c = await app.connect();
        try {
          assert.equal(
            (await c.query("SELECT * FROM app.workspaces")).rowCount,
            0,
          );
          await c.query("BEGIN");
          await c.query(
            "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
            [h.accounts["demo-manager"].id, tenantB],
          );
          assert.equal(
            (await c.query("SELECT * FROM app.workspaces")).rowCount,
            0,
          );
          await c.query("ROLLBACK");
          await c.query("BEGIN");
          await c.query(
            "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
            [h.accounts["demo-manager"].id, tenantA],
          );
          assert.equal(
            (await c.query("SELECT * FROM app.workspaces")).rowCount,
            1,
          );
          assert.equal(
            (
              await c.query("SELECT * FROM app.workspaces WHERE tenant_id=$1", [
                tenantB,
              ])
            ).rowCount,
            0,
          );
          await c.query("ROLLBACK");
          await assert.rejects(
            c.query("SET ROLE sf_admin"),
            (e: any) => e.code === "42501",
          );
          await assert.rejects(
            c.query("SELECT * FROM auth.account"),
            (e: any) => e.code === "42501",
          );
          await assert.rejects(
            c.query("SELECT * FROM auth.session"),
            (e: any) => e.code === "42501",
          );
          const role = (
            await c.query(
              "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
            )
          ).rows[0];
          assert.equal(role.rolsuper, false);
          assert.equal(role.rolbypassrls, false);
        } finally {
          await c.query("ROLLBACK");
          c.release();
        }
      },
    );
    await t.test(
      "roles are separate for each restaurant and client cannot choose a role",
      async () => {
        await h.login("multi");
        assert.equal(
          (await (await h.fetch("/api/session")).json()).actor.role,
          "manager",
        );
        assert.equal(
          (await post("/api/session/tenant", { tenantId: tenantB })).status,
          200,
        );
        h.tenantId = tenantB;
        assert.equal(
          (await (await h.fetch("/api/session")).json()).actor.role,
          "employee",
        );
        assert.equal((await h.fetch("/api/workspace")).status, 403);
        assert.equal(
          (await (await h.fetch("/api/workforce")).json()).employee.id,
          "emp-2",
        );
        await manager();
      },
    );
    await t.test(
      "membership revocation and role changes take effect on existing sessions",
      async () => {
        await manager();
        await h.pool.query(
          "UPDATE app.memberships SET active=false WHERE tenant_id=$1 AND user_id=$2",
          [tenantA, h.accounts["demo-manager"].id],
        );
        assert.equal((await h.fetch("/api/workspace")).status, 403);
        await h.pool.query(
          "UPDATE app.memberships SET active=true WHERE tenant_id=$1 AND user_id=$2",
          [tenantA, h.accounts["demo-manager"].id],
        );
        assert.equal((await h.fetch("/api/workspace")).status, 200);
        const w = await h.workspace(),
          profile = {
            ...w.employees[0],
            id: "emp-role-test",
            name: "Role Test",
            email: "role-test@shiftflow.test",
          };
        assert.equal(
          (await h.mutation({ type: "employee", employee: profile })).status,
          200,
        );
        await h.pool.query(
          "UPDATE app.memberships SET role='employee',employee_id='emp-role-test' WHERE tenant_id=$1 AND user_id=$2",
          [tenantA, h.accounts["demo-manager"].id],
        );
        assert.equal((await h.fetch("/api/workspace")).status, 403);
        assert.equal(
          (await (await h.fetch("/api/workforce")).json()).actor.role,
          "employee",
        );
        await h.pool.query(
          "UPDATE app.memberships SET role='manager',employee_id=null WHERE tenant_id=$1 AND user_id=$2",
          [tenantA, h.accounts["demo-manager"].id],
        );
      },
    );
    await t.test(
      "tampered, expired and signed-out sessions are rejected",
      async () => {
        await manager();
        const key = [...h.cookies.keys()].find((k) =>
          k.includes("session_token"),
        )!;
        const original = h.cookies.get(key)!;
        h.cookies.set(key, original + "tampered");
        assert.equal((await h.fetch("/api/workspace")).status, 401);
        h.cookies.set(key, original);
        await h.pool.query(
          'UPDATE auth.session SET "expiresAt"=now()-interval \'1 minute\' WHERE "userId"=$1',
          [h.accounts["demo-manager"].id],
        );
        assert.equal((await h.fetch("/api/workspace")).status, 401);
        await manager();
        assert.equal(
          (
            await h.fetch("/api/session", {
              method: "DELETE",
              headers: { Origin: h.base },
            })
          ).status,
          200,
        );
        assert.equal((await h.fetch("/api/workspace")).status, 401);
        await manager();
      },
    );
    await t.test(
      "audit and request history are append-only; writes record authenticated actor",
      async () => {
        const w = await h.workspace();
        assert.equal(
          (
            await h.mutation(
              {
                type: "budgets",
                week: "2026-11-16",
                budgets: [13, 12, 12, 12, 12, 12, 12],
              },
              w.revision,
            )
          ).status,
          200,
        );
        const event = (
          await h.pool.query(
            "SELECT actor_user_id,payload FROM app.audit_events WHERE tenant_id=$1 ORDER BY at DESC LIMIT 1",
            [tenantA],
          )
        ).rows[0];
        assert.equal(event.actor_user_id, h.accounts["demo-manager"].id);
        assert.equal(event.payload.actorId, h.actors["demo-manager"]);
        await assert.rejects(
          app.query("UPDATE app.audit_events SET payload=payload"),
          (e: any) => e.code === "42501",
        );
        await assert.rejects(
          h.pool.query("DELETE FROM app.audit_events WHERE tenant_id=$1", [
            tenantA,
          ]),
          (e: any) => e.code === "42501",
        );
        await assert.rejects(
          app.query("DELETE FROM app.request_events"),
          (e: any) => e.code === "42501",
        );
      },
    );
    await t.test(
      "two Node processes cannot lose a concurrent workspace update",
      async () => {
        const port = await freePort(),
          base = `http://127.0.0.1:${port}`;
        second = spawn(
          process.execPath,
          [
            "node_modules/next/dist/bin/next",
            "start",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(port),
          ],
          {
            env: {
              ...process.env,
              SHIFTFLOW_DATA_DIR: h.directory,
              SHIFTFLOW_ORIGIN: base,
              SHIFTFLOW_AUTH_ATTEMPTS: "1000",
            },
            stdio: "ignore",
          },
        );
        for (let i = 0; i < 60; i++) {
          try {
            if ((await globalThis.fetch(base + "/api/session")).status === 200)
              break;
          } catch {}
          await new Promise((r) => setTimeout(r, 100));
        }
        const before = await h.workspace(),
          body = JSON.stringify({
            type: "budgets",
            week: "2026-11-16",
            budgets: [14, 12, 12, 12, 12, 12, 12],
            revision: before.revision,
          });
        const result = await Promise.all([
          h.fetch("/api/workspace", {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: h.base },
            body,
          }),
          h.fetch(base + "/api/workspace", {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: base },
            body,
          }),
        ]);
        assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
        assert.equal((await h.workspace()).revision, before.revision + 1);
        const ended = new Promise((r) => second!.once("exit", r));
        second.kill("SIGTERM");
        await ended;
      },
    );
    await t.test(
      "password change revokes other sessions and accepts only the new password",
      async () => {
        await manager();
        const first = new Map(h.cookies);
        await h.login("demo-manager");
        const old = h.accounts["demo-manager"].password,
          next = "Changed-" + randomUUID();
        const r = await post("/api/auth/change-password", {
          currentPassword: old,
          newPassword: next,
          revokeOtherSessions: true,
        });
        assert.equal(r.status, 200, await r.text());
        h.accounts["demo-manager"].password = next;
        const headers = {
          Cookie: [...first].map(([k, v]) => k + "=" + v).join("; "),
          "x-shiftflow-tenant": tenantA,
        };
        assert.equal(
          (await globalThis.fetch(h.base + "/api/workspace", { headers }))
            .status,
          401,
        );
        assert.equal(
          (
            await post("/api/auth/sign-in/email", {
              email: h.accounts["demo-manager"].email,
              password: old,
            })
          ).status,
          401,
        );
        await manager();
      },
    );
    await t.test(
      "sign-in rate limits persist and cannot be bypassed with forwarded IP headers",
      async () => {
        await h.stop();
        h.rateLimit = 6;
        await h.pool.query('DELETE FROM auth."rateLimit"');
        await h.start();
        for (let i = 0; i < 6; i++) {
          const r = await h.fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: h.base,
              "x-forwarded-for": "192.0.2." + i,
              "x-shiftflow-client-ip": "192.0.2." + i,
            },
            body: JSON.stringify({
              email: "unknown@shiftflow.test",
              password: "Incorrect-password",
            }),
          });
          assert.equal(r.status, 401);
        }
        assert.equal(
          (
            await post("/api/auth/sign-in/email", {
              email: "unknown@shiftflow.test",
              password: "Incorrect-password",
            })
          ).status,
          429,
        );
      },
    );
    await t.test(
      "consistent private backup restores into an empty database with roles and isolation intact",
      async () => {
        const output = await exec(
          process.execPath,
          ["--import", "tsx", "scripts/db-backup.mts"],
          { env: { ...process.env, SHIFTFLOW_DATA_DIR: h.directory } },
        );
        const file = output.stdout.trim();
        const clone = await PgHarness.create(workflowFixture(), true);
        try {
          await exec(
            process.execPath,
            ["--import", "tsx", "scripts/db-restore.mts", file],
            { env: { ...process.env, SHIFTFLOW_DATA_DIR: clone.directory } },
          );
          clone.accounts = h.accounts;
          clone.tenantId = tenantA;
          clone.actors = h.actors;
          await clone.start();
          const restored = await clone.workspace();
          assert.deepEqual(restored, await h.storedWorkspace());
          assert.equal(
            (await clone.pool.query("SELECT count(*) FROM app.tenants")).rows[0]
              .count,
            "2",
          );
          assert.equal(
            (await clone.pool.query("SELECT count(*) FROM app.audit_events"))
              .rows[0].count,
            (await h.pool.query("SELECT count(*) FROM app.audit_events"))
              .rows[0].count,
          );
          assert.equal(
            (
              await clone.fetch("/api/session/tenant", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Origin: clone.base,
                },
                body: JSON.stringify({ tenantId: tenantB }),
              })
            ).status,
            403,
          );
          await assert.rejects(
            exec(
              process.execPath,
              ["--import", "tsx", "scripts/db-restore.mts", file],
              { env: { ...process.env, SHIFTFLOW_DATA_DIR: clone.directory } },
            ),
          );
          assert.deepEqual(await clone.workspace(), restored);
        } finally {
          await clone.dispose();
        }
      },
    );
    await t.test(
      "local administrator provisioning and revocation are private and audited",
      async () => {
        await h.pool.query('DELETE FROM auth."rateLimit"');
        const output = await exec(
          process.execPath,
          [
            "--import",
            "tsx",
            "scripts/db-access.mts",
            "provision",
            "--tenant",
            tenantA,
            "--email",
            "new-local@shiftflow.test",
            "--role",
            "employee",
            "--employee",
            "emp-role-test",
          ],
          { env: { ...process.env, SHIFTFLOW_DATA_DIR: h.directory } },
        );
        const file = output.stdout
          .trim()
          .split("Private generated credentials: ")[1];
        assert.ok(file);
        const record = JSON.parse(await readFile(file, "utf8"));
        h.accounts.provisioned = record;
        h.tenantId = tenantA;
        await h.login("provisioned");
        assert.equal((await h.fetch("/api/workspace")).status, 403);
        assert.equal(
          (await (await h.fetch("/api/workforce")).json()).employee.id,
          "emp-role-test",
        );
        await exec(
          process.execPath,
          [
            "--import",
            "tsx",
            "scripts/db-access.mts",
            "disable",
            "--membership",
            record.membershipId,
          ],
          { env: { ...process.env, SHIFTFLOW_DATA_DIR: h.directory } },
        );
        assert.equal((await h.fetch("/api/workforce")).status, 401);
        const events = (
          await h.pool.query(
            "SELECT payload FROM app.audit_events WHERE tenant_id=$1",
            [tenantA],
          )
        ).rows;
        assert.ok(
          events.some(
            (r) =>
              r.payload.actorId === "local-database-administrator" &&
              r.payload.details?.after?.active === false,
          ),
        );
      },
    );
  },
);
