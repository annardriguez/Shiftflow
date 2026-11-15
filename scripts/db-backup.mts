/** Private local logical backup. Does not connect to any external service. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { adminPool } from "./db-admin";
import { dataDirectory } from "../src/lib/runtime-config";
const tables = [
  "auth.user",
  "auth.account",
  "app.tenants",
  "app.memberships",
  "app.workspaces",
  "app.schedule_runs",
  "app.audit_events",
  "app.request_events",
  "app.imports",
];
const pool = await adminPool(),
  c = await pool.connect();
const rows: Record<string, unknown[]> = {};
let migrations;
try {
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  migrations = (
    await c.query("SELECT * FROM app.schema_migrations ORDER BY version")
  ).rows;
  for (const name of tables) {
    const [schema, table] = name.split(".");
    rows[name] = (await c.query(`SELECT * FROM "${schema}"."${table}"`)).rows;
  }
  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
const dir = path.join(dataDirectory(), "backups");
await mkdir(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, `shiftflow-${Date.now()}.json`);
await writeFile(
  file,
  JSON.stringify({
    format: 1,
    fictionalDataOnly: true,
    createdAt: new Date().toISOString(),
    sessionsRestored: false,
    migrations,
    tables: rows,
  }),
  { mode: 0o600, flag: "wx" },
);
console.log(file);
