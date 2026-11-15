import { MANAGER_RECIPIENT } from "./workforce-types";
import { z } from "zod";
import type { MutationRequest, Workspace } from "./types";
import { dateAt, dayIndex, emptyWeek, validateShift } from "./schedule";
import { seed } from "./seed";
import { assignmentSkillIssues, DEMO_MANAGER, newSkillRisks } from "./skills";
const minute = z.number().int().min(0).max(1440).multipleOf(30);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v,
    "Invalid calendar date",
  );
const week = date.refine((v) => dayIndex(v) === 0, "Week must start on Monday");
const windowSchema = z
  .object({ start: minute, end: minute })
  .refine((v) => v.start < v.end, "Availability end must follow start");
const availability = z.array(windowSchema.nullable()).length(7);
const kind = z.enum(["Opening", "Midday", "Closing"]);
export const employeeSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().trim().min(2).max(80),
    email: z.string().email().max(120),
    role: z.enum(["Team member", "Shift leader"]),
    color: z.enum(["sage", "blue", "peach", "lilac", "rose", "sand"]),
    preferredHours: z.number().min(0).max(60).multipleOf(0.5),
    maxHours: z.number().min(0).max(60).multipleOf(0.5),
    minRestHours: z.number().min(11).max(24),
    maxShiftHours: z.number().min(1).max(9),
    eligible: z.array(kind).min(1).max(3),
    availability,
    absentDates: z.array(date).max(366),
  })
  .refine(
    (v) => v.preferredHours <= v.maxHours,
    "Preferred hours must not exceed maximum hours",
  );
const skillId = z.string().trim().min(1).max(80);
const uniqueSkills = z
  .array(skillId)
  .max(40)
  .refine((v) => new Set(v).size === v.length, "Duplicate skill IDs");
export const skillRulesSchema = z
  .object({
    catalog: z
      .array(z.object({ id: skillId, name: z.string().trim().min(2).max(80) }))
      .min(1)
      .max(40),
    requirements: z
      .array(
        z
          .object({
            id: skillId,
            skillId,
            days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
            start: minute,
            end: minute,
            minimum: z.number().int().min(1).max(20),
          })
          .refine((r) => r.start < r.end, "Requirement end must follow start"),
      )
      .max(80),
    requiredByKind: z.object({
      Opening: uniqueSkills,
      Midday: uniqueSkills,
      Closing: uniqueSkills,
    }),
    supervisionCapacity: z.number().int().min(1).max(10),
  })
  .superRefine((rules, ctx) => {
    const ids = rules.catalog.map((s) => s.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Skill IDs must be unique" });
    if (
      new Set(rules.requirements.map((r) => r.id)).size !==
      rules.requirements.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Requirement IDs must be unique",
      });
    const referenced = [
      ...rules.requirements.map((r) => r.skillId),
      ...Object.values(rules.requiredByKind).flat(),
    ];
    if (referenced.some((id) => !ids.includes(id)))
      ctx.addIssue({
        code: "custom",
        message: "Unknown skill referenced by a rule",
      });
  });
