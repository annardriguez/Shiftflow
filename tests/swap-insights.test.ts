import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockersFor,
  classify,
  describeIssue,
  explainCover,
  explainSwap,
  matchesFilter,
  notificationText,
  shiftRequestSteps,
  sortByVerdict,
  statusMeta,
} from "../src/lib/swap-insights";
import type { Shift } from "../src/lib/types";
import type {
  CandidateIssue,
  CoverOption,
  ShiftRequest,
} from "../src/lib/workforce-types";

const closing: Shift = {
  id: "s1",
  employeeId: "emp-2",
  date: "2026-11-16",
  start: 990,
  end: 1380,
  breakStart: 1170,
  breakMinutes: 30,
  kind: "Closing",
};
const issue = (
  code: string,
  extra: Partial<CandidateIssue> = {},
): CandidateIssue => ({
  code,
  message: code,
  preExisting: false,
  ...extra,
});
const option = (o: Partial<CoverOption> = {}): CoverOption => ({
  employeeId: "emp-9",
  name: "Sophie",
  eligible: true,
  reasons: [],
  scheduledHours: 10,
  preferredHours: 24,
  canClose: true,
  canSupervise: false,
  issues: [],
  role: "Team member",
  skillsReviewed: true,
  maxHours: 40,
  ...o,
});

test("eligible options are suitable and a closing shift states the closing requirement", () => {
  const insight = explainCover(option(), closing);
  assert.equal(insight.verdict, "suitable");
  assert.equal(insight.label, "Suitable replacement");
  assert.match(insight.summary, /Meets the closing requirement/);
  assert.match(insight.summary, /16h of 24h preferred/);
  assert.ok(insight.chips.some((c) => c.label === "Can close"));
  assert.equal(insight.hoursAfter, 16);
});

test("a soft preference never upgrades an ineligible option", () => {
  // Perfect hour fit, but the engine reported a hard availability failure.
  const insight = explainCover(
    option({
      eligible: false,
      scheduledHours: 18,
      issues: [issue("availability", { employeeId: "emp-9" })],
    }),
    closing,
  );
  assert.equal(insight.verdict, "not-eligible");
  assert.deepEqual(insight.blockers, ["Not available during this shift"]);
});

test("findings already present on the saved roster are attributed to the roster, not the person", () => {
  assert.equal(
    classify(
      false,
      [
        issue("supervision", { employeeId: "emp-5", preExisting: true }),
        issue("skill_coverage", { preExisting: true }),
      ],
      "emp-9",
    ),
    "roster-blocked",
  );
  // A single newly introduced finding makes it the person's/change's problem.
  assert.equal(
    classify(
      false,
      [
        issue("supervision", { employeeId: "emp-5", preExisting: true }),
        issue("supervision", { employeeId: "emp-5", minute: 1200 }),
      ],
      "emp-9",
    ),
    "not-eligible",
  );
});

test("unverified skills are labelled as needing review instead of assuming competence", () => {
  const insight = explainCover(
    option({
      eligible: false,
      canClose: false,
      skillsReviewed: false,
      issues: [
        issue("skills_unreviewed", { employeeId: "emp-9" }),
        issue("personal_qualification", {
          employeeId: "emp-9",
          message: "Missing effective qualification for personal duty: service",
        }),
        issue("skill_coverage", {
          message: "Mandatory qualified close coverage not met",
        }),
      ],
    }),
    closing,
  );
  assert.equal(insight.verdict, "unverified");
  assert.equal(insight.label, "Needs manager review");
  assert.ok(insight.chips.some((c) => c.label === "Closing not confirmed"));
  assert.ok(!insight.chips.some((c) => c.label === "Can close"));
});

test("unverified plus a real conflict is not eligible", () => {
  assert.equal(
    classify(
      false,
      [
        issue("skills_unreviewed", { employeeId: "emp-9" }),
        issue("availability", { employeeId: "emp-9" }),
      ],
      "emp-9",
    ),
    "not-eligible",
  );
});

test("missing structured data fails closed", () => {
  assert.equal(classify(false, undefined, "emp-9"), "not-eligible");
  assert.equal(classify(false, [], "emp-9"), "not-eligible");
});

