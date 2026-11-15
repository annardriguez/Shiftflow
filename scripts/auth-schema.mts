import { Pool } from "pg";
import { writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/lib/auth";
import { adminPool } from "./db-admin";
import { dataDirectory } from "../src/lib/runtime-config";
const admin = await adminPool(),
  schema = "auth_blueprint_" + randomUUID().replaceAll("-", "");
await admin.query(`CREATE SCHEMA ${schema}`);
const credentials = JSON.parse(
  await readFile(path.join(dataDirectory(), "postgres-admin.json"), "utf8"),
);
const pool = new Pool({
  host: "127.0.0.1",
  port: credentials.port,
  user: "sf_admin",
  password: credentials.password,
  database: "shiftflow",
  options: `-c search_path=${schema},pg_catalog`,
});
try {
  const plan = await getMigrations(authOptions(pool));
  const sql = await plan.compileMigrations();
  await writeFile(
    "db/auth-schema.sql",
    "-- Generated from pinned Better Auth; db:setup applies library migrations.\nCREATE SCHEMA IF NOT EXISTS auth;\nSET search_path=auth,pg_catalog;\n" +
      sql,
  );
} finally {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema}`);
  await admin.end();
}
console.log(
  "Wrote db/auth-schema.sql; existing authentication tables unchanged.",
);
