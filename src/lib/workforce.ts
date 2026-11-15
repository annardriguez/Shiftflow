import { actorContext } from "./auth-context";
import { MANAGER_RECIPIENT, notificationFor } from "./workforce-types";
import { membershipNames } from "./database";
import { z } from "zod";
import { engine, engineWorkspace } from "./engine-client";
import { toAssignments, type Report } from "./planning-types";
import { readWorkspace, transactWorkspace } from "./store";
import { RevisionError, ValidationError } from "./mutations";
import { AccessError } from "./session";
import { dateAt, dayIndex, employeeHours, getWeek } from "./schedule";
import { qualified } from "./skills";
import type { Workspace, Shift, Window } from "./types";
import type {
  DemoActor,
  WorkforceRequest,
  ShiftRequest,
  RequestStatus,
  PortalData,
  CoverOption,
  SwapOption,
  CandidateIssue,
  RequestAssessment,
} from "./workforce-types";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (d) =>
      !Number.isNaN(Date.parse(d)) &&
      new Date(d + "T12:00:00Z").toISOString().slice(0, 10) === d,
    "Invalid date",
  );
const week = date.refine((d) => dayIndex(d) === 0, "Week must start Monday");
const minute = z.number().int().min(0).max(1440).multipleOf(30);
const window = z
  .object({ start: minute, end: minute })
  .strict()
  .refine((w) => w.start < w.end, "End must follow start");
const version = z.number().int().min(0),
  note = z.string().trim().max(500);
const shiftProposal = {
  kind: z.enum(["cover", "swap"]),
  week,
  shiftId: z.string().min(1).max(80),
  targetEmployeeId: z.string().min(1).max(80),
  counterWeek: week.optional(),
  counterShiftId: z.string().min(1).max(80).optional(),
};
export const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create-shift"),
      revision: version,
      ...shiftProposal,
      note,
    })
    .strict(),
  z
    .object({
      action: z.literal("record-agreement"),
      revision: version,
      requesterId: z.string().min(1).max(80),
      ...shiftProposal,
      note: z.string().trim().min(5).max(500),
      agreementConfirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("create-time-off"),
      revision: version,
      dates: z
        .array(date)
        .min(1)
        .max(31)
        .refine((d) => new Set(d).size === d.length, "Duplicate dates"),
      note,
    })
    .strict(),
  z
    .object({
      action: z.literal("create-availability"),
      revision: version,
      availability: z.array(window.nullable()).length(7),
      dateOverrides: z
        .array(z.object({ date, window: window.nullable() }).strict())
        .max(366)
        .refine(
          (a) => new Set(a.map((x) => x.date)).size === a.length,
          "Duplicate override dates",
        ),
      preferredHours: z.number().min(0).max(60).multipleOf(0.5),
      note,
    })
    .strict(),
  z
    .object({
      action: z.enum(["accept", "decline", "cancel", "approve", "reject"]),
      id: z.string().uuid(),
      version,
      revision: version,
      note,
    })
    .strict(),
  z
    .object({ action: z.literal("read-notification"), id: z.string().uuid() })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
