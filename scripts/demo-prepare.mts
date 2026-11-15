/**
 * Hosted-demo warm-up. Signs in as the fictional demo manager through the
 * app's own HTTP API and saves a generated, fully validated roster for the
 * demo week, so swaps work immediately. Uses exactly the browser's code path:
 * the engine generates, the independent validator checks, the app saves.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { toShifts, type PlanningRun } from "../src/lib/planning-types";
import { BASE_WEEK } from "../src/lib/schedule";

const port = process.env.PORT || "7860";
const base = `http://127.0.0.1:${port}`;
const origin = process.env.SHIFTFLOW_PUBLIC_ORIGIN || base;
const journal = JSON.parse(
  await readFile(
    path.join(process.env.SHIFTFLOW_DATA_DIR || ".data", "fictional-accounts.json"),
    "utf8",
  ),
);
const manager = journal.accounts.find(
  (a: { email: string }) => a.email === "jamie@shiftflow.test",
);
let cookies = "";
let tenant = "";
async function call(url: string, body?: unknown) {
  const r = await fetch(base + url, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: origin,
      Cookie: cookies,
      ...(tenant ? { "x-shiftflow-tenant": tenant } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of r.headers.getSetCookie()) {
    const pair = c.split(";")[0];
    const name = pair.split("=")[0];
    cookies = [...cookies.split("; ").filter((x) => x && !x.startsWith(name + "=")), pair].join("; ");
  }
  const value = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url}: ${r.status} ${JSON.stringify(value).slice(0, 300)}`);
  return value;
}
await call("/api/auth/sign-in/email", { email: manager.email, password: manager.password });
let session = await call("/api/session");
if (!session.actor) {
  await call("/api/session/tenant", { tenantId: session.memberships[0].tenantId });
  session = await call("/api/session");
}
tenant = session.actor.tenantId;
const workspace = await call("/api/workspace");
if (workspace.weeks.find((w: { start: string; provenance?: unknown }) => w.start === BASE_WEEK)?.provenance) {
  console.log("Demo roster already prepared.");
  process.exit(0);
}
const run: PlanningRun = await call("/api/planning", {
  action: "generate",
  week: BASE_WEEK,
  revision: workspace.revision,
  seconds: 8,
});
const best = run.alternatives.find((a) => a.validation?.valid);
if (!best) throw new Error("No valid roster found for the demo week.");
await call("/api/planning", {
  action: "save",
  id: run.id,
  strategy: best.strategy,
  shifts: toShifts(best.assignments),
});
console.log(`Demo roster saved (${best.strategy}, ${best.assignments.length} shifts).`);
