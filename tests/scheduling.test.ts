import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/lib/seed";
import {
  applyMutation,
  mutationSchema,
  RevisionError,
  ValidationError,
} from "../src/lib/mutations";
import {
  BASE_WEEK,
  coverage,
  dateAt,
  dayHours,
  getWeek,
  metrics,
  paidHours,
  validateShift,
} from "../src/lib/schedule";
import type { Shift } from "../src/lib/types";
function fixture() {
  const w = seed();
  w.weeks[0].shifts = [];
  w.restaurant.skillRules.requirements = [];
  return w;
}
function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: "test-shift",
    employeeId: "emp-1",
    date: BASE_WEEK,
    start: 600,
    end: 960,
    breakStart: 780,
    breakMinutes: 30,
    kind: "Opening",
    ...overrides,
  };
}
test("all three fictional rosters independently satisfy individual assignment rules", () => {
  for (const s of ["normal", "high-demand", "shortage"] as const) {
    const w = seed(s);
    assert.equal(w.employees.length, 15);
    for (const x of w.weeks[0].shifts)
      assert.deepEqual(
        validateShift(x, w.employees, w.weeks[0].shifts),
        [],
        `${s}: ${x.id}`,
      );
  }
});
test("fixtures are deterministic and difficulty changes demand and availability", () => {
  assert.deepEqual(seed(), seed());
  const normal = seed(),
    busy = seed("high-demand"),
    short = seed("shortage");
  assert.ok(busy.weeks[0].budgets[0] > normal.weeks[0].budgets[0]);
  assert.equal(short.employees[4].availability[4], null);
  assert.ok(
    coverage(busy.weeks[0], busy.scenario)[5].target >
      coverage(normal.weeks[0], normal.scenario)[5].target,
  );
});
test("paid hours exclude unpaid breaks", () => {
  assert.equal(paidHours(shift()), 5.5);
  assert.equal(
    paidHours(shift({ breakMinutes: 0, breakStart: null, end: 900 })),
    5,
  );
});
test("unavailable employee cannot be assigned", () => {
  const w = fixture();
  const x = shift({ employeeId: "emp-9" });
  assert.match(validateShift(x, w.employees, []).join(" "), /availability/);
});
test("approved absence prevents assignment", () => {
  const w = fixture();
  assert.match(
    validateShift(
      shift({ employeeId: "emp-7", date: dateAt(BASE_WEEK, 3) }),
      w.employees,
      [],
    ).join(" "),
    /approved absence/,
  );
});
test("ineligible shift type is blocked", () => {
  const w = fixture();
  assert.match(
    validateShift(
      shift({
        employeeId: "emp-3",
        start: 1020,
        end: 1380,
        kind: "Closing",
        breakStart: 1200,
      }),
      w.employees,
      [],
    ).join(" "),
    /not eligible/,
  );
});
test("overlaps are rejected", () => {
  const w = fixture();
  assert.match(
    validateShift(
      shift({ id: "second", start: 720, end: 1080, kind: "Midday" }),
      w.employees,
      [shift()],
    ).join(" "),
    /overlapping/,
  );
});
test("11-hour rest applies across days and weeks", () => {
  const w = fixture();
  const late = shift({
    id: "previous",
    date: "2026-11-15",
    start: 1080,
    end: 1380,
    kind: "Closing",
    breakMinutes: 0,
    breakStart: null,
  });
  assert.deepEqual(validateShift(shift(), w.employees, [late]), []);
  const early = shift({ start: 540 });
  assert.match(
    validateShift(early, w.employees, [late], { open: 540, close: 1380 }).join(
      " ",
    ),
    /11 hours of rest/,
  );
});
test("weekly hard hours are enforced independently of preferences", () => {
  const w = fixture();
  w.employees[0].maxHours = 5;
  assert.match(
    validateShift(shift(), w.employees, []).join(" "),
    /Weekly maximum/,
  );
});
test("break rules and break placement are enforced", () => {
  const w = fixture();
  assert.match(
    validateShift(
      shift({ breakMinutes: 0, breakStart: null }),
      w.employees,
      [],
    ).join(" "),
    /30-minute/,
  );
  assert.match(
    validateShift(shift({ breakStart: 950 }), w.employees, []).join(" "),
    /entirely inside/,
  );
});
test("operating hours and shift labels have concrete meaning", () => {
  const w = fixture();
  assert.match(
    validateShift(shift({ start: 570 }), w.employees, []).join(" "),
    /preparation hours/,
  );
  assert.match(
    validateShift(shift({ start: 630 }), w.employees, []).join(" "),
    /Opening shifts/,
  );
  assert.match(
    validateShift(shift({ kind: "Closing" }), w.employees, []).join(" "),
    /Closing shifts/,
  );
});
test("maximum shift length is enforced", () => {
  const w = fixture();
  assert.match(
    validateShift(shift({ end: 1200 }), w.employees, []).join(" "),
    /Maximum shift length/,
  );
});
test("budget edits are soft targets and recalculate deviations", () => {
  const w = fixture();
  w.weeks[0].shifts = [shift()];
  const next = applyMutation(w, {
    type: "budgets",
    week: BASE_WEEK,
    budgets: [1, 1, 1, 1, 1, 1, 1],
    revision: 0,
  });
  assert.equal(next.weeks[0].budgets[0], 1);
  assert.equal(dayHours(next.weeks[0], 0), 5.5);
  assert.equal(
    metrics(next.weeks[0], next).hours - metrics(next.weeks[0], next).budget,
    -1.5,
  );
});
test("unpaid breaks remove a worker from interval coverage", () => {
  const w = fixture();
  w.weeks[0].shifts = [shift()];
  const c = coverage(w.weeks[0], w.scenario);
  assert.equal(c.find((i) => i.day === 0 && i.minute === 750)?.actual, 1);
  assert.equal(c.find((i) => i.day === 0 && i.minute === 780)?.actual, 0);
  assert.equal(c.find((i) => i.day === 0 && i.minute === 810)?.actual, 1);
});
test("empty roster exposes all coverage gaps without invented coverage", () => {
  const w = fixture(),
    m = metrics(w.weeks[0], w);
  assert.equal(m.coverage, 0);
  assert.equal(m.gaps.length, 7 * 26);
  assert.equal(m.hours, 0);
});
test("valid shift save updates roster, revision, and audit without mutating source", () => {
  const w = fixture();
  const next = applyMutation(w, {
    type: "shift",
    shift: shift(),
    week: BASE_WEEK,
    revision: 0,
  });
  assert.equal(next.weeks[0].shifts.length, 1);
  assert.equal(w.weeks[0].shifts.length, 0);
  assert.equal(next.revision, 1);
  assert.match(next.audit[0].message, /Saved opening/);
});
test("editing a shift replaces it rather than duplicating", () => {
  const w = fixture();
  w.weeks[0].shifts = [shift()];
  const next = applyMutation(w, {
    type: "shift",
    shift: shift({ end: 930 }),
    week: BASE_WEEK,
    revision: 0,
  });
  assert.equal(next.weeks[0].shifts.length, 1);
  assert.equal(paidHours(next.weeks[0].shifts[0]), 5);
});
test("delete removes a known shift and rejects unknown IDs", () => {
  const w = fixture();
  w.weeks[0].shifts = [shift()];
  assert.equal(
    applyMutation(w, {
      type: "delete-shift",
      week: BASE_WEEK,
      id: "test-shift",
      revision: 0,
    }).weeks[0].shifts.length,
    0,
  );
  assert.throws(
    () =>
      applyMutation(w, {
        type: "delete-shift",
        week: BASE_WEEK,
        id: "missing",
        revision: 0,
      }),
    ValidationError,
  );
});
test("out-of-week edits and invalid calendar dates are rejected", () => {
  const w = fixture();
  assert.throws(
    () =>
      applyMutation(w, {
        type: "shift",
        week: BASE_WEEK,
        shift: shift({ date: "2026-11-23" }),
        revision: 0,
      }),
    /outside/,
  );
  assert.equal(
    mutationSchema.safeParse({
      type: "shift",
      week: BASE_WEEK,
      shift: shift({ date: "2026-02-30" }),
      revision: 0,
    }).success,
    false,
  );
});
test("stale revisions do not silently overwrite another edit", () => {
  const w = fixture();
  w.revision = 2;
  assert.throws(
    () =>
      applyMutation(w, {
        type: "budgets",
        week: BASE_WEEK,
        budgets: [1, 1, 1, 1, 1, 1, 1],
        revision: 0,
      }),
    RevisionError,
  );
});
test("availability changes cannot invalidate a saved roster", () => {
  const w = fixture();
  w.weeks[0].shifts = [shift()];
  const a = structuredClone(w.employees[0].availability);
  a[0] = null;
  assert.throws(
    () =>
      applyMutation(w, {
        type: "availability",
        employeeId: "emp-1",
        availability: a,
        revision: 0,
      }),
    /conflicts with shift/,
  );
});
test("employment restriction edits revalidate all assignments", () => {
  const w = fixture();
  w.weeks[0].shifts = [shift()];
  assert.throws(
    () =>
      applyMutation(w, {
        type: "employee",
        employee: { ...w.employees[0], preferredHours: 4, maxHours: 5 },
        revision: 0,
      }),
    /Weekly maximum/,
  );
});
test("half-hour granularity and nonnegative targets are validated", () => {
  const w = fixture();
  assert.equal(
    mutationSchema.safeParse({
      type: "shift",
      shift: shift({ start: 601 }),
      week: BASE_WEEK,
      revision: 0,
    }).success,
    false,
  );
  assert.equal(
    mutationSchema.safeParse({
      type: "budgets",
      week: BASE_WEEK,
      budgets: [-1, 0, 0, 0, 0, 0, 0],
      revision: 0,
    }).success,
    false,
  );
});
test("future weeks start empty; cross-week rest is validated", () => {
  const w = fixture();
  assert.equal(getWeek(w, "2026-11-23").shifts.length, 0);
  assert.equal(getWeek(w, "2026-11-23").budgets.length, 7);
  const next = applyMutation(w, {
    type: "shift",
    week: "2026-11-23",
    shift: shift({ date: "2026-11-23" }),
    revision: 0,
  });
  assert.equal(next.weeks.length, 2);
});
test("scenario reset increments revision and is explicitly audited", () => {
  const w = fixture();
  w.revision = 3;
  const n = applyMutation(w, {
    type: "scenario",
    scenario: "shortage",
    revision: 3,
  });
  assert.equal(n.revision, 4);
  assert.equal(n.scenario, "shortage");
  assert.match(n.audit[0].message, /reset/);
});
test("duplicate email addresses cannot be created", () => {
  const w = fixture();
  assert.throws(
    () =>
      applyMutation(w, {
        type: "employee",
        employee: { ...w.employees[0], id: "other" },
        revision: 0,
      }),
    /email already/,
  );
});
test("rest uses real Amsterdam elapsed time across the spring DST transition", () => {
  const w = fixture();
  const late = shift({
    id: "late",
    date: "2027-03-27",
    start: 1080,
    end: 1380,
    kind: "Closing",
    breakMinutes: 0,
    breakStart: null,
  });
  assert.match(
    validateShift(shift({ date: "2027-03-28" }), w.employees, [late]).join(" "),
    /11 hours of rest/,
  );
});
test("autumn DST grants an additional elapsed rest hour", () => {
  const w = fixture();
  const late = shift({
    id: "late",
    date: "2026-10-24",
    start: 1080,
    end: 1380,
    kind: "Closing",
    breakMinutes: 0,
    breakStart: null,
  });
  assert.deepEqual(
    validateShift(shift({ date: "2026-10-25" }), w.employees, [late]),
    [],
  );
});
test("CSV reflects paid hours, escapes values, blocks formulas, and preserves roster order", async () => {
  const { rosterCsv } = await import("../src/lib/export");
  const w = fixture();
  w.employees[0].name = '=TEST("demo")';
  w.weeks[0].shifts = [
    shift({ date: dateAt(BASE_WEEK, 1) }),
    shift({ id: "earlier" }),
  ];
  const before = structuredClone(w.weeks[0].shifts);
  const csv = rosterCsv(w, BASE_WEEK);
  assert.match(csv, /FICTIONAL DATA/);
  assert.match(csv, /"'=TEST\(""demo""\)"/);
  assert.match(csv, /"30","5.5"/);
  assert.deepEqual(w.weeks[0].shifts, before);
});
