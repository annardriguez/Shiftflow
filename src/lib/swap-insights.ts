/**
 * Presentation layer for replacement eligibility and request states.
 *
 * Nothing here decides eligibility. The independent engine validator is the
 * only authority on hard constraints; this module translates its findings into
 * language a restaurant team understands and orders already-assessed options.
 * A soft preference can never turn an ineligible option into a suitable one.
 */
import type { Shift } from "./types";
import type {
  CandidateIssue,
  CoverOption,
  RequestStatus,
  SwapOption,
  WorkforceRequest,
} from "./workforce-types";

export type Verdict =
  /** Passed every mandatory check. Can be asked. */
  | "suitable"
  /** Blocked only because their skill profile has not been verified yet. */
  | "unverified"
  /** Blocked only by gaps that already exist in the saved roster. */
  | "roster-blocked"
  /** Fails one or more personal or team constraints caused by this change. */
  | "not-eligible";

export interface Chip {
  label: string;
  tone: "positive" | "neutral" | "caution" | "negative";
}

export interface CandidateInsight {
  verdict: Verdict;
  /** Short status label, e.g. "Suitable replacement". */
  label: string;
  /** One-sentence explanation of the verdict. */
  summary: string;
  /** Distinct plain-language blockers, most important first. */
  blockers: string[];
  chips: Chip[];
  /** Weekly paid hours after taking the shift (cover only). */
  hoursAfter?: number;
}

const SKILL_WORDS: Record<string, string> = {
  close: "close",
  open: "open",
  train: "supervise trainees",
  service: "work general service",
};

function skillFromMessage(message: string) {
  return (
    /personal duty: (\w+)/.exec(message)?.[1] ??
    /qualified (\w+) coverage/.exec(message)?.[1] ??
    null
  );
}

/** Plain-language sentence for a single engine finding. */
export function describeIssue(issue: Pick<CandidateIssue, "code" | "message">) {
  const skill = skillFromMessage(issue.message);
  switch (issue.code) {
    case "availability":
      return "Not available during this shift";
    case "absence":
      return "Has approved time off that day";
    case "overlap_or_rest":
      return "Already working, or too little rest between shifts";
    case "daily_shifts":
      return "Already has a shift that day";
    case "weekly_hours":
    case "rolling_hours":
      return "Would go over their maximum weekly hours";
    case "daily_hours":
      return "Would go over their daily hour limit";
    case "weekly_days":
      return "Would work too many days this week";
    case "consecutive_days":
      return "Would work too many days in a row";
    case "shift_eligibility":
      return "Not set up for this type of shift";
    case "skills_unreviewed":
      return "Skills not yet verified by a manager";
    case "personal_qualification":
      return skill === "close"
        ? "Not qualified to close"
        : skill === "open"
          ? "Not qualified to open"
          : skill && SKILL_WORDS[skill]
            ? `Not qualified to ${SKILL_WORDS[skill]}`
            : "Missing a required qualification";
    case "skill_coverage":
      return skill === "close"
        ? "No qualified closer would be on shift"
        : skill === "open"
          ? "No qualified opener would be on shift"
          : skill === "service"
            ? "General service would be under-staffed"
            : "A required skill would not be covered";
    case "supervision":
      return "A trainee would be left without a supervisor";
    case "mandatory_headcount":
      return "Minimum staffing would not be met";
    case "shift_length":
    case "break_required":
    case "continuous_work":
      return "Shift length doesn't fit their working-time rules";
    case "operating_window":
    case "opening_time":
    case "closing_time":
      return "Shift times fall outside opening hours";
    default:
      return issue.message;
  }
}

const SEVERITY: Record<string, number> = {
  availability: 0,
  absence: 0,
  overlap_or_rest: 1,
  daily_shifts: 1,
  personal_qualification: 2,
  skills_unreviewed: 2,
  shift_eligibility: 2,
  weekly_hours: 3,
  rolling_hours: 3,
  daily_hours: 3,
  weekly_days: 3,
  consecutive_days: 3,
  skill_coverage: 4,
  supervision: 4,
  mandatory_headcount: 4,
};

/** Distinct, severity-ordered plain-language blockers. */
export function blockersFor(issues: CandidateIssue[]) {
  const ordered = [...issues].sort(
    (a, b) => (SEVERITY[a.code] ?? 5) - (SEVERITY[b.code] ?? 5),
  );
  return [...new Set(ordered.map(describeIssue))];
}

/**
 * Classify an already-assessed option. `issues` come from the engine; when an
 * older server only sent string reasons, every failure is treated as
 * "not-eligible" so nothing is presented as more eligible than it is.
 */
