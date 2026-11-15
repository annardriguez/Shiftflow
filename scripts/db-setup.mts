import { Pool } from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/lib/auth";
import { dataDirectory, type RuntimeConfig } from "../src/lib/runtime-config";
const databaseName = process.env.SHIFTFLOW_DATABASE || "shiftflow";
if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName))
  throw new Error("Invalid local database name");
const dir = dataDirectory(),
  admin = JSON.parse(
    await readFile(path.join(dir, "postgres-admin.json"), "utf8"),
  );
const adminPool = new Pool({
  host: "127.0.0.1",
  port: admin.port,
  user: "sf_admin",
  password: admin.password,
  database: "postgres",
  max: 1,
});
if (
  !(
    await adminPool.query("SELECT 1 FROM pg_database WHERE datname=$1", [
      databaseName,
    ])
  ).rowCount
)
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
await adminPool.end();
let config: RuntimeConfig;
try {
  config = JSON.parse(await readFile(path.join(dir, "runtime.json"), "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  const url = (user: string) =>
    `postgresql://${user}:${randomBytes(32).toString("hex")}@127.0.0.1:${admin.port}/${databaseName}`;
  config = {
    appDatabaseUrl: url("sf_app"),
    authDatabaseUrl: url("sf_auth"),
    authSecret: randomBytes(48).toString("hex"),
    engineToken: randomBytes(32).toString("hex"),
    origin: "http://127.0.0.1:3000",
  };
  await writeFile(
    path.join(dir, "runtime.json"),
    JSON.stringify(config, null, 2),
    { mode: 0o600, flag: "wx" },
  );
}
const migration = new Pool({
  host: "127.0.0.1",
  port: admin.port,
  user: "sf_admin",
  password: admin.password,
  database: databaseName,
  max: 1,
  options: "-c search_path=auth,pg_catalog",
});
for (const value of [config.appDatabaseUrl, config.authDatabaseUrl]) {
  const u = new URL(value);
  const user = u.username;
  if (!/^[a-z_]+$/.test(user)) throw new Error("Invalid role");
  if (
    !(await migration.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [user]))
      .rowCount
  ) {
    const pass = u.password;
    if (!/^[a-f0-9]+$/.test(pass)) throw new Error("Invalid bootstrap secret");
    await migration.query(
      `CREATE ROLE ${user} LOGIN PASSWORD '${pass}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
  }
}
await migration.query("CREATE SCHEMA IF NOT EXISTS auth");
const plan = await getMigrations(authOptions(migration));
if (plan.schemaProblems.length || plan.unsafeChanges.length)
  throw new Error("Unsafe auth migration; review required.");
await plan.runMigrations();
const compiled = await plan.compileMigrations();
if (databaseName === "shiftflow" && compiled.trim() !== ";" && compiled.trim())
  await writeFile("db/auth-schema.sql", compiled);
await migration.query(
  "CREATE SCHEMA IF NOT EXISTS app; CREATE TABLE IF NOT EXISTS app.schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now(),checksum text); ALTER TABLE app.schema_migrations ADD COLUMN IF NOT EXISTS checksum text",
);
const sql = await readFile("db/migrations/001_tenants.sql", "utf8"),
  checksum = createHash("sha256").update(sql).digest("hex");
const previous = (
  await migration.query(
    "SELECT checksum FROM app.schema_migrations WHERE version=1",
  )
).rows[0];
if (previous?.checksum && previous.checksum !== checksum)
  throw new Error(
    "Migration 1 checksum changed. Add a new migration instead of rewriting applied history.",
  );
if (!previous?.checksum) {
  await migration.query("BEGIN");
  try {
    await migration.query(sql);
    await migration.query(
      "UPDATE app.schema_migrations SET checksum=$1 WHERE version=1",
      [checksum],
    );
    await migration.query("COMMIT");
  } catch (e) {
    await migration.query("ROLLBACK");
    throw e;
  }
}
await migration.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO sf_auth;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA auth TO sf_auth;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA auth TO sf_auth;
GRANT USAGE ON SCHEMA app TO sf_app;
GRANT SELECT ON app.tenants,app.memberships,app.imports TO sf_app;
GRANT SELECT,UPDATE ON app.workspaces TO sf_app;
GRANT SELECT,INSERT ON app.schedule_runs,app.audit_events,app.request_events TO sf_app;
GRANT EXECUTE ON FUNCTION app.tenant_member(uuid),app.current_tenant(),app.current_user_id() TO sf_app;
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM sf_app;
REVOKE USAGE ON SCHEMA auth FROM sf_app;`);
await migration.end();
console.log(
  "PostgreSQL and auth migrations applied. Runtime roles cannot own tables or bypass RLS.",
);
