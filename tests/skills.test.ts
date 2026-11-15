import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/lib/seed";
import { migrateWorkspace } from "../src/lib/migrate";
import { applyMutation, ValidationError } from "../src/lib/mutations";
import { BASE_WEEK } from "../src/lib/schedule";
import {
  assignmentSkillIssues,
  defaultSkillRules,
  findShiftCover,
  pairSupervision,
  qualified,
  skillDiagnostics,
} from "../src/lib/skills";
import type { Employee, Shift, Workspace } from "../src/lib/types";
function employee(
  id: string,
  skills: string[],
  supervisionSkillId: string | null = null,
): Employee {
  return {
    ...seed().employees[0],
    id,
    name: id,
    email: `${id}@example.test`,
    maxHours: 60,
    preferredHours: 20,
    supervisionSkillId,
    competencies: skills.map((skillId) => ({
      skillId,
      verifiedAt: "2026-11-15T11:00:00Z",
      verifiedBy: "demo-manager-jamie",
    })),
  };
}
function shift(
  id: string,
  employeeId: string,
  overrides: Partial<Shift> = {},
): Shift {
  return {
    id,
    employeeId,
    date: BASE_WEEK,
    start: 1080,
    end: 1380,
    breakStart: null,
    breakMinutes: 0,
    kind: "Closing",
    ...overrides,
  };
}
function workspace(): Workspace {
  const w = seed();
  w.employees = [
    employee("closer", ["service", "close", "train"]),
    employee("cover", ["service", "close", "train"]),
    employee("service", ["service"]),
    employee("trainee", ["service"], "train"),
  ];
  w.weeks[0].shifts = [shift("closing", "closer")];
  w.restaurant.skillRules.requirements =
    defaultSkillRules().requirements.filter((r) => r.skillId === "close");
  return w;
}
const candidate = (w: Workspace, id: string) =>
  findShiftCover(w, BASE_WEEK, "closing").candidates.find(
    (c) => c.employeeId === id,
  )!;