export function classify(
  eligible: boolean,
  issues: CandidateIssue[] | undefined,
  candidateId: string | undefined,
): Verdict {
  if (eligible) return "suitable";
  if (!issues?.length) return "not-eligible";
  const introduced = issues.filter((i) => !i.preExisting);
  if (!introduced.length) return "roster-blocked";
  const personal = introduced.filter((i) => i.employeeId === candidateId);
  const unreviewed = personal.some((i) => i.code === "skills_unreviewed");
  if (
    unreviewed &&
    // Unreviewed profiles fail closed on every qualification, so those follow.
    personal.every(
      (i) =>
        i.code === "skills_unreviewed" || i.code === "personal_qualification",
    ) &&
    // Team skill/supervision shortfalls are expected when the newcomer's skills
    // cannot be counted; any other team finding is a real blocker.
    introduced.every(
      (i) =>
        personal.includes(i) ||
        i.code === "skill_coverage" ||
        i.code === "supervision",
    )
  )
    return "unverified";
  return "not-eligible";
}

const LABELS: Record<Verdict, string> = {
  suitable: "Suitable replacement",
  unverified: "Needs manager review",
  "roster-blocked": "Blocked by existing gap",
  "not-eligible": "Not eligible",
};

export function verdictLabel(v: Verdict) {
  return LABELS[v];
}