export const shiftSchema = z.object({
  id: z.string().min(1).max(80),
  employeeId: z.string().min(1),
  date,
  start: minute,
  end: minute,
  breakStart: minute.nullable(),
  breakMinutes: z.number().int().min(0).max(120).multipleOf(30),
  kind,
  requiredSkillIds: uniqueSkills.optional(),
});
const revision = { revision: z.number().int().min(0) };
export const mutationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("competencies"),
    employeeId: z.string(),
    skillIds: uniqueSkills,
    supervisionSkillId: skillId.nullable(),
    ...revision,
  }),
  z.object({
    type: z.literal("skill-rules"),
    rules: skillRulesSchema,
    ...revision,
  }),
  z.object({
    type: z.literal("employee"),
    employee: employeeSchema,
    ...revision,
  }),
  z.object({
    type: z.literal("availability"),
    employeeId: z.string(),
    availability,
    ...revision,
  }),
  z.object({
    type: z.literal("budgets"),
    week,
    budgets: z.array(z.number().min(0).max(300).multipleOf(0.5)).length(7),
    ...revision,
  }),
  z.object({ type: z.literal("shift"), week, shift: shiftSchema, ...revision }),
  z.object({
    type: z.literal("delete-shift"),
    week,
    id: z.string(),
    ...revision,
  }),
  z.object({
    type: z.literal("scenario"),
    scenario: z.enum(["normal", "high-demand", "shortage"]),
    ...revision,
  }),
]);
export class ValidationError extends Error {}
export class RevisionError extends Error {}
export function applyMutation(
  current: Workspace,
  input: MutationRequest,
  now = new Date().toISOString(),
  actorId = DEMO_MANAGER,
): Workspace {
  const m = mutationSchema.parse(input);
  if (m.revision !== current.revision)
    throw new RevisionError(
      "This workspace changed in another tab. Reload and try again.",
    );
  const w: Workspace = structuredClone(current);
  const allShifts = () => w.weeks.flatMap((w) => w.shifts);
  let message = "";
  let details: Record<string, unknown> | undefined;
  if (m.type === "competencies") {
    const e = w.employees.find((e) => e.id === m.employeeId);
    if (!e) throw new ValidationError("Employee does not exist.");
    const ids = w.restaurant.skillRules.catalog.map((k) => k.id);
    if (
      [
        ...m.skillIds,
        ...(m.supervisionSkillId ? [m.supervisionSkillId] : []),
      ].some((k) => !ids.includes(k))
    )
      throw new ValidationError("Unknown competency.");
    details = {
      employeeId: e.id,
      before: {
        skillIds: e.competencies.map((q) => q.skillId),
        supervisionSkillId: e.supervisionSkillId,
        reviewedAt: e.skillsReviewedAt,
      },
      after: { skillIds: m.skillIds, supervisionSkillId: m.supervisionSkillId },
    };
    e.competencies = m.skillIds.map(
      (skillId) =>
        e.competencies.find((q) => q.skillId === skillId) ?? {
          skillId,
          verifiedBy: actorId,
          verifiedAt: now,
        },
    );
    e.supervisionSkillId = m.supervisionSkillId;
    e.skillsReviewedAt = now;
    message = `${e.name}: competencies reviewed by local demo manager. Any resulting roster gaps require review.`;
  }
  if (m.type === "skill-rules") {
    const ids = m.rules.catalog.map((k) => k.id);
    const refs = [
      ...w.employees.flatMap((e) => [
        ...e.competencies.map((q) => q.skillId),
        ...(e.supervisionSkillId ? [e.supervisionSkillId] : []),
      ]),
      ...allShifts().flatMap((s) => s.requiredSkillIds ?? []),
    ];
    if (refs.some((k) => !ids.includes(k)))
      throw new ValidationError(
        "Cannot remove a skill while employee profiles or assignments reference it.",
      );
    if (
      m.rules.requirements.some(
        (r) => r.start < w.restaurant.open || r.end > w.restaurant.close,
      )
    )
      throw new ValidationError(
        "Skill requirements must fit preparation hours.",
      );
    details = { before: w.restaurant.skillRules, after: m.rules };
    w.restaurant.skillRules = m.rules;
    message =
      "Restaurant competency coverage and supervision rules updated by local demo manager. Review draft gaps.";
  }
  if (m.type === "scenario") {
    const next = seed(m.scenario);
    next.revision = current.revision + 1;
    next.audit = [
      {
        id: crypto.randomUUID(),
        at: now,
        message: `Loaded ${m.scenario} fictional fixture. Previous demo edits were reset.`,
      },
      ...current.audit,
    ];
    next.requests = (current.requests ?? []).map((r) =>
      ["pending-colleague", "pending-manager"].includes(r.status)
        ? {
            ...r,
            status: "invalidated" as const,
            version: r.version + 1,
            updatedAt: now,
            history: [
              ...r.history,
              {
                at: now,
                actorId,
                from: r.status,
                to: "invalidated" as const,
                note: "Fictional scenario reset; original shifts no longer authoritative.",
              },
            ],
          }
        : r,
    );
    next.notifications = [...(current.notifications ?? [])];
    for (const request of next.requests.filter(
      (r) => r.status === "invalidated" && r.updatedAt === now,
    )) {
      next.notifications.unshift({
        id: crypto.randomUUID(),
        at: now,
        requestId: request.id,
        recipientIds: [
          ...new Set([
            request.requesterId,
            MANAGER_RECIPIENT,
            ...("targetEmployeeId" in request
              ? [request.targetEmployeeId]
              : []),
          ]),
        ],
        message: "Request invalidated by fictional scenario reset.",
        readBy: [],
        channel: "in-app-only",
      });
    }
    return next;
  }
  if (m.type === "employee") {
    if (
      w.employees.some(
        (e) =>
          e.id !== m.employee.id &&
          e.email.toLowerCase() === m.employee.email.toLowerCase(),
      )
    )
      throw new ValidationError(
        "This email already belongs to another employee.",
      );
    const existing = w.employees.find((e) => e.id === m.employee.id);
    const profile = {
      ...m.employee,
      availabilityOverrides: existing?.availabilityOverrides ?? [],
      competencies: existing?.competencies ?? [],
      supervisionSkillId: existing?.supervisionSkillId ?? null,
      skillsReviewedAt: existing?.skillsReviewedAt ?? null,
    };
    const exists = Boolean(existing);
    if (!exists && w.employees.length >= 100)
      throw new ValidationError("Demo workspace supports up to 100 employees.");
    w.employees = exists
      ? w.employees.map((e) => (e.id === m.employee.id ? profile : e))
      : [...w.employees, profile];
    message = `${exists ? "Updated" : "Added"} employee ${m.employee.name}.`;
  }
  if (m.type === "availability") {
    if (!w.employees.some((e) => e.id === m.employeeId))
      throw new ValidationError("Employee does not exist.");
    w.employees = w.employees.map((e) =>
      e.id === m.employeeId ? { ...e, availability: m.availability } : e,
    );
    message = `Updated availability for ${w.employees.find((e) => e.id === m.employeeId)!.name}.`;
  }
  if (m.type === "budgets" || m.type === "shift" || m.type === "delete-shift") {
    if (!w.weeks.some((x) => x.start === m.week))
      w.weeks.push(emptyWeek(m.week, w.scenario));
    const target = w.weeks.find((x) => x.start === m.week)!;
    if (m.type === "budgets") {
      target.budgets = m.budgets;
      message = `Updated labour targets for ${m.week}.`;
    }
    if (m.type === "shift") {
      if (m.shift.date < m.week || m.shift.date > dateAt(m.week, 6))
        throw new ValidationError("Shift date is outside the selected week.");
      if (
        w.weeks.some(
          (x) =>
            x.start !== m.week && x.shifts.some((s) => s.id === m.shift.id),
        )
      )
        throw new ValidationError("Shift ID belongs to another week.");
      const errors = validateShift(
        m.shift,
        w.employees,
        allShifts(),
        w.restaurant,
      );
      if (
        (m.shift.requiredSkillIds ?? []).some(
          (k) => !w.restaurant.skillRules.catalog.some((s) => s.id === k),
        )
      )
        throw new ValidationError("Unknown assignment competency.");
      const employee = w.employees.find((e) => e.id === m.shift.employeeId);
      if (employee)
        errors.push(
          ...assignmentSkillIssues(
            m.shift,
            employee,
            w.restaurant.skillRules,
          ).map((i) => i.message),
        );
      if (errors.length) throw new ValidationError(errors.join(" "));
      target.shifts = [
        ...target.shifts.filter((s) => s.id !== m.shift.id),
        m.shift,
      ];
      message = `Saved ${m.shift.kind.toLowerCase()} shift on ${m.shift.date}.`;
    }
    if (m.type === "delete-shift") {
      if (!target.shifts.some((s) => s.id === m.id))
        throw new ValidationError("Shift no longer exists.");
      target.shifts = target.shifts.filter((s) => s.id !== m.id);
      message = `Removed a shift from week ${m.week}.`;
    }
  }
  if (m.type === "availability" || m.type === "employee") {
    for (const s of allShifts()) {
      const errors = validateShift(s, w.employees, allShifts(), w.restaurant);
      if (errors.length)
        throw new ValidationError(
          `Change conflicts with shift on ${s.date}: ${errors.join(" ")} Edit the shift first.`,
        );
    }
  }
  if (m.type === "shift" || m.type === "delete-shift") {
    const risks = newSkillRisks(current, w);
    if (risks.length)
      throw new ValidationError(
        `Change creates a mandatory skill or supervision gap: ${risks
          .slice(0, 3)
          .map((i) => i.message)
          .join(
            " ",
          )} Existing draft gaps remain visible; add qualified cover first.`,
      );
  }
  for (const week of w.weeks) {
    if (week.provenance) week.provenance.edited = true;
  }
  w.revision++;
  w.audit.unshift({
    id: crypto.randomUUID(),
    at: now,
    actorId,
    message,
    ...(details ? { details } : {}),
  });

  return w;
}
