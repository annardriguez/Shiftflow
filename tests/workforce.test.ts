import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityOn, validateShift } from "../src/lib/schedule";
import { workflowFixture } from "./workforce-fixture";
import { applyMutation } from "../src/lib/mutations";
import { propose } from "../src/lib/workforce";
import type { ShiftRequest } from "../src/lib/workforce-types";
test("dated availability narrows and expands recurring availability without certification", () => {
  const w = workflowFixture(),
    e = w.employees[0],
    s = w.weeks[0].shifts[0];
  e.availabilityOverrides = [{ date: s.date, window: null }];
  assert.equal(availabilityOn(e, s.date), null);
  assert.match(
    validateShift(s, w.employees, w.weeks[0].shifts).join(" "),
    /availability/,
  );
  e.availability[0] = null;
  e.availabilityOverrides[0].window = { start: 600, end: 1080 };
  assert.deepEqual(availabilityOn(e, s.date), { start: 600, end: 1080 });
  assert.equal(validateShift(s, w.employees, w.weeks[0].shifts).length, 0);
});
test("scenario reset preserves audit and terminal request history; invalidates pending source references", () => {
  const w = workflowFixture(),
    at = "2026-11-15T12:00:00Z";
  const r: ShiftRequest = {
    id: crypto.randomUUID(),
    version: 0,
    requesterId: "emp-1",
    targetEmployeeId: "emp-2",
    kind: "cover",
    week: w.weeks[0].start,
    shift: w.weeks[0].shifts[0],
    source: "employee",
    status: "pending-colleague",
    createdAt: at,
    updatedAt: at,
    note: "",
    history: [],
    externalSync: "not_connected",
  };
  w.requests = [r];
  w.audit = Array.from({ length: 150 }, (_, i) => ({
    id: String(i),
    at,
    message: "Fictional historical event",
  }));
  const next = applyMutation(w, {
    type: "scenario",
    scenario: "normal",
    revision: 0,
  });
  assert.equal(next.requests![0].status, "invalidated");
  assert.equal(next.requests![0].version, 1);
  assert.equal(next.audit.length, 151);
  assert.equal(w.requests[0].status, "pending-colleague");
});
test("bilateral proposal changes only employee ownership and never mutates source workspace", () => {
  const w = workflowFixture(),
    original = structuredClone(w),
    at = "2026-11-15T12:00:00Z";
  const r: ShiftRequest = {
    id: crypto.randomUUID(),
    version: 0,
    requesterId: "emp-1",
    targetEmployeeId: "emp-2",
    kind: "swap",
    week: w.weeks[0].start,
    shift: w.weeks[0].shifts[0],
    counterWeek: w.weeks[0].start,
    counterShift: w.weeks[0].shifts[2],
    source: "employee",
    status: "pending-manager",
    createdAt: at,
    updatedAt: at,
    note: "",
    history: [],
    externalSync: "not_connected",
  };
  const { next } = propose(w, r);
  assert.equal(next.weeks[0].shifts[0].employeeId, "emp-2");
  assert.equal(next.weeks[0].shifts[2].employeeId, "emp-1");
  assert.deepEqual(w, original);
  assert.deepEqual(
    { ...next.weeks[0].shifts[0], employeeId: "emp-1" },
    original.weeks[0].shifts[0],
  );
});