function paid(s: Shift) {
  return (s.end - s.start - s.breakMinutes) / 60;
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function explainCover(
  option: CoverOption,
  shift: Shift,
): CandidateInsight {
  const verdict = classify(option.eligible, option.issues, option.employeeId);
  const hoursAfter = option.scheduledHours + paid(shift);
  const chips: Chip[] = [];
  if (verdict === "suitable") chips.push({ label: "Available", tone: "positive" });
  if (shift.kind === "Closing")
    chips.push(
      option.canClose
        ? { label: "Can close", tone: "positive" }
        : option.skillsReviewed === false
          ? { label: "Closing not confirmed", tone: "caution" }
          : { label: "Can't close", tone: "negative" },
    );
  else if (option.canClose) chips.push({ label: "Can close", tone: "neutral" });
  if (option.role === "Shift leader")
    chips.push({ label: "Shift leader", tone: "neutral" });
  if (option.canSupervise) chips.push({ label: "Can supervise", tone: "neutral" });
  if (option.skillsReviewed === false)
    chips.push({ label: "Skills unverified", tone: "caution" });

  const blockers = blockersFor(
    (option.issues ?? []).filter((i) => !i.preExisting),
  );
  let summary: string;
  if (verdict === "suitable") {
    const room = option.preferredHours - hoursAfter;
    const parts = [
      shift.kind === "Closing" && option.canClose
        ? "Meets the closing requirement"
        : "Meets every requirement for this shift",
      "has no conflicting shift",
    ];
    summary =
      `${parts.join(" and ")}. ` +
      (room >= 0
        ? `Would be on ${fmt(hoursAfter)}h of ${fmt(option.preferredHours)}h preferred this week.`
        : `Would be ${fmt(-room)}h above their preferred ${fmt(option.preferredHours)}h this week.`);
    if (room < 0) chips.push({ label: "Above preferred hours", tone: "caution" });
  } else if (verdict === "unverified")
    summary =
      "Could be a fit, but their skills haven't been verified yet. A manager needs to review their profile first.";
  else if (verdict === "roster-blocked")
    summary =
      "Nothing about this person blocks it, but the current roster already has a gap in this period that must be fixed first.";
  else
    summary =
      option.reasons.length && !option.issues
        ? option.reasons[0].trim()
        : (blockers[0] ?? "Doesn't pass a mandatory check") + ".";
  return {
    verdict,
    label: LABELS[verdict],
    summary,
    blockers,
    chips,
    hoursAfter,
  };
}

export function explainSwap(option: SwapOption): CandidateInsight {
  const verdict = classify(option.eligible, option.issues, option.shift.employeeId);
  const chips: Chip[] = [{ label: option.shift.kind, tone: "neutral" }];
  if (option.canClose) chips.push({ label: "Can close", tone: "neutral" });
  const blockers = blockersFor(
    (option.issues ?? []).filter((i) => !i.preExisting),
  );
  return {
    verdict,
    label: LABELS[verdict],
    summary:
      verdict === "suitable"
        ? "Both of you can work each other's shift. Every mandatory check passes in both directions."
        : verdict === "roster-blocked"
          ? "The current roster already has a gap in this period that must be fixed first."
          : verdict === "unverified"
            ? "Skills need manager verification before this swap can be checked."
            : (blockers[0] ?? "Doesn't pass a mandatory check") + ".",
    blockers,
    chips,
  };
}

const RANK: Record<Verdict, number> = {
  suitable: 0,
  unverified: 1,
  "roster-blocked": 2,
  "not-eligible": 3,
};

/** Stable sort by verdict; preserves the server's preference ranking within a verdict. */
export function sortByVerdict<T>(items: T[], verdict: (t: T) => Verdict) {
  return items
    .map((item, index) => ({ item, index, rank: RANK[verdict(item)] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.item);
}

/* ------------------------------------------------------------------ */
/* Request lifecycle                                                   */
/* ------------------------------------------------------------------ */

export type Tone = "accent" | "positive" | "caution" | "negative" | "neutral";

export interface StatusMeta {
  label: string;
  tone: Tone;
  /** Short description of what happens next. */
  next: string;
  active: boolean;
}

export function statusMeta(r: Pick<WorkforceRequest, "status" | "kind">): StatusMeta {
  const shiftRequest = r.kind === "cover" || r.kind === "swap";
  const map: Record<RequestStatus, StatusMeta> = {
    "pending-colleague": {
      label: "Awaiting colleague",
      tone: "accent",
      next: "Waiting for the colleague to accept or decline.",
      active: true,
    },
    "pending-manager": {
      label: "Awaiting approval",
      tone: "caution",
      next: shiftRequest
        ? "Colleague agreed. A manager reviews and applies it to the roster."
        : "A manager reviews this request.",
      active: true,
    },
    applied: {
      label: shiftRequest ? "Applied to roster" : "Approved",
      tone: "positive",
      next: "Approved and saved in ShiftFlow.",
      active: false,
    },
    declined: {
      label: "Declined",
      tone: "neutral",
      next: "The colleague declined. The roster is unchanged.",
      active: false,
    },
    rejected: {
      label: "Rejected",
      tone: "negative",
      next: "A manager rejected this request. The roster is unchanged.",
      active: false,
    },
    cancelled: {
      label: "Cancelled",
      tone: "neutral",
      next: "Withdrawn. The roster is unchanged.",
      active: false,
    },
    invalidated: {
      label: "Expired",
      tone: "neutral",
      next: "The shift changed after this request was made, so it can no longer be applied.",
      active: false,
    },
  };
  return map[r.status];
}

/** The ordered steps a cover/swap goes through, with progress for the stepper. */
export function shiftRequestSteps(r: WorkforceRequest) {
  const recorded = "source" in r && r.source === "manager-recorded";
  const steps = recorded
    ? ["Recorded", "Applied"]
    : r.kind === "cover" || r.kind === "swap"
      ? ["Requested", "Colleague accepted", "Manager approved"]
      : ["Requested", "Manager approved"];
  const reached = r.history.map((h) => h.to);
  let done = 1;
  if (!recorded && (r.kind === "cover" || r.kind === "swap")) {
    if (reached.includes("pending-manager")) done = 2;
    if (r.status === "applied") done = 3;
  } else if (r.status === "applied") done = steps.length;
  const failed = !statusMeta(r).active && r.status !== "applied";
  return { steps, done, failed };
}

export type RequestFilter =
  | "colleague"
  | "approval"
  | "applied"
  | "closed"
  | "all";

export function matchesFilter(r: WorkforceRequest, f: RequestFilter) {
  switch (f) {
    case "colleague":
      return r.status === "pending-colleague";
    case "approval":
      return r.status === "pending-manager";
    case "applied":
      return r.status === "applied";
    case "closed":
      return ["declined", "rejected", "cancelled", "invalidated"].includes(
        r.status,
      );
    default:
      return true;
  }
}

export function requestTitle(r: WorkforceRequest) {
  return r.kind === "cover"
    ? "Shift cover"
    : r.kind === "swap"
      ? "Shift swap"
      : r.kind === "time-off"
        ? "Time off"
        : "Availability change";
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

const KIND_WORD: Record<string, string> = {
  cover: "Cover request",
  swap: "Swap",
  "time-off": "Time-off request",
  availability: "Availability change",
};

function shiftDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Human sentence for a stored in-app notification. The stored message format
 * is produced by the server (`<kind> request <status>[: note]`, or a creation
 * message); unknown formats are shown unchanged.
 */
export function notificationText(
  message: string,
  request: WorkforceRequest | undefined,
  names: Record<string, string>,
) {
  const who = (id?: string) => (id ? (names[id] ?? "A colleague") : "Someone");
  const first = (id?: string) => who(id).split(" ")[0];
  const kind = /^(cover|swap|time-off|availability)\b/.exec(message)?.[1];
  if (!kind) return message;
  const label = KIND_WORD[kind];
  const shift =
    request && "shift" in request ? ` for ${shiftDay(request.shift.date)}` : "";
  const target =
    request && "targetEmployeeId" in request
      ? first(request.targetEmployeeId)
      : "The colleague";
  const requester = first(request?.requesterId);
  const note = /: (.+)$/.exec(message)?.[1];
  const withNote = (s: string) => (note ? `${s} — “${note}”` : s);
  if (/offer awaiting colleague/.test(message))
    return kind === "swap"
      ? `${requester} proposed a swap with ${target}${shift}`
      : `${requester} asked ${target} to cover${shift}`;
  if (/offer awaiting manager/.test(message))
    return `${label}${shift} recorded by a manager`;
  if (/request awaiting manager approval/.test(message))
    return `${requester} submitted a ${label.toLowerCase()}`;
  const status = /request ([a-z-]+)/.exec(message)?.[1];
  switch (status) {
    case "pending-manager":
      return withNote(`${target} accepted${shift} — awaiting manager approval`);
    case "applied":
      return withNote(`${label}${shift} approved and applied to the roster`);
    case "declined":
      return withNote(`${target} declined the ${label.toLowerCase()}${shift}`);
    case "rejected":
      return withNote(`${label}${shift} was rejected`);
    case "cancelled":
      return withNote(`${label}${shift} was cancelled`);
    case "invalidated":
      return `${label}${shift} expired because the shift changed`;
    default:
      return message;
  }
}
