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
test("local HTTP workflow against isolated production server", async (t) => {
  await t.test("all manager pages render", async () => {
    for (const p of [
      "/",
      "/team",
      "/availability",
      "/schedule",
      "/labour",
      "/requests",
      "/settings",
    ]) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, p);
      assert.match(await r.text(), /ShiftFlow/);
    }
  });
  await t.test("initial fixture has expected contract", async () => {
    const w = await get();
    assert.equal(w.schemaVersion, 2);
    assert.equal(w.employees.length, 15);
    assert.equal(w.revision, 0);
  });
  await t.test("same-origin budget edit persists to disk and GET", async () => {
    const r = await post({
      type: "budgets",
      week: "2026-11-16",
      budgets: [35, 32, 34, 36, 44, 48, 40],
    });
    assert.equal(r.status, 200);
    const w = await r.json();
    assert.equal(w.revision, 1);
    assert.equal(w.weeks[0].budgets[0], 35);
    assert.equal((await get()).revision, 1);
    const disk = await h.storedWorkspace();
    assert.equal(disk.weeks[0].budgets[0], 35);
  });
  await t.test("saved edits survive process restart", async () => {
    await stop();
    await start();
    assert.equal((await get()).weeks[0].budgets[0], 35);
  });
  await t.test("stale revision rejected without overwriting", async () => {
    const r = await post(
      { type: "budgets", week: "2026-11-16", budgets: [1, 1, 1, 1, 1, 1, 1] },
      0,
    );
    assert.equal(r.status, 409);
    assert.equal((await get()).weeks[0].budgets[0], 35);
  });
  await t.test("cross-origin mutations are rejected", async () => {
    const r = await post(
      { type: "scenario", scenario: "normal" },
      undefined,
      "https://example.test",
    );
    assert.equal(r.status, 403);
  });
  await t.test(
    "schema violations and malformed JSON produce explicit errors",
    async () => {
      const r = await post({
        type: "budgets",
        week: "2026-11-16",
        budgets: [-1],
      });
      assert.equal(r.status, 422);
      const bad = await fetch(`${base}/api/workspace`, {
        method: "POST",
        body: "{bad",
        headers: { Origin: base },
      });
      assert.equal(bad.status, 400);
    },
  );
  await t.test(
    "employee create and confirmed availability edits round-trip",
    async () => {
      const w = await get();
      const employee = {
        ...w.employees[0],
        id: "api-person",
        name: "Fictional API Person",
        email: "api@example.test",
        preferredHours: 12,
        maxHours: 20,
      };
      assert.equal((await post({ type: "employee", employee })).status, 200);
      assert.ok((await get()).employees.some((e) => e.id === "api-person"));
      // Profile creation cannot self-certify; server-stamped manager review is separate.
      assert.equal(
        (await get()).employees.find((e) => e.id === "api-person")
          ?.skillsReviewedAt,
        null,
      );
      assert.equal(
        (
          await post({
            type: "competencies",
            employeeId: "api-person",
            skillIds: ["service", "open", "close", "train"],
            supervisionSkillId: null,
          })
        ).status,
        200,
      );
      const availability = employee.availability.map((a, i) =>
        i === 6 ? null : a,
      );
      assert.equal(
        (
          await post({
            type: "availability",
            employeeId: employee.id,
            availability,
          })
        ).status,
        200,
      );
      assert.equal(
        (await get()).employees.find((e) => e.id === employee.id)
          ?.availability[6],
        null,
      );
    },
  );
  const shift = {
    id: "api-shift",
    employeeId: "api-person",
    date: "2026-11-23",
    start: 600,
    end: 960,
    breakStart: 780,
    breakMinutes: 30,
    kind: "Opening" as const,
  };
  await t.test(
    "valid shift saved and invalid availability change rejected",
    async () => {
      assert.equal(
        (await post({ type: "shift", week: "2026-11-23", shift })).status,
        200,
      );
      const w = await get(),
        a = w.employees
          .find((e) => e.id === "api-person")!
          .availability.map((v, i) => (i === 0 ? null : v));
      const r = await post({
        type: "availability",
        employeeId: "api-person",
        availability: a,
      });
      assert.equal(r.status, 422);
      assert.match((await r.json()).error, /conflicts with shift/);
    },
  );
  await t.test(
    "overlapping assignment rejected and remains unsaved",
    async () => {
      const r = await post({
        type: "shift",
        week: "2026-11-23",
        shift: { ...shift, id: "overlap" },
      });
      assert.equal(r.status, 422);
      assert.match((await r.json()).error, /overlapping/);
      assert.equal(
        (await get()).weeks.find((w) => w.start === "2026-11-23")?.shifts
          .length,
        1,
      );
    },
  );
  await t.test(
    "concurrent writes allow only one matching revision",
    async () => {
      const w = await get();
      const requests = await Promise.all([
        post(
          {
            type: "budgets",
            week: "2026-11-23",
            budgets: [10, 10, 10, 10, 10, 10, 10],
          },
          w.revision,
        ),
        post(
          {
            type: "budgets",
            week: "2026-11-23",
            budgets: [20, 20, 20, 20, 20, 20, 20],
          },
          w.revision,
        ),
      ]);
      assert.deepEqual(requests.map((r) => r.status).sort(), [200, 409]);
    },
  );
  await t.test(
    "Find Shift Cover is server-authoritative, read-only, and revision-scoped",
    async () => {
      const before = await get();
      const response = await fetch(
        `${base}/api/shift-cover?week=2026-11-23&shiftId=api-shift`,
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.revision, before.revision);
      assert.equal(body.externalSync, "not_connected");
      assert.equal(body.candidates.length, before.employees.length - 1);
      assert.ok(
        body.candidates.every((c: { eligible: boolean; reasons: string[] }) =>
          c.eligible ? c.reasons.length === 0 : c.reasons.length > 0,
        ),
      );
      assert.deepEqual(await get(), before);
      const missing = await fetch(
        `${base}/api/shift-cover?week=2026-11-23&shiftId=missing`,
      );
      assert.equal(missing.status, 404);
    },
  );
  await t.test(
    "competency provenance cannot be forged through generic profile updates",
    async () => {
      const before = await get(),
        employee = before.employees.find((e) => e.id === "api-person")!;
      const forged = {
        ...employee,
        competencies: [
          {
            skillId: "unknown",
            verifiedBy: "employee-self",
            verifiedAt: "2099-01-01T00:00:00Z",
          },
        ],
      };
      assert.equal(
        (await post({ type: "employee", employee: forged })).status,
        200,
      );
      assert.deepEqual(
        (await get()).employees.find((e) => e.id === employee.id)?.competencies,
        employee.competencies,
      );
    },
  );
  await t.test(
    "revocation changes fresh cover assessments and records server actor and time",
    async () => {
      const before = await get(),
        e = before.employees.find((e) => e.id === "emp-1")!;
      assert.equal(
        (
          await post({
            type: "competencies",
            employeeId: e.id,
            skillIds: [],
            supervisionSkillId: null,
          })
        ).status,
        200,
      );
      const after = await get();
      assert.equal(after.audit[0].actorId, h.actors["demo-manager"]);
      assert.ok(after.audit[0].details?.before);
      const response = await fetch(
        `${base}/api/shift-cover?week=2026-11-23&shiftId=api-shift`,
      );
      const body = await response.json();
      assert.equal(body.revision, after.revision);
      const c = body.candidates.find(
        (c: { employeeId: string }) => c.employeeId === e.id,
      );
      assert.equal(c.eligible, false);
      assert.ok(c.reasons.some((r: string) => /qualification/.test(r)));
    },
  );
  await t.test("delete and scenario reset round-trip with audit", async () => {
    const beforeRules = await get();
    assert.equal(
      (
        await post({
          type: "skill-rules",
          rules: { ...beforeRules.restaurant.skillRules, requirements: [] },
        })
      ).status,
      200,
    );
    assert.equal(
      (await post({ type: "delete-shift", week: "2026-11-23", id: shift.id }))
        .status,
      200,
    );
    assert.equal(
      (await get()).weeks.find((w) => w.start === "2026-11-23")?.shifts.length,
      0,
    );
    assert.equal(
      (await post({ type: "scenario", scenario: "shortage" })).status,
      200,
    );
    const w = await get();
    assert.equal(w.scenario, "shortage");
    assert.equal(w.employees.length, 15);
    assert.match(w.audit[0].message, /reset/);
  });
  await t.test(
    "legacy disk migration preserves roster and hours across restart without granting skills",
    async () => {
      const before = await get();
      await stop();
      const legacy = {
        ...before,
        schemaVersion: 1,
        employees: before.employees.map(
          ({
            competencies,
            supervisionSkillId,
            skillsReviewedAt,
            ...employee
          }) => employee,
        ),
      };
      await h.replaceWorkspace(legacy as Workspace);
      await start();
      const migrated = await get();
      assert.equal(migrated.schemaVersion, 2);
      assert.deepEqual(migrated.weeks, before.weeks);
      assert.equal(migrated.revision, before.revision);
      assert.ok(
        migrated.employees.every(
          (e) => e.skillsReviewedAt === null && e.competencies.length === 0,
        ),
      );
    },
  );
});
