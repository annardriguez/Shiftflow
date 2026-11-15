import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID, randomBytes } from "node:crypto";
import { Pool } from "pg";
import {
  adminPool,
  provisionAccount,
  provisionTenant,
  type ProvisionedAccount,
} from "../scripts/db-admin";
import { dataDirectory } from "../src/lib/runtime-config";
import { seed } from "../src/lib/seed";
import type { Workspace, Mutation } from "../src/lib/types";
const nativeFetch = globalThis.fetch;
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}
async function processDone(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(output)),
    );
  });
}
export class PgHarness {
  directory = "";
  base = "";
  database = "";
  pool!: Pool;
  tenantId = "";
  actors: Record<string, string> = {};
  accounts: Record<string, ProvisionedAccount> = {};
  child?: ChildProcess;
  cookies = new Map<string, string>();
  currentAlias = "demo-manager";
  output = "";
  rateLimit = 1000;
  static async create(workspace = seed(), empty = false) {
    const h = new PgHarness();
    h.directory = await mkdtemp(path.join(tmpdir(), "shiftflow-pg-test-"));
    h.base = `http://127.0.0.1:${await freePort()}`;
    h.database = "shiftflow_test_" + randomUUID().replaceAll("-", "");
    const root = dataDirectory(),
      config = JSON.parse(
        await readFile(path.join(root, "runtime.json"), "utf8"),
      );
    for (const key of ["appDatabaseUrl", "authDatabaseUrl"]) {
      const url = new URL(config[key]);
      url.pathname = "/" + h.database;
      config[key] = url.toString();
    }
    config.authSecret = randomBytes(48).toString("hex");
    config.origin = h.base;
    await writeFile(
      path.join(h.directory, "runtime.json"),
      JSON.stringify(config),
      { mode: 0o600 },
    );
    await copyFile(
      path.join(root, "postgres-admin.json"),
      path.join(h.directory, "postgres-admin.json"),
    );
    await processDone(
      spawn(process.execPath, ["--import", "tsx", "scripts/db-setup.mts"], {
        env: {
          ...process.env,
          SHIFTFLOW_DATA_DIR: h.directory,
          SHIFTFLOW_DATABASE: h.database,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    h.pool = await adminPool(h.directory);
    if (empty) return h;
    const suffix = randomUUID().slice(0, 8);
    h.accounts["demo-manager"] = await provisionAccount(h.pool, {
      email: `manager-${suffix}@shiftflow.test`,
      name: "Jamie de Boer",
      role: "manager",
    });
    for (const e of workspace.employees)
      h.accounts[e.id] = await provisionAccount(h.pool, {
        email: `${e.id}-${suffix}@shiftflow.test`,
        name: e.name,
        role: "employee",
        employeeId: e.id,
      });
    await h.replaceWorkspace(workspace, false);
    return h;
  }
  async replaceWorkspace(workspace: Workspace, select = true) {
    const result = await provisionTenant(
      this.pool,
      workspace,
      workspace.restaurant.name + " · Test",
      Object.values(this.accounts).filter(
        (a) =>
          a.role === "manager" ||
          workspace.employees.some((e) => e.id === a.employeeId),
      ),
    );
    this.tenantId = result.id;
    this.actors = result.actors;
    workspace.tenantId = result.id;
    if (select && this.cookies.size) {
      if (this.child?.exitCode === null) await this.selectTenant();
      else this.cookies.set("shiftflow-tenant", this.tenantId);
    }
  }
  async start() {
    this.output = "";
    this.child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        new URL(this.base).port,
      ],
      {
        env: {
          ...process.env,
          SHIFTFLOW_DATA_DIR: this.directory,
          SHIFTFLOW_ORIGIN: this.base,
          SHIFTFLOW_AUTH_ATTEMPTS: String(this.rateLimit),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child.stdout?.on("data", (d) => (this.output += d));
    this.child.stderr?.on("data", (d) => (this.output += d));
    for (let i = 0; i < 80; i++) {
      if (this.child.exitCode !== null) throw new Error(this.output);
      try {
        if ((await nativeFetch(this.base + "/api/session")).status === 200) {
          if (!this.cookies.size) await this.login("demo-manager");
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Server startup failed: " + this.output);
  }
  async stop() {
    if (this.child && this.child.exitCode === null) {
      const exited = new Promise((r) => this.child!.once("exit", r));
      this.child.kill("SIGTERM");
      await exited;
    }
  }
  async dispose() {
    await this.stop();
    await this.pool?.end();
    const a = JSON.parse(
      await readFile(path.join(this.directory, "postgres-admin.json"), "utf8"),
    );
    const c = new Pool({
      host: "127.0.0.1",
      port: a.port,
      user: "sf_admin",
      password: a.password,
      database: "postgres",
    });
    await c.query(`DROP DATABASE IF EXISTS ${this.database} WITH (FORCE)`);
    await c.end();
    await rm(this.directory, { recursive: true, force: true });
  }
  async fetch(url: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (!headers.has("Cookie") && this.cookies.size)
      headers.set(
        "Cookie",
        [...this.cookies].map(([k, v]) => k + "=" + v).join("; "),
      );
    if (!headers.has("x-shiftflow-tenant") && this.tenantId)
      headers.set("x-shiftflow-tenant", this.tenantId);
    const result = await nativeFetch(
      url.startsWith("http") ? url : this.base + url,
      { ...init, headers },
    );
    for (const cookie of result.headers.getSetCookie()) {
      const pair = cookie.split(";")[0],
        at = pair.indexOf("=");
      if (at < 0) continue;
      const name = pair.slice(0, at),
        value = pair.slice(at + 1);
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return result;
  }
  async selectTenant() {
    const r = await this.fetch("/api/session/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: this.base },
      body: JSON.stringify({ tenantId: this.tenantId }),
    });
    if (!r.ok) throw new Error("Tenant selection failed: " + (await r.text()));
  }
  async login(alias: string) {
    const a = this.accounts[alias];
    if (!a) throw new Error("Unknown test account");
    this.cookies.clear();
    const r = await this.fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: this.base },
      body: JSON.stringify({ email: a.email, password: a.password }),
    });
    if (!r.ok) throw new Error("Sign in failed: " + (await r.text()));
    this.currentAlias = alias;
    await this.selectTenant();
    return (await (await this.fetch("/api/session")).json()).actor;
  }
  async workspace(): Promise<Workspace> {
    const r = await this.fetch("/api/workspace");
    if (!r.ok)
      throw new Error("Workspace denied: " + r.status + " " + (await r.text()));
    return r.json();
  }
  async storedWorkspace(): Promise<Workspace> {
    return (
      await this.pool.query(
        "SELECT payload FROM app.workspaces WHERE tenant_id=$1",
        [this.tenantId],
      )
    ).rows[0].payload;
  }
  async mutation(m: Mutation, revision?: number, origin = this.base) {
    return this.fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        ...m,
        revision: revision ?? (await this.workspace()).revision,
      }),
    });
  }
}