test("closing without any qualified closer is explicitly reported", () => {
  const w = workspace();
  w.weeks[0].shifts = [shift("closing", "service")];
  const d = skillDiagnostics(w, w.weeks[0].shifts, [BASE_WEEK]);
  assert.equal(
    d.issues.filter((i) => i.code === "coverage" && i.skillId === "close")
      .length,
    3,
  );
});
test("replacing the only qualified closer with an unqualified worker is ineligible", () => {
  const w = workspace();
  const c = candidate(w, "service");
  assert.equal(c.eligible, false);
  assert.match(c.reasons.join(" "), /qualified staffing would be lost/);
  assert.match(c.reasons.join(" "), /close independently/);
});
test("personal closing duty cannot be discharged by a qualified colleague", () => {
  const w = workspace();
  w.weeks[0].shifts[0].requiredSkillIds = ["close"];
  w.weeks[0].shifts.push(shift("other", "cover"));
  const c = candidate(w, "service");
  assert.equal(c.eligible, false);
  assert.match(c.reasons.join(" "), /not qualified to close independently/);
});
test("trainee without supervision is blocked even with a closing qualification", () => {
  const w = workspace();
  w.employees[3].competencies.push({
    skillId: "close",
    verifiedBy: "demo-manager-jamie",
    verifiedAt: "2026-11-15T11:00:00Z",
  });
  w.employees[3].competencies.push({
    skillId: "train",
    verifiedBy: "demo-manager-jamie",
    verifiedAt: "2026-11-15T11:00:00Z",
  });
  const c = candidate(w, "trainee");
  assert.equal(c.canSupervise, false);
  assert.equal(c.eligible, false);
  assert.match(c.reasons.join(" "), /supervision/);
});
test("replacement removes original worker before assessing team coverage", () => {
  const w = workspace();
  const before = structuredClone(w);
  assert.equal(candidate(w, "trainee").eligible, false);
  assert.deepEqual(w, before);
});
test("removing the only supervisor is blocked despite a second closer", () => {
  const w = workspace();
  w.employees[1].competencies = w.employees[1].competencies.filter(
    (q) => q.skillId !== "train",
  );
  w.weeks[0].shifts.push(
    shift("trainee-shift", "trainee"),
    shift("other", "service"),
  );
  w.employees[2].competencies.push({
    skillId: "close",
    verifiedBy: "demo-manager-jamie",
    verifiedAt: "2026-11-15T11:00:00Z",
  });
  const c = candidate(w, "cover");
  assert.equal(c.eligible, false);
  assert.match(c.reasons.join(" "), /supervision/);
});
test("multiple qualified workers can cover a window with a valid handover", () => {
  const w = workspace();
  w.weeks[0].shifts = [
    shift("a", "closer", { start: 1260, end: 1320, kind: "Midday" }),
    shift("b", "cover", { start: 1320, end: 1380 }),
  ];
  assert.equal(
    skillDiagnostics(w, w.weeks[0].shifts, [BASE_WEEK]).issues.length,
    0,
  );
});
test("handover gap is not hidden by daily qualification totals", () => {
  const w = workspace();
  w.weeks[0].shifts = [
    shift("a", "closer", { end: 1320, kind: "Midday" }),
    shift("b", "cover", { start: 1350 }),
  ];
  const gaps = skillDiagnostics(w, w.weeks[0].shifts, [BASE_WEEK]).issues;
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].minute, 1320);
});
test("unpaid supervisor break creates a supervision deficit", () => {
  const w = workspace();
  w.weeks[0].shifts = [
    shift("closing", "closer", { breakStart: 1290, breakMinutes: 30 }),
    shift("trainee", "trainee"),
  ];
  const issues = skillDiagnostics(w, w.weeks[0].shifts, [BASE_WEEK]).issues;
  assert.ok(issues.some((i) => i.code === "supervision" && i.minute === 1290));
  assert.ok(issues.some((i) => i.code === "coverage" && i.minute === 1290));
});
test("qualified replacement preserves operational constraints and exposes soft indicators", () => {
  const w = workspace();
  w.weeks[0].shifts.push(shift("trainee-shift", "trainee"));
  const c = candidate(w, "cover");
  assert.equal(c.eligible, true);
  assert.deepEqual(c.reasons, []);
  assert.equal(c.canClose, true);
  assert.equal(c.canSupervise, true);
  assert.equal(c.scheduledHours, 0);
  assert.equal(c.proposedHours, 5);
});
test("working till close need not imply independent closer duty when another closer remains", () => {
  const w = workspace();
  w.weeks[0].shifts.push(shift("other", "cover"));
  assert.equal(candidate(w, "service").eligible, true);
});
test("existing mandatory gaps within replacement window block eligibility too", () => {
  const w = workspace();
  w.restaurant.skillRules.requirements[0].minimum = 3;
  assert.equal(candidate(w, "cover").eligible, false);
});
test("shared supervisor capacity cannot be double counted across competency groups", () => {
  const supervisor = employee("sup", ["train", "open"]);
  const trainees = [
    employee("t1", ["service"], "train"),
    employee("t2", ["service"], "open"),
  ];
  const result = pairSupervision([supervisor, ...trainees], 1);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.unpaired.length, 1);
  assert.equal(
    pairSupervision([supervisor, ...trainees], 2).unpaired.length,
    0,
  );
});
test("matching finds a valid allocation instead of greedily stranding a trainee", () => {
  const a = employee("a", ["train", "open"]),
    b = employee("b", ["train"]),
    t1 = employee("t1", [], "train"),
    t2 = employee("t2", [], "open");
  const pairs = pairSupervision([a, b, t1, t2], 1);
  assert.equal(pairs.unpaired.length, 0);
  assert.equal(
    pairs.pairs.find((p) => p.traineeId === "t2")?.supervisorId,
    "a",
  );
});
test("trainee cannot act as independent supervisor or supervise themself", () => {
  const a = employee("a", ["train"], "train"),
    b = employee("b", ["train"], "train");
  assert.equal(pairSupervision([a, b], 2).unpaired.length, 2);
});
test("rest, availability, overlapping work and hour maximum remain hard eligibility checks", () => {
  for (const rule of ["rest", "availability", "overlap", "maximum"]) {
    const w = workspace();
    if (rule === "rest")
      w.weeks[0].shifts.push(
        shift("next", "cover", {
          date: "2026-11-17",
          start: 540,
          end: 840,
          kind: "Midday",
        }),
      );
    if (rule === "availability") w.employees[1].availability[0] = null;
    if (rule === "overlap") w.weeks[0].shifts.push(shift("conflict", "cover"));
    if (rule === "maximum") w.employees[1].maxHours = 1;
    assert.equal(candidate(w, "cover").eligible, false, rule);
  }
});
test("hour preferences never override hard constraints or become mandatory", () => {
  const w = workspace();
  w.employees[1].preferredHours = 0;
  assert.equal(candidate(w, "cover").eligible, true);
  w.employees[2].preferredHours = 5;
  assert.equal(candidate(w, "service").eligible, false);
});
test("manual reassignment and deletion cannot remove the only qualified cover", () => {
  const w = workspace();
  assert.throws(
    () =>
      applyMutation(w, {
        type: "shift",
        week: BASE_WEEK,
        shift: { ...w.weeks[0].shifts[0], employeeId: "service" },
        revision: 0,
      }),
    /mandatory skill/,
  );
  assert.throws(
    () =>
      applyMutation(w, {
        type: "delete-shift",
        week: BASE_WEEK,
        id: "closing",
        revision: 0,
      }),
    /mandatory skill/,
  );
});
test("valid manager draft reassignment is atomic and audited", () => {
  const w = workspace();
  const next = applyMutation(w, {
    type: "shift",
    week: BASE_WEEK,
    shift: { ...w.weeks[0].shifts[0], employeeId: "cover" },
    revision: 0,
  });
  assert.equal(next.weeks[0].shifts[0].employeeId, "cover");
  assert.equal(w.weeks[0].shifts[0].employeeId, "closer");
  assert.equal(next.audit[0].actorId, "demo-manager-jamie");
});
test("revocation is recordable and exposes gaps rather than blocking truthful profiles", () => {
  const w = workspace();
  const next = applyMutation(
    w,
    {
      type: "competencies",
      employeeId: "closer",
      skillIds: ["service"],
      supervisionSkillId: null,
      revision: 0,
    },
    "2026-11-15T13:00:00Z",
  );
  assert.equal(qualified(next.employees[0], "close"), false);
  assert.ok(
    skillDiagnostics(next, next.weeks[0].shifts, [BASE_WEEK]).issues.length > 0,
  );
  assert.equal(next.audit[0].actorId, "demo-manager-jamie");
  assert.ok(next.audit[0].details?.before);
});
test("profile updates cannot self-certify or forge verifier provenance", () => {
  const w = workspace();
  const malicious = {
    ...w.employees[2],
    competencies: [
      { skillId: "close", verifiedAt: "2099-01-01", verifiedBy: "fake" },
    ],
  };
  const next = applyMutation(w, {
    type: "employee",
    employee: malicious,
    revision: 0,
  });
  assert.equal(qualified(next.employees[2], "close"), false);
  const added = applyMutation(w, {
    type: "employee",
    employee: { ...malicious, id: "new", email: "new@example.test" },
    revision: 0,
  });
  assert.equal(added.employees.at(-1)?.skillsReviewedAt, null);
});
test("skill review uses server actor/time and rejects unknown skills", () => {
  const w = workspace();
  assert.throws(
    () =>
      applyMutation(w, {
        type: "competencies",
        employeeId: "service",
        skillIds: ["unknown"],
        supervisionSkillId: null,
        revision: 0,
      }),
    ValidationError,
  );
  const next = applyMutation(
    w,
    {
      type: "competencies",
      employeeId: "service",
      skillIds: ["service", "close"],
      supervisionSkillId: null,
      revision: 0,
    },
    "2026-11-15T14:00:00Z",
  );
  assert.equal(
    next.employees[2].competencies.find((q) => q.skillId === "close")
      ?.verifiedAt,
    "2026-11-15T14:00:00Z",
  );
});
test("v1 migration preserves edits and treats qualifications and supervision as unreviewed", () => {
  const original = workspace();
  const old = {
    ...original,
    schemaVersion: 1,
    restaurant: { ...original.restaurant },
    employees: original.employees.map(
      ({ competencies, supervisionSkillId, skillsReviewedAt, ...e }) => e,
    ),
  };
  const migrated = migrateWorkspace(old, "2026-11-15T12:00:00Z");
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.weeks, original.weeks);
  assert.equal(migrated.revision, original.revision);
  assert.equal(migrated.employees[0].skillsReviewedAt, null);
  assert.deepEqual(migrated.employees[0].competencies, []);
  assert.equal(candidate(migrated, "cover").eligible, false);
  assert.deepEqual(migrateWorkspace(migrated), migrated);
});
test("restaurant skill configuration validates references, granularity and shared capacity", () => {
  const w = workspace();
  assert.throws(() =>
    applyMutation(w, {
      type: "skill-rules",
      rules: { ...w.restaurant.skillRules, supervisionCapacity: 0 },
      revision: 0,
    }),
  );
  assert.throws(() =>
    applyMutation(w, {
      type: "skill-rules",
      rules: {
        ...w.restaurant.skillRules,
        catalog: [{ id: "service", name: "Service" }],
      },
      revision: 0,
    }),
  );
  assert.throws(() =>
    applyMutation(w, {
      type: "skill-rules",
      rules: {
        ...w.restaurant.skillRules,
        requirements: [
          {
            id: "bad",
            skillId: "close",
            days: [0],
            start: 600,
            end: 630,
            minimum: 0,
          },
        ],
      },
      revision: 0,
    }),
  );
});
test("custom tasks can be configured and checked as personal duties", () => {
  const w = workspace();
  w.restaurant.skillRules.catalog.push({
    id: "safety",
    name: "Food safety lead",
  });
  const s = { ...w.weeks[0].shifts[0], requiredSkillIds: ["safety"] };
  assert.match(
    assignmentSkillIssues(s, w.employees[0], w.restaurant.skillRules)[0]
      .message,
    /Food safety lead/,
  );
});