function actorExists(w: Workspace, actor: DemoActor) {
  if (actor.role === "employee" && !w.employees.some((e) => e.id === actor.id))
    throw new AccessError("This fictional employee no longer exists.");
}
function manager(actor: DemoActor) {
  if (actor.role !== "manager")
    throw new AccessError("Manager approval is required.");
}
function employee(actor: DemoActor) {
  if (actor.role !== "employee")
    throw new AccessError(
      "Switch to a fictional employee to submit a personal request.",
    );
}
function active(status: RequestStatus) {
  return status === "pending-colleague" || status === "pending-manager";
}
function sameShift(a: Shift, b: Shift) {
  const key = (s: Shift) => [
    s.id,
    s.employeeId,
    s.date,
    s.start,
    s.end,
    s.breakStart,
    s.breakMinutes,
    s.kind,
    [...(s.requiredSkillIds ?? [])].sort(),
  ];
  return JSON.stringify(key(a)) === JSON.stringify(key(b));
}
function currentShift(w: Workspace, start: string, id: string) {
  const shift = w.weeks
    .find((x) => x.start === start)
    ?.shifts.find((s) => s.id === id);
  if (!shift)
    throw new RevisionError(
      "The original shift no longer exists. Request a change on the current roster.",
    );
  return shift;
}
function requireSources(w: Workspace, r: ShiftRequest) {
  if (!sameShift(currentShift(w, r.week, r.shift.id), r.shift))
    throw new RevisionError(
      "The offered shift changed. Cancel this request and submit it again.",
    );
  if (
    r.kind === "swap" &&
    (!r.counterWeek ||
      !r.counterShift ||
      !sameShift(
        currentShift(w, r.counterWeek, r.counterShift.id),
        r.counterShift,
      ))
  )
    throw new RevisionError(
      "The return shift changed. Cancel this request and submit it again.",
    );
}
export function propose(w: Workspace, r: WorkforceRequest) {
  const next = structuredClone(w),
    touched = new Set<string>();
  if ("targetEmployeeId" in r) {
    requireSources(w, r);
    const first = currentShift(next, r.week, r.shift.id);
    first.employeeId = r.targetEmployeeId;
    touched.add(r.week);
    if (r.kind === "swap") {
      currentShift(next, r.counterWeek!, r.counterShift!.id).employeeId =
        r.requesterId;
      touched.add(r.counterWeek!);
    }
  } else {
    const person = next.employees.find((e) => e.id === r.requesterId);
    if (!person) throw new ValidationError("Employee no longer exists.");
    if (r.kind === "time-off") {
      person.absentDates = [
        ...new Set([...person.absentDates, ...r.dates]),
      ].sort();
      if (person.absentDates.length > 366)
        throw new ValidationError(
          "The local demo supports at most 366 approved absence dates per employee.",
        );
    } else {
      if (r.preferredHours > person.maxHours)
        throw new ValidationError(
          "Preferred hours exceed the employee’s hard maximum.",
        );
      person.availability = r.availability;
      person.availabilityOverrides = r.dateOverrides;
      person.preferredHours = r.preferredHours;
    }
    for (const roster of next.weeks)
      if (
        roster.shifts.some(
          (s) =>
            s.employeeId === person.id &&
            (r.kind === "availability" || r.dates.includes(s.date)),
        )
      )
        touched.add(roster.start);
  }
  // Rest and rolling working-time effects can extend into the adjacent stored week.
  for (const start of [...touched])
    for (const n of [-7, 7])
      if (next.weeks.some((x) => x.start === dateAt(start, n)))
        touched.add(dateAt(start, n));
  return { next, touched: [...touched].sort() };
}
async function check(w: Workspace, r: WorkforceRequest) {
  const { next, touched } = propose(w, r),
    issues: Report["issues"] = [];
  for (const start of touched) {
    const roster = getWeek(next, start);
    const snapshot = await engine("workspace-snapshot", {
      fictional_data: true,
      rules_verified_for_demo: true,
      workspace: engineWorkspace(next),
      week_start: start,
    });
    const report = await engine<Report>("validate", {
      snapshot,
      assignments: toAssignments(roster.shifts),
    });
    issues.push(...report.issues);
  }
  return { next, touched, valid: issues.length === 0, issues };
}
type EngineIssue = Report["issues"][number];
function issueKey(i: EngineIssue) {
  return [i.code, i.day ?? "", i.minute ?? "", i.employee_id ?? "", i.message].join("|");
}
async function validateWeek(w: Workspace, start: string) {
  const snapshot = await engine("workspace-snapshot", {
    fictional_data: true,
    rules_verified_for_demo: true,
    workspace: engineWorkspace(w),
    week_start: start,
  });
  const report = await engine<Report>("validate", {
    snapshot,
    assignments: toAssignments(getWeek(w, start).shifts),
  });
  return report.issues;
}
/** Issues already present on the saved roster, cached per week for one read. */
function baselineCache(w: Workspace) {
  const cache = new Map<string, Promise<Set<string>>>();
  return (start: string) => {
    if (!cache.has(start))
      cache.set(
        start,
        validateWeek(w, start).then((issues) => new Set(issues.map(issueKey))),
      );
    return cache.get(start)!;
  };
}
/** Annotate engine findings with whether the saved roster already had them. */
async function annotate(
  issues: EngineIssue[],
  touched: string[],
  baseline: (start: string) => Promise<Set<string>>,
): Promise<CandidateIssue[]> {
  const known = new Set<string>();
  for (const start of touched)
    for (const k of await baseline(start)) known.add(k);
  const seen = new Set<string>();
  return issues
    .filter((i) => {
      const k = issueKey(i);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((i) => ({
      code: i.code,
      message: i.message,
      ...(i.day ? { day: i.day } : {}),
      ...(i.minute !== undefined && i.minute !== null ? { minute: i.minute } : {}),
      ...(i.employee_id ? { employeeId: i.employee_id } : {}),
      preExisting: known.has(issueKey(i)),
    }));
}
function assertValid(report: { valid: boolean; issues: Report["issues"] }) {
  if (!report.valid)
    throw new ValidationError(
      report.issues
        .slice(0, 12)
        .map((i) => `${i.day ?? ""} ${i.message}`)
        .join("; "),
    );
}
function audit(
  w: Workspace,
  actor: DemoActor,
  message: string,
  details: Record<string, unknown>,
) {
  w.audit.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actorId: actor.id,
    message,
    details,
  });
}
function transition(
  w: Workspace,
  r: WorkforceRequest,
  status: RequestStatus,
  actor: DemoActor,
  note: string,
) {
  const now = new Date().toISOString(),
    from = r.status;
  r.status = status;
  r.version++;
  r.updatedAt = now;
  r.history.push({ at: now, actorId: actor.id, from, to: status, note });
  audit(w, actor, `${r.kind} request ${status}.`, {
    requestId: r.id,
    from,
    to: status,
    note,
  });
  notify(w, r, `${r.kind} request ${status}${note ? `: ${note}` : ""}`);
}
function notify(w: Workspace, r: WorkforceRequest, message: string) {
  (w.notifications ??= []).unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    requestId: r.id,
    recipientIds: [
      ...new Set([
        r.requesterId,
        MANAGER_RECIPIENT,
        ...("targetEmployeeId" in r ? [r.targetEmployeeId] : []),
      ]),
    ],
    message,
    readBy: [],
    channel: "in-app-only",
  });
}
function base(
  actorId: string,
  note: string,
  status: RequestStatus,
  actor: DemoActor,
) {
  const at = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    version: 0,
    requesterId: actorId,
    status,
    createdAt: at,
    updatedAt: at,
    note,
    history: [{ at, actorId: actor.id, from: null, to: status, note }],
    externalSync: "not_connected" as const,
  };
}
function makeShift(
  w: Workspace,
  actor: DemoActor,
  c: z.infer<typeof commandSchema> & {
    kind: "cover" | "swap";
    week: string;
    shiftId: string;
    targetEmployeeId: string;
    counterWeek?: string;
    counterShiftId?: string;
    note: string;
  },
  requesterId = actor.id,
): ShiftRequest {
  const shift = currentShift(w, c.week, c.shiftId);
  if (shift.employeeId !== requesterId)
    throw new AccessError("Only the shift owner can offer it.");
  if (
    c.targetEmployeeId === requesterId ||
    !w.employees.some((e) => e.id === c.targetEmployeeId)
  )
    throw new ValidationError("Choose a different existing colleague.");
  let counterShift: Shift | undefined;
  if (c.kind === "swap") {
    if (!c.counterWeek || !c.counterShiftId)
      throw new ValidationError("Select the colleague’s return shift.");
    counterShift = currentShift(w, c.counterWeek, c.counterShiftId);
    if (
      counterShift.employeeId !== c.targetEmployeeId ||
      counterShift.id === shift.id
    )
      throw new ValidationError(
        "Return shift must belong to the receiving colleague.",
      );
  } else if (c.counterWeek || c.counterShiftId)
    throw new ValidationError("A cover offer has no return shift.");
  return {
    ...base(
      requesterId,
      c.note,
      actor.role === "manager" ? "pending-manager" : "pending-colleague",
      actor,
    ),
    kind: c.kind,
    targetEmployeeId: c.targetEmployeeId,
    week: c.week,
    shift: structuredClone(shift),
    ...(counterShift
      ? {
          counterWeek: c.counterWeek,
          counterShift: structuredClone(counterShift),
        }
      : {}),
    source: actor.role === "manager" ? "manager-recorded" : "employee",
  };
}
async function applyApproval(
  current: Workspace,
  r: WorkforceRequest,
  actor: DemoActor,
  note: string,
) {
  manager(actor);
  const checked = await check(current, r);
  assertValid(checked);
  const w = checked.next,
    request = w.requests!.find((x) => x.id === r.id)!;
  const before = current.weeks
    .filter((x) => checked.touched.includes(x.start))
    .map((x) => ({ start: x.start, shifts: x.shifts }));
  for (const start of checked.touched) {
    const week = w.weeks.find((x) => x.start === start);
    if (week) {
      week.validationPolicy = "full-engine";
      if (week.provenance) week.provenance.edited = true;
    }
  }
  transition(w, request, "applied", actor, note);
  request.approvedBy = actor.id;
  request.approvedAt = request.updatedAt;
  request.appliedRevision = current.revision + 1;
  audit(
    w,
    actor,
    `Approved and applied ${request.kind} in ShiftFlow; Strobbo not connected.`,
    {
      requestId: r.id,
      approvedBy: actor.id,
      approvedAt: request.approvedAt,
      before,
      after: w.weeks
        .filter((x) => checked.touched.includes(x.start))
        .map((x) => ({ start: x.start, shifts: x.shifts })),
      employeeBefore: current.employees.find((e) => e.id === r.requesterId),
      employeeAfter: w.employees.find((e) => e.id === r.requesterId),
      externalSync: "not_connected",
    },
  );
  for (const other of w.requests ?? [])
    if (
      other.id !== r.id &&
      active(other.status) &&
      (other.kind === "cover" || other.kind === "swap")
    ) {
      try {
        requireSources(w, other);
      } catch {
        transition(
          w,
          other,
          "invalidated",
          actor,
          "A referenced shift changed after another approval. Submit a new request.",
        );
      }
    }
  return w;
}
export async function command(actor: DemoActor, c: Command) {
  const principal = actorContext();
  if (
    principal.id !== actor.id ||
    principal.role !== actor.role ||
    principal.tenantId !== actor.tenantId
  )
    throw new AccessError("Actor does not match the authenticated membership.");
  actor = principal;
  return transactWorkspace(async (current) => {
    actorExists(current, actor);
    if (c.action !== "read-notification" && c.revision !== current.revision)
      throw new RevisionError(
        "Workspace changed. Refresh requests and review the current roster before trying again.",
      );
    let w = structuredClone(current);
    w.requests ??= [];
    w.notifications ??= [];
    if (c.action === "read-notification") {
      const n = w.notifications.find(
        (n) => n.id === c.id && notificationFor(n, actor),
      );
      if (!n)
        throw new AccessError(
          "Notification is not addressed to this identity.",
        );
      if (!n.readBy.includes(actor.id)) n.readBy.push(actor.id);
    } else if (c.action === "create-shift" || c.action === "record-agreement") {
      if (c.action === "create-shift") employee(actor);
      else manager(actor);
      const r = makeShift(
        w,
        actor,
        c,
        c.action === "record-agreement" ? c.requesterId : actor.id,
      );
      if (
        w.requests.some(
          (q) =>
            active(q.status) &&
            (q.kind === "cover" || q.kind === "swap") &&
            q.requesterId === r.requesterId &&
            q.shift.id === r.shift.id,
        )
      )
        throw new ValidationError(
          "This shift already has an active request. Cancel it before making another.",
        );
      assertValid(await check(w, r));
      w.requests.unshift(r);
      audit(w, actor, `Created ${r.kind} request.`, {
        requestId: r.id,
        shift: r.shift,
        counterShift: r.counterShift,
        source: r.source,
      });
      notify(
        w,
        r,
        `${r.kind} offer awaiting ${r.status === "pending-colleague" ? "colleague acceptance" : "manager application"}.`,
      );
      if (c.action === "record-agreement")
        w = await applyApproval(w, r, actor, c.note);
    } else if (
      c.action === "create-time-off" ||
      c.action === "create-availability"
    ) {
      employee(actor);
      const r: WorkforceRequest =
        c.action === "create-time-off"
          ? {
              ...base(actor.id, c.note, "pending-manager", actor),
              kind: "time-off",
              dates: c.dates,
            }
          : {
              ...base(actor.id, c.note, "pending-manager", actor),
              kind: "availability",
              availability: c.availability,
              dateOverrides: c.dateOverrides,
              preferredHours: c.preferredHours,
            };
      if (
        r.kind === "availability" &&
        r.preferredHours > w.employees.find((e) => e.id === actor.id)!.maxHours
      )
        throw new ValidationError(
          "Preferred hours exceed the employee’s hard maximum.",
        );
      w.requests.unshift(r);
      audit(w, actor, `Submitted ${r.kind} request.`, { requestId: r.id });
      notify(w, r, `${r.kind} request awaiting manager approval.`);
    } else {
      const r = w.requests.find((q) => q.id === c.id);
      if (!r) throw new ValidationError("Request does not exist.");
      if (
        actor.role === "employee" &&
        r.requesterId !== actor.id &&
        (!("targetEmployeeId" in r) || r.targetEmployeeId !== actor.id)
      )
        throw new AccessError("This request is not addressed to you.");
      if (r.version !== c.version)
        throw new RevisionError("Request changed. Refresh before acting.");
      if (!active(r.status))
        throw new RevisionError(
          "This request is already final. It cannot be applied again.",
        );
      if (c.action === "cancel") {
        if (r.requesterId !== actor.id && actor.role !== "manager")
          throw new AccessError("Only the requester or manager can cancel.");
        transition(w, r, "cancelled", actor, c.note);
      } else if (c.action === "accept" || c.action === "decline") {
        if (
          !("targetEmployeeId" in r) ||
          actor.role !== "employee" ||
          r.targetEmployeeId !== actor.id
        )
          throw new AccessError("Only the receiving colleague can respond.");
        if (r.status !== "pending-colleague")
          throw new RevisionError(
            "This offer is no longer awaiting acceptance.",
          );
        if (c.action === "accept") {
          assertValid(await check(w, r));
          transition(w, r, "pending-manager", actor, c.note);
        } else transition(w, r, "declined", actor, c.note);
      } else {
        manager(actor);
        if (c.action === "reject") transition(w, r, "rejected", actor, c.note);
        else {
          if (r.status !== "pending-manager")
            throw new ValidationError(
              "The colleague must accept before manager approval.",
            );
          w = await applyApproval(w, r, actor, c.note);
        }
      }
    }
    w.revision = current.revision + 1;
    return w;
  });
}
export async function portal(actor: DemoActor): Promise<PortalData> {
  const w = await readWorkspace();
  actorExists(w, actor);
  employee(actor);
  const requests = (w.requests ?? []).filter(
    (r) =>
      r.requesterId === actor.id ||
      ("targetEmployeeId" in r && r.targetEmployeeId === actor.id),
  );
  const relevantIds = new Set([
    actor.id,
    MANAGER_RECIPIENT,
    ...requests.flatMap((r) => [
      r.requesterId,
      ...("targetEmployeeId" in r ? [r.targetEmployeeId] : []),
    ]),
  ]);
  return {
    actor: {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      tenantId: actor.tenantId,
      tenantName: actor.tenantName,
      email: actor.email,
    },
    revision: w.revision,
    employee: w.employees.find((e) => e.id === actor.id)!,
    skillCatalog: w.restaurant.skillRules.catalog,
    weeks: w.weeks.map((r) => ({
      start: r.start,
      shifts: r.shifts.filter((s) => s.employeeId === actor.id),
    })),
    requests,
    notifications: (w.notifications ?? []).filter((n) =>
      notificationFor(n, actor),
    ),
    names: {
      ...(await membershipNames()),
      ...Object.fromEntries([
        [MANAGER_RECIPIENT, "Jamie de Boer"],
        ["demo-manager-jamie", "Jamie de Boer"],
        ...w.employees
          .filter((e) => relevantIds.has(e.id))
          .map((e) => [e.id, e.name]),
      ]),
    },
    externalSync: "not_connected",
  };
}
export async function replacements(
  actor: DemoActor,
  start: string,
  id: string,
  mode: "cover" | "swap",
) {
  const w = await readWorkspace();
  actorExists(w, actor);
  const offered = currentShift(w, week.parse(start), id);
  if (actor.role !== "manager" && offered.employeeId !== actor.id)
    throw new AccessError("You can only assess cover for your own shift.");
  const owner = {
    id: offered.employeeId,
    name: w.employees.find((e) => e.id === offered.employeeId)!.name,
    role: "employee" as const,
  };
  const options: (CoverOption | SwapOption)[] = [];
  const baseline = baselineCache(w);
  if (mode === "cover")
    for (const e of w.employees.filter((e) => e.id !== owner.id)) {
      const r = makeShift(w, owner, {
        action: "create-shift",
        revision: w.revision,
        kind: "cover",
        week: start,
        shiftId: id,
        targetEmployeeId: e.id,
        note: "",
      });
      const result = await check(w, r);
      options.push({
        employeeId: e.id,
        name: e.name,
        eligible: result.valid,
        reasons: [
          ...new Set(result.issues.map((i) => `${i.day ?? ""} ${i.message}`)),
        ],
        scheduledHours: employeeHours(getWeek(w, start), e.id),
        preferredHours: e.preferredHours,
        canClose: qualified(e, "close"),
        canSupervise: qualified(e, "train") && !e.supervisionSkillId,
        issues: result.valid
          ? []
          : await annotate(result.issues, result.touched, baseline),
        role: e.role,
        skillsReviewed: Boolean(e.skillsReviewedAt),
        maxHours: e.maxHours,
      });
    }
  else
    for (const roster of w.weeks.filter(
      (x) =>
        Math.abs((Date.parse(x.start) - Date.parse(start)) / 86400000) <= 7,
    ))
      for (const s of roster.shifts.filter((s) => s.employeeId !== owner.id)) {
        const r = makeShift(w, owner, {
          action: "create-shift",
          revision: w.revision,
          kind: "swap",
          week: start,
          shiftId: id,
          targetEmployeeId: s.employeeId,
          counterWeek: roster.start,
          counterShiftId: s.id,
          note: "",
        });
        const result = await check(w, r);
        options.push({
          shift: s,
          week: roster.start,
          employeeName: w.employees.find((e) => e.id === s.employeeId)!.name,
          eligible: result.valid,
          reasons: [
            ...new Set(result.issues.map((i) => `${i.day ?? ""} ${i.message}`)),
          ],
          issues: result.valid
            ? []
            : await annotate(result.issues, result.touched, baseline),
          canClose: qualified(
            w.employees.find((e) => e.id === s.employeeId)!,
            "close",
          ),
          skillsReviewed: Boolean(
            w.employees.find((e) => e.id === s.employeeId)!.skillsReviewedAt,
          ),
        });
      }
  options.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      ("scheduledHours" in a && "scheduledHours" in b
        ? Math.abs(
            a.scheduledHours +
              (offered.end - offered.start - offered.breakMinutes) / 60 -
              a.preferredHours,
          ) -
          Math.abs(
            b.scheduledHours +
              (offered.end - offered.start - offered.breakMinutes) / 60 -
              b.preferredHours,
          )
        : 0),
  );
  return {
    revision: w.revision,
    offeredShift: offered,
    options,
    scope:
      "Entire proposed roster and adjacent stored weeks; availability, qualification, supervision, rest, breaks, working-time rules. Hour preferences rank eligible covers only.",
    externalSync: "not_connected",
  };
}

/**
 * Read-only preflight: re-run the same mandatory checks approval would run,
 * against the current roster, without writing anything. Approval still
 * revalidates inside its own transaction; this result is never authority.
 */
export async function assess(
  actor: DemoActor,
  id: string,
): Promise<RequestAssessment> {
  const w = await readWorkspace();
  actorExists(w, actor);
  const r = (w.requests ?? []).find((q) => q.id === id);
  if (!r) throw new ValidationError("Request does not exist.");
  if (
    actor.role !== "manager" &&
    r.requesterId !== actor.id &&
    !("targetEmployeeId" in r && r.targetEmployeeId === actor.id)
  )
    throw new AccessError("This request is not addressed to you.");
  if ("targetEmployeeId" in r) {
    try {
      requireSources(w, r);
    } catch {
      return {
        requestId: r.id,
        revision: w.revision,
        valid: false,
        sourcesCurrent: false,
        issues: [],
        weeks: [],
      };
    }
  }
  const result = await check(w, r);
  return {
    requestId: r.id,
    revision: w.revision,
    valid: result.valid,
    sourcesCurrent: true,
    issues: result.valid
      ? []
      : await annotate(result.issues, result.touched, baselineCache(w)),
    weeks: result.touched,
  };
}
