import type { Employee, Shift, SkillRules, Workspace } from "./types";
import {
  dayIndex,
  employeeHours,
  getWeek,
  paidHours,
  time,
  validateShift,
} from "./schedule";
export const DEMO_MANAGER = "demo-manager-jamie";
export function defaultSkillRules(): SkillRules {
  return {
    catalog: [
      { id: "open", name: "Can open" },
      { id: "close", name: "Can close independently" },
      { id: "train", name: "Can train / supervise" },
      { id: "service", name: "General service" },
    ],
    requirements: [
      {
        id: "opening",
        skillId: "open",
        days: [0, 1, 2, 3, 4, 5, 6],
        start: 600,
        end: 660,
        minimum: 1,
      },
      {
        id: "closing",
        skillId: "close",
        days: [0, 1, 2, 3, 4, 5, 6],
        start: 1290,
        end: 1380,
        minimum: 1,
      },
      {
        id: "service",
        skillId: "service",
        days: [0, 1, 2, 3, 4, 5, 6],
        start: 660,
        end: 1290,
        minimum: 1,
      },
    ],
    requiredByKind: {
      Opening: ["service"],
      Midday: ["service"],
      Closing: ["service"],
    },
    supervisionCapacity: 2,
  };
}
export function skillName(rules: SkillRules, id: string) {
  return rules.catalog.find((k) => k.id === id)?.name ?? id;
}
export function qualified(e: Employee, skillId: string) {
  return Boolean(
    e.skillsReviewedAt &&
    e.competencies.some(
      (q) => q.skillId === skillId && q.verifiedBy && q.verifiedAt,
    ),
  );
}
export function onDuty(s: Shift, minute: number) {
  return (
    s.start <= minute &&
    s.end >= minute + 30 &&
    !(
      s.breakMinutes > 0 &&
      s.breakStart !== null &&
      s.breakStart < minute + 30 &&
      s.breakStart + s.breakMinutes > minute
    )
  );
}
export interface SkillIssue {
  key: string;
  code: "qualification" | "unreviewed" | "coverage" | "supervision";
  date: string;
  minute: number;
  skillId: string | null;
  employeeId?: string;
  required: number;
  actual: number;
  message: string;
}
export interface SupervisionPair {
  date: string;
  minute: number;
  traineeId: string;
  supervisorId: string;
}
/** Independent bipartite matching. A supervisor's capacity is shared across skill groups. */
export function pairSupervision(active: Employee[], capacity: number) {
  const trainees = active.filter(
    (e) => e.skillsReviewedAt && e.supervisionSkillId,
  );
  const supervisors = active.filter(
    (e) => e.skillsReviewedAt && !e.supervisionSkillId,
  );
  const slots = supervisors.flatMap((s) =>
    Array.from({ length: capacity }, (_, i) => ({
      supervisor: s,
      id: `${s.id}-${i}`,
    })),
  );
  const owners = new Map<number, number>();
  function assign(trainee: number, seen: Set<number>): boolean {
    for (let slot = 0; slot < slots.length; slot++) {
      if (
        seen.has(slot) ||
        !qualified(
          slots[slot].supervisor,
          trainees[trainee].supervisionSkillId!,
        )
      )
        continue;
      seen.add(slot);
      const owner = owners.get(slot);
      if (owner === undefined || assign(owner, seen)) {
        owners.set(slot, trainee);
        return true;
      }
    }
    return false;
  }
  for (let i = 0; i < trainees.length; i++) assign(i, new Set());
  const pairs = [...owners].map(([slot, i]) => ({
    traineeId: trainees[i].id,
    supervisorId: slots[slot].supervisor.id,
  }));
  return {
    pairs,
    unpaired: trainees.filter((e) => !pairs.some((p) => p.traineeId === e.id)),
  };
}
export function assignmentSkillIssues(
  s: Shift,
  e: Employee,
  rules: SkillRules,
): SkillIssue[] {
  const common = {
    date: s.date,
    minute: s.start,
    employeeId: e.id,
    required: 1,
    actual: 0,
  };
  if (!e.skillsReviewedAt)
    return [
      {
        ...common,
        key: `review:${s.id}`,
        code: "unreviewed",
        skillId: null,
        message: `${e.name}: skill profile needs manager review.`,
      },
    ];
  return [
    ...new Set([
      ...rules.requiredByKind[s.kind],
      ...(s.requiredSkillIds ?? []),
    ]),
  ]
    .filter((k) => !qualified(e, k))
    .map((k) => ({
      ...common,
      key: `duty:${s.id}:${k}`,
      code: "qualification",
      skillId: k,
      message:
        k === "close"
          ? `${e.name}: not qualified to close independently.`
          : `${e.name}: missing ${skillName(rules, k)} qualification.`,
    }));
}
export function skillDiagnostics(
  w: Workspace,
  shifts: Shift[],
  dates: string[],
) {
  const rules = w.restaurant.skillRules,
    issues: SkillIssue[] = [],
    pairings: SupervisionPair[] = [],
    coverage: {
      date: string;
      minute: number;
      skillId: string;
      required: number;
      actual: number;
    }[] = [];
  const employees = new Map(w.employees.map((e) => [e.id, e]));
  for (const s of shifts.filter((s) => dates.includes(s.date))) {
    const e = employees.get(s.employeeId);
    if (e) issues.push(...assignmentSkillIssues(s, e, rules));
  }
  for (const date of [...new Set(dates)]) {
    const daily = shifts.filter((s) => s.date === date);
    for (
      let minute = w.restaurant.open;
      minute < w.restaurant.close;
      minute += 30
    ) {
      const active = [
        ...new Set(
          daily.filter((s) => onDuty(s, minute)).map((s) => s.employeeId),
        ),
      ]
        .map((id) => employees.get(id))
        .filter((e): e is Employee => Boolean(e));
      // Combine overlapping requirements for the same skill with max, not addition.
      const requirements = new Map<string, number>();
      for (const r of rules.requirements.filter(
        (r) =>
          r.days.includes(dayIndex(date)) &&
          r.start <= minute &&
          r.end >= minute + 30,
      ))
        requirements.set(
          r.skillId,
          Math.max(requirements.get(r.skillId) ?? 0, r.minimum),
        );
      for (const [skillId, required] of requirements) {
        const actual = active.filter((e) => qualified(e, skillId)).length;
        coverage.push({ date, minute, skillId, required, actual });
        if (actual < required)
          issues.push({
            key: `coverage:${date}:${minute}:${skillId}`,
            code: "coverage",
            date,
            minute,
            skillId,
            required,
            actual,
            message: `${date} ${time(minute)}: ${skillName(rules, skillId)} coverage ${actual}/${required}.`,
          });
      }
      const pairing = pairSupervision(active, rules.supervisionCapacity);
      pairings.push(...pairing.pairs.map((p) => ({ ...p, date, minute })));
      for (const e of pairing.unpaired)
        issues.push({
          key: `supervision:${date}:${minute}:${e.id}`,
          code: "supervision",
          date,
          minute,
          skillId: e.supervisionSkillId,
          employeeId: e.id,
          required: 1,
          actual: 0,
          message: `${date} ${time(minute)}: ${e.name} needs ${skillName(rules, e.supervisionSkillId!)} supervision; no capacity available.`,
        });
    }
  }
  return { issues, pairings, coverage };
}
/** Permit incremental draft repairs, but not newly introduced/worsened mandatory deficits. */
export function newSkillRisks(before: Workspace, after: Workspace) {
  const dates = [
    ...new Set(
      [...before.weeks, ...after.weeks].flatMap((w) =>
        w.shifts.map((s) => s.date),
      ),
    ),
  ];
  const prior = new Map(
    skillDiagnostics(
      before,
      before.weeks.flatMap((w) => w.shifts),
      dates,
    ).issues.map((i) => [i.key, i]),
  );
  return skillDiagnostics(
    after,
    after.weeks.flatMap((w) => w.shifts),
    dates,
  ).issues.filter(
    (i) =>
      i.required - i.actual >
      (prior.has(i.key)
        ? prior.get(i.key)!.required - prior.get(i.key)!.actual
        : 0),
  );
}
export interface CoverCandidate {
  employeeId: string;
  eligible: boolean;
  reasons: string[];
  scheduledHours: number;
  proposedHours: number;
  preferredHours: number;
  preferenceDistance: number;
  canClose: boolean;
  canSupervise: boolean;
}
export interface CoverAssessment {
  revision: number;
  shiftId: string;
  scope: string;
  externalSync: "not_connected";
  candidates: CoverCandidate[];
  existingIssues: SkillIssue[];
}
export function findShiftCover(
  w: Workspace,
  weekStart: string,
  shiftId: string,
): CoverAssessment {
  const week = getWeek(w, weekStart),
    original = week.shifts.find((s) => s.id === shiftId);
  if (!original) throw new Error("Shift does not exist in the selected week.");
  const all = w.weeks.flatMap((w) => w.shifts),
    baseline = skillDiagnostics(w, all, [original.date]);
  const relevant = (i: SkillIssue) =>
    i.date === original.date &&
    (i.code === "qualification" || i.code === "unreviewed"
      ? i.minute === original.start ||
        all.some(
          (s) =>
            s.date === i.date &&
            s.employeeId === i.employeeId &&
            s.start < original.end &&
            s.end > original.start,
        )
      : i.minute < original.end && i.minute + 30 > original.start);
  const candidates = w.employees
    .filter((e) => e.id !== original.employeeId)
    .map((e) => {
      const proposed = { ...original, employeeId: e.id };
      const next = all.map((s) => (s.id === original.id ? proposed : s));
      const reasons = validateShift(proposed, w.employees, next, w.restaurant);
      reasons.push(
        ...assignmentSkillIssues(proposed, e, w.restaurant.skillRules).map(
          (i) => i.message,
        ),
      );
      // A replacement must leave every other affected employee individually valid too.
      for (const s of next.filter(
        (s) => s.date === original.date && s.id !== original.id,
      ))
        reasons.push(
          ...validateShift(s, w.employees, next, w.restaurant).map(
            (m) =>
              `${w.employees.find((e) => e.id === s.employeeId)?.name}: ${m}`,
          ),
        );
      for (const issue of skillDiagnostics(w, next, [
        original.date,
      ]).issues.filter(relevant)) {
        const old = baseline.issues.find((i) => i.key === issue.key);
        const lost =
          !old || issue.required - issue.actual > old.required - old.actual;
        const prefix =
          issue.code === "coverage" && lost
            ? "Required qualified staffing would be lost. "
            : issue.code === "supervision"
              ? "Required trainee supervision is not covered. "
              : "";
        reasons.push(prefix + issue.message);
      }
      const scheduledHours = employeeHours(week, e.id),
        proposedHours = scheduledHours + paidHours(original);
      return {
        employeeId: e.id,
        eligible: reasons.length === 0,
        reasons: [...new Set(reasons)],
        scheduledHours,
        proposedHours,
        preferredHours: e.preferredHours,
        preferenceDistance: Math.abs(proposedHours - e.preferredHours),
        canClose: qualified(e, "close"),
        canSupervise: qualified(e, "train") && !e.supervisionSkillId,
      };
    })
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        a.preferenceDistance - b.preferenceDistance ||
        a.employeeId.localeCompare(b.employeeId),
    );
  return {
    revision: w.revision,
    shiftId,
    scope:
      "Configured rules only · full shift window and affected team · all stored assignments for rest and hour limits",
    externalSync: "not_connected",
    candidates,
    existingIssues: baseline.issues.filter(relevant),
  };
}
