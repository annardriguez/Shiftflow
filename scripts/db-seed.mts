/** Resumable fictional provisioning. Existing tenants/passwords are never reset. */
import { readFile, writeFile, readdir, rename } from "node:fs/promises";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import { seed } from "../src/lib/seed";
import { migrateWorkspace } from "../src/lib/migrate";
import { dataDirectory } from "../src/lib/runtime-config";
import {
  adminPool,
  provisionAccount,
  provisionTenant,
  type ProvisionedAccount,
} from "./db-admin";
const dir = dataDirectory(),
  pool = await adminPool(),
  primary = "11111111-1111-4111-8111-111111111111",
  secondary = "22222222-2222-4222-8222-222222222222",
  file = path.join(dir, "fictional-accounts.json");
interface Journal {
  complete?: boolean;
  notice: string;
  tenants: { id: string; name: string }[];
  accounts: (ProvisionedAccount & { restaurant: string })[];
}
let journal: Journal;
try {
  journal = JSON.parse(await readFile(file, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  journal = {
    complete: false,
    notice:
      "Fictional local accounts only. Private initial passwords; never package this file.",
    tenants: [],
    accounts: [],
  };
}
async function save() {
  const temp = file + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(journal, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temp, file);
}
const existing = (
  await pool.query(
    "SELECT tenant_id,payload FROM app.workspaces WHERE tenant_id=ANY($1::uuid[])",
    [[primary, secondary]],
  )
).rows;
if (
  existing.length === 2 &&
  journal.accounts.length &&
  journal.complete !== false
) {
  console.log("Existing tenants, passwords and rosters preserved.");
  await pool.end();
  process.exit(0);
}
async function ensureAccount(
  info: {
    email: string;
    name: string;
    role: "manager" | "employee";
    employeeId?: string;
  },
  restaurant: string,
) {
  let record = journal.accounts.find((a) => a.email === info.email);
  const old = (
    await pool.query('SELECT id FROM auth."user" WHERE email=$1', [info.email])
  ).rows[0];
  if (old) {
    if (!record || record.id !== old.id)
      throw new Error(
        "Existing account has no matching private provisioning journal. Passwords were not changed.",
      );
    return record;
  }
  if (!record) {
    record = {
      ...info,
      id: randomUUID(),
      actorId: info.employeeId ?? "",
      // A hosted public demo sets one shared, known password for its
      // fictional accounts; otherwise each account gets a private random one.
      password:
        process.env.SHIFTFLOW_DEMO_PASSWORD &&
        process.env.SHIFTFLOW_DEMO_PASSWORD.length >= 12
          ? process.env.SHIFTFLOW_DEMO_PASSWORD
          : randomBytes(18).toString("base64url"),
      restaurant,
    };
    journal.accounts.push(record);
    await save();
  }
  await provisionAccount(pool, record);
  return record;
}
async function accountsFor(
  w: ReturnType<typeof seed>,
  slug: string,
  email: string,
  name: string,
) {
  const accounts: ProvisionedAccount[] = [
    await ensureAccount({ email, name, role: "manager" }, w.restaurant.name),
  ];
  for (const e of w.employees)
    accounts.push(
      await ensureAccount(
        {
          email: `${e.id}@${slug}.shiftflow.test`,
          name: e.name,
          role: "employee",
          employeeId: e.id,
        },
        w.restaurant.name,
      ),
    );
  return accounts;
}
try {
  let original: string | undefined;
  try {
    original = await readFile(path.join(dir, "workspace.json"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const first =
    existing.find((r) => r.tenant_id === primary)?.payload ??
    (original ? migrateWorkspace(JSON.parse(original)) : seed());
  const accountsA = await accountsFor(
    first,
    "utrecht",
    "jamie@shiftflow.test",
    "Jamie de Boer",
  );
  if (!existing.some((r) => r.tenant_id === primary)) {
    await provisionTenant(
      pool,
      first,
      first.restaurant.name + " · Utrecht",
      accountsA,
      primary,
    );
    if (original)
      await pool.query(
        "INSERT INTO app.imports(tenant_id,source_sha256) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [primary, createHash("sha256").update(original).digest("hex")],
      );
  }
  const second =
    existing.find((r) => r.tenant_id === secondary)?.payload ?? seed();
  second.restaurant.name = "Harbour Bowl";
  second.restaurant.location = "Rotterdam, Netherlands";
  const accountsB = await accountsFor(
    second,
    "rotterdam",
    "robin@shiftflow.test",
    "Robin Vermeer",
  );
  if (!existing.some((r) => r.tenant_id === secondary))
    await provisionTenant(
      pool,
      second,
      "Harbour Bowl · Rotterdam",
      accountsB,
      secondary,
    );
  const shared = await ensureAccount(
    { email: "alex@shiftflow.test", name: "Alex Morgan", role: "manager" },
    "Both fictional restaurants",
  );
  await pool.query(
    "INSERT INTO app.memberships(id,tenant_id,user_id,role,employee_id,display_name) VALUES(gen_random_uuid(),$1,$2,'manager',null,$3),(gen_random_uuid(),$4,$2,'manager',null,$3) ON CONFLICT(tenant_id,user_id) DO NOTHING",
    [primary, shared.id, shared.name, secondary],
  );
  let count = 0;
  try {
    for (const name of await readdir(path.join(dir, "runs"))) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const run = JSON.parse(
        await readFile(path.join(dir, "runs", name), "utf8"),
      );
      if (run.id !== name.slice(0, -5))
        throw new Error("Legacy run filename/ID mismatch");
      count +=
        (
          await pool.query(
            "INSERT INTO app.schedule_runs(tenant_id,id,created_at,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
            [primary, run.id, run.createdAt, JSON.stringify(run)],
          )
        ).rowCount ?? 0;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  journal.complete = true;
  journal.tenants = [
    { id: primary, name: first.restaurant.name + " · Utrecht" },
    { id: secondary, name: "Harbour Bowl · Rotterdam" },
  ];
  await save();
  console.log(
    `Two fictional restaurants ready; ${count} legacy runs imported. Private initial credentials: .data/fictional-accounts.json. Legacy files unchanged.`,
  );
} finally {
  await pool.end();
}