test("issues translate to plain language and are ordered by severity", () => {
  assert.equal(
    describeIssue({
      code: "personal_qualification",
      message: "Missing effective qualification for personal duty: close",
    }),
    "Not qualified to close",
  );
  assert.equal(
    describeIssue({
      code: "skill_coverage",
      message: "Mandatory qualified close coverage not met",
    }),
    "No qualified closer would be on shift",
  );
  assert.deepEqual(
    blockersFor([
      issue("supervision"),
      issue("weekly_hours"),
      issue("availability"),
      issue("rolling_hours"),
    ]),
    [
      "Not available during this shift",
      "Would go over their maximum weekly hours",
      "A trainee would be left without a supervisor",
    ],
  );
});

test("hours above preference are flagged as a soft caution, not a blocker", () => {
  const insight = explainCover(option({ scheduledHours: 22 }), closing);
  assert.equal(insight.verdict, "suitable");
  assert.ok(insight.chips.some((c) => c.label === "Above preferred hours"));
  assert.equal(insight.blockers.length, 0);
});

test("sorting by verdict is stable within a verdict", () => {
  const items = [
    { id: "a", v: "not-eligible" as const },
    { id: "b", v: "suitable" as const },
    { id: "c", v: "roster-blocked" as const },
    { id: "d", v: "suitable" as const },
  ];
  assert.deepEqual(
    sortByVerdict(items, (i) => i.v).map((i) => i.id),
    ["b", "d", "c", "a"],
  );
});

test("swap explanation uses the return-shift owner", () => {
  const insight = explainSwap({
    shift: { ...closing, id: "s2", employeeId: "emp-3" },
    week: "2026-11-16",
    employeeName: "Sofia",
    eligible: false,
    reasons: [],
    issues: [issue("availability", { employeeId: "emp-3" })],
  });
  assert.equal(insight.verdict, "not-eligible");
  assert.equal(insight.summary, "Not available during this shift.");
});

const request = (over: Partial<ShiftRequest> = {}): ShiftRequest => ({
  id: "r1",
  version: 0,
  requesterId: "emp-1",
  targetEmployeeId: "emp-2",
  kind: "cover",
  week: "2026-11-16",
  shift: closing,
  source: "employee",
  status: "pending-colleague",
  createdAt: "",
  updatedAt: "",
  note: "",
  history: [{ at: "", actorId: "emp-1", from: null, to: "pending-colleague", note: "" }],
  externalSync: "not_connected",
  ...over,
});

test("eligibility, acceptance and approval are distinct states", () => {
  const sent = request();
  assert.equal(statusMeta(sent).label, "Awaiting colleague");
  assert.equal(shiftRequestSteps(sent).done, 1);
  const accepted = request({
    status: "pending-manager",
    history: [
      ...sent.history,
      { at: "", actorId: "emp-2", from: "pending-colleague", to: "pending-manager", note: "" },
    ],
  });
  assert.equal(statusMeta(accepted).label, "Awaiting approval");
  assert.equal(shiftRequestSteps(accepted).done, 2);
  const applied = request({ status: "applied", history: accepted.history });
  assert.equal(statusMeta(applied).label, "Applied to roster");
  assert.equal(shiftRequestSteps(applied).done, 3);
  const expired = request({ status: "invalidated" });
  assert.equal(statusMeta(expired).label, "Expired");
  assert.equal(shiftRequestSteps(expired).failed, true);
});

test("Swap Centre filters partition requests by lifecycle", () => {
  const all = (
    [
      "pending-colleague",
      "pending-manager",
      "applied",
      "declined",
      "rejected",
      "cancelled",
      "invalidated",
    ] as const
  ).map((status) => request({ status }));
  const count = (f: Parameters<typeof matchesFilter>[1]) =>
    all.filter((r) => matchesFilter(r, f)).length;
  assert.equal(count("colleague"), 1);
  assert.equal(count("approval"), 1);
  assert.equal(count("applied"), 1);
  assert.equal(count("closed"), 4);
  assert.equal(count("all"), 7);
});

test("notifications read as sentences and keep unknown formats unchanged", () => {
  const r = request({ requesterId: "emp-1", targetEmployeeId: "emp-2" });
  const names = { "emp-1": "Nora de Vries", "emp-2": "Liam van Dijk" };
  assert.equal(
    notificationText("cover offer awaiting colleague acceptance.", r, names),
    "Nora asked Liam to cover for Mon 16 Nov",
  );
  assert.equal(
    notificationText("cover request pending-manager: Happy to help", r, names),
    "Liam accepted for Mon 16 Nov — awaiting manager approval — “Happy to help”",
  );
  assert.equal(
    notificationText("cover request applied", r, names),
    "Cover request for Mon 16 Nov approved and applied to the roster",
  );
  assert.equal(notificationText("Something else", r, names), "Something else");
});
