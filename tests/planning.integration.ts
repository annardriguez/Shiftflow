import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PgHarness } from "./pg-harness";
import type { Mutation, Workspace } from "../src/lib/types";
let h: PgHarness, base: string;
const realFetch = globalThis.fetch;
const fetch: typeof globalThis.fetch = (url, init) =>
  h.fetch(String(url), init);
async function start() {
  await h.start();
}
async function stop() {
  await h.stop();
}
before(async () => {
  h = await PgHarness.create();
  base = h.base;
  await start();
});
after(async () => {
  if (h) await h.dispose();
});
async function get() {
  return h.workspace();
}
async function post(m: Mutation, revision?: number, origin = base) {
  return h.mutation(m, revision, origin);
}
test(
  "real engine generation, editing, atomic save, persistence and stale rejection",
  { timeout: 120000 },
  async (t) => {
    const planning = (body: unknown) =>
      fetch(base + "/api/planning", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify(body),
      });
    const original = await get();
    let run: any;
    let shifts: any[];
    await t.test("same-origin boundary and malformed requests", async () => {
      const denied = await fetch(`${base}/api/planning`, {
        method: "POST",
        headers: { Origin: "https://external.example" },
        body: "{}",
      });
      assert.equal(denied.status, 403);
      assert.equal(
        (
          await planning({
            action: "generate",
            week: "bad",
            revision: 0,
            seconds: 4,
          })
        ).status,
        422,
      );
    });
    await t.test(
      "generate three real alternatives without changing saved workspace",
      async () => {
        const r = await planning({
          action: "generate",
          week: "2026-11-16",
          revision: original.revision,
          seconds: 6,
        });
        run = await r.json();
        assert.equal(r.status, 200, JSON.stringify(run));
        assert.equal(run.alternatives.length, 3);
        const a = run.alternatives.find((a: any) => a.validation?.valid);
        assert.ok(a, "at least one feasible alternative");
        run.strategy = a.strategy;
        shifts = a.assignments.map((s: any) => ({
          id: s.id,
          employeeId: s.employee_id,
          date: s.day,
          start: s.start,
          end: s.end,
          breakStart: s.break_start,
          breakMinutes: s.break_minutes,
          kind: s.kind,
          requiredSkillIds: s.required_skills,
        }));
        assert.deepEqual(await get(), original);
      },
    );
    const operation = (action: string, ss = shifts) =>
      planning({ action, id: run.id, strategy: run.strategy, shifts: ss });
    await t.test(
      "invalid preview reports constraints; invalid save makes no partial writes",
      async () => {
        const bad = shifts.map((s) => ({ ...s }));
        bad[0].employeeId = "unknown";
        const validation = await operation("validate", bad);
        assert.equal(validation.status, 200);
        assert.equal((await validation.json()).valid, false);
        assert.equal((await operation("save", bad)).status, 422);
        assert.deepEqual(await get(), original);
        assert.equal((await operation("save", [])).status, 422);
        assert.deepEqual(await get(), original);
      },
    );
    await t.test(
      "valid preview edit preserves operational constraints",
      async () => {
        let found = false;
        for (let i = 0; i < shifts.length; i++) {
          const candidate = shifts.filter((_, j) => j !== i);
          const r = await operation("validate", candidate);
          assert.equal(r.status, 200);
          if ((await r.json()).valid) {
            shifts = candidate;
            found = true;
            break;
          }
        }
        assert.ok(
          found,
          "one redundant assignment can be removed while preserving mandatory coverage",
        );
      },
    );
    await t.test(
      "concurrent saves have one winner; saved roster retains authoritative audit and provenance",
      async () => {
        const responses = await Promise.all([
          operation("save"),
          operation("save"),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        const saved = await get();
        assert.equal(saved.revision, original.revision + 1);
        const w = saved.weeks.find((w) => w.start === run.week)!;
        assert.deepEqual(w.shifts, shifts);
        assert.equal(w.provenance?.runId, run.id);
        assert.equal(w.provenance?.strategy, run.strategy);
        assert.equal(w.provenance?.edited, true);
        assert.ok(saved.audit[0].details?.previousShifts);
        const stored = await h.storedWorkspace();
        assert.deepEqual(stored, saved);
      },
    );
    await t.test(
      "calendar edits on engine drafts revalidate the complete roster",
      async () => {
        const current = await get();
        const shift = shifts[0];
        const shortened = {
          ...shift,
          end: shift.start + 60,
          breakStart: null,
          breakMinutes: 0,
        };
        const r = await post({
          type: "shift",
          week: run.week,
          shift: shortened,
        });
        assert.equal(r.status, 422);
        assert.deepEqual(await get(), current);
      },
    );
    await t.test(
      "stale validation, forged run and stale generation rejected",
      async () => {
        assert.equal((await operation("validate")).status, 409);
        assert.equal(
          (
            await planning({
              action: "save",
              id: crypto.randomUUID(),
              strategy: run.strategy,
              shifts,
            })
          ).status,
          422,
        );
        assert.equal(
          (
            await planning({
              action: "generate",
              week: run.week,
              revision: original.revision,
              seconds: 4,
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "run history and draft survive a UI server restart",
      async () => {
        const saved = await get();
        await stop();
        await start();
        assert.deepEqual(await get(), saved);
        const history = await (await fetch(`${base}/api/planning`)).json();
        assert.equal(history[0].id, run.id);
        assert.equal(history[0].snapshot, undefined);
      },
    );
  },
);
