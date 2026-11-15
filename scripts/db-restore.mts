/** Offline restore into an empty, already migrated local database only. */
import { readFile } from "node:fs/promises";
import { adminPool } from "./db-admin";
const file = process.argv[2];
if (!file)
  throw new Error(
    "Pass a private backup file. Restore requires an empty database.",
  );
const backup = JSON.parse(await readFile(file, "utf8"));
if (backup.format !== 1 || backup.fictionalDataOnly !== true)
  throw new Error("Unsupported backup.");
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
try {
  await c.query("BEGIN");
  await c.query('LOCK TABLE auth."user",app.tenants IN ACCESS EXCLUSIVE MODE');
  if (
    (
      await c.query(
        'SELECT 1 FROM auth."user" UNION ALL SELECT 1 FROM app.tenants LIMIT 1',
      )
    ).rowCount
  )
    throw new Error(
      "Restore refused: target database is not empty. Existing data was not changed.",
    );
  const versions = (
    await c.query(
      "SELECT version,checksum FROM app.schema_migrations ORDER BY version",
    )
  ).rows;
  if (
    JSON.stringify(versions) !==
    JSON.stringify(
      backup.migrations.map((r: { version: number; checksum: string }) => ({
        version: r.version,
        checksum: r.checksum,
      })),
    )
  )
    throw new Error("Migration versions/checksums do not match the backup.");
  for (const name of tables) {
    const [schema, table] = name.split(".");
    const columns = new Set(
      (
        await c.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
          [schema, table],
        )
      ).rows.map((r) => r.column_name),
    );
    for (const row of backup.tables[name] ?? []) {
      const keys = Object.keys(row);
      if (!keys.length || keys.some((k) => !columns.has(k)))
        throw new Error("Unexpected backup columns.");
      const quoted = keys
        .map((k) => '"' + k.replaceAll('"', '""') + '"')
        .join(",");
      await c.query(
        `INSERT INTO "${schema}"."${table}"(${quoted}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
        keys.map((k) => row[k]),
      );
    }
  }
  await c.query("COMMIT");
  console.log(
    "Restored fictional data into the empty local database. Sign in again; sessions were not restored.",
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
