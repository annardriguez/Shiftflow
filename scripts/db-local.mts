import EmbeddedPostgres from "embedded-postgres";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
const directory = path.resolve(process.env.SHIFTFLOW_DATA_DIR || ".data");
await mkdir(directory, { recursive: true, mode: 0o700 });
const file = path.join(directory, "postgres-admin.json");
let settings: { password: string; port: number };
try {
  settings = JSON.parse(await readFile(file, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  settings = { password: randomBytes(32).toString("hex"), port: 54329 };
  await writeFile(file, JSON.stringify(settings), { mode: 0o600, flag: "wx" });
}
const pg = new EmbeddedPostgres({
  databaseDir: path.join(directory, "postgres"),
  user: "sf_admin",
  password: settings.password,
  port: settings.port,
  persistent: true,
  authMethod: "scram-sha-256",
  autoRehydrateSymlinks: true,
  postgresFlags: [
    "-h",
    "127.0.0.1",
    "-c",
    "unix_socket_directories=",
    "-c",
    "password_encryption=scram-sha-256",
  ],
  onLog: (message) => {
    if (String(message).includes("ready to accept"))
      console.log("Local PostgreSQL ready on 127.0.0.1:" + settings.port);
  },
  onError: () => console.error("Local PostgreSQL reported a startup error."),
});
try {
  await access(path.join(directory, "postgres/PG_VERSION"));
} catch {
  await pg.initialise();
}
await pg.start();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
await new Promise(() => {});
