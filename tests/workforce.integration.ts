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
  h = await PgHarness.create(workflowFixture());
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
import { workflowFixture } from "./workforce-fixture";
import type { WorkforceRequest } from "../src/lib/workforce-types";
const WEEK = "2026-11-16";
async function login(id: string) {
  return h.login(id);
}
async function fixture() {
  await h.replaceWorkspace(workflowFixture());
  await login("demo-manager");
}
async function feed() {
  const r = await fetch(base + "/api/workforce");
  assert.equal(r.status, 200);
  return r.json();
}
async function action(body: Record<string, unknown>) {
  const f = await feed();
  return fetch(base + "/api/workforce", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify(
      body.action === "read-notification"
        ? body
        : {
            revision: f.revision,
            note: "Fictional agreement for testing.",
            ...body,
          },
    ),
  });
}
async function create(
  kind = "cover",
  shiftId = "open-0",
  targetEmployeeId = "emp-2",
  other: Record<string, unknown> = {},
) {
  await login("emp-1");
  const r = await action({
    action: "create-shift",
    kind,
    week: WEEK,
    shiftId,
    targetEmployeeId,
    ...other,
  });
  assert.equal(r.status, 200, await r.text());
  return (await feed()).requests[0] as WorkforceRequest;
}
async function accept(r: WorkforceRequest, id = "emp-2") {
  await login(id);
  const result = await action({
    action: "accept",
    id: r.id,
    version: r.version,
  });
  assert.equal(result.status, 200, await result.text());
  return (await feed()).requests.find(
    (q: WorkforceRequest) => q.id === r.id,
  ) as WorkforceRequest;
}
async function approve(r: WorkforceRequest) {
  await login("demo-manager");
  return action({ action: "approve", id: r.id, version: r.version });
}
test(
  "employee and manager workforce workflows with real independent validation",
  { timeout: 120000 },
  async (t) => {
    await t.test(
      "demo session, manager boundaries and employee-scoped data",
      async () => {
        await fixture();
        const noSession = await realFetch(base + "/api/workforce");
        assert.equal(noSession.status, 401);
        await login("emp-1");
        for (const route of [
          "/api/workspace",
          "/api/planning",
          "/api/shift-cover?week=" + WEEK + "&shiftId=open-0",
        ])
          assert.equal((await fetch(base + route)).status, 403, route);
        for (const route of ["/api/workspace", "/api/planning"])
          assert.equal(
            (await fetch(base + route, { method: "POST", body: "{}" })).status,
            403,
          );
        const p = await feed();
        assert.equal(p.employee.id, "emp-1");
        assert.equal(p.employees, undefined);
        assert.equal(p.audit, undefined);
        assert.ok(
          p.weeks.every((w: any) =>
            w.shifts.every((s: any) => s.employeeId === "emp-1"),
          ),
        );
        assert.equal(
          (
            await action({
              action: "create-shift",
              requesterId: "emp-2",
              kind: "cover",
              week: WEEK,
              shiftId: "open-0",
              targetEmployeeId: "emp-2",
            })
          ).status,
          422,
        );
        assert.equal(
          (
            await fetch(
              base +
                "/api/workforce?view=candidates&week=" +
                WEEK +
                "&shiftId=open-1",
            )
          ).status,
          403,
        );
        const denied = await fetch(base + "/api/workforce", {
          method: "POST",
          headers: { Origin: "https://external.example" },
          body: "{}",
        });
        assert.equal(denied.status, 403);
      },
    );
    await t.test(
      "cover candidates explain full hard eligibility separately from preferences",
      async () => {
        await fixture();
        await login("emp-1");
        const r = await fetch(
          `${base}/api/workforce?view=candidates&week=${WEEK}&shiftId=open-0`,
        );
        const body = await r.json();
        assert.equal(r.status, 200, JSON.stringify(body));
        assert.ok(
          body.options.find((o: any) => o.employeeId === "emp-2").eligible,
        );
        assert.equal(
          body.options.find((o: any) => o.employeeId === "emp-3").eligible,
          false,
        );
        assert.ok(body.options.find((o: any) => !o.eligible).reasons.length);
        assert.equal(body.externalSync, "not_connected");
      },
    );
    await t.test(
      "colleague acceptance precedes atomic approval; only intended colleague responds",
      async () => {
        await fixture();
        const before = (await get()).weeks;
        const r = await create();
        assert.equal(
          (await action({ action: "accept", id: r.id, version: r.version }))
            .status,
          403,
        );
        assert.equal((await approve(r)).status, 422);
        assert.deepEqual((await get()).weeks, before);
        await login("emp-3");
        assert.equal(
          (await action({ action: "decline", id: r.id, version: r.version }))
            .status,
          403,
        );
        assert.equal((await feed()).requests.length, 0);
        const accepted = await accept(r);
        await login("demo-manager");
        assert.deepEqual((await get()).weeks, before);
        const f = await feed(),
          body = {
            action: "approve",
            id: r.id,
            version: accepted.version,
            revision: f.revision,
            note: "Approved fictional cover.",
          };
        const responses = await Promise.all([action(body), action(body)]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        const w = await get(),
          saved = w.requests!.find((q) => q.id === r.id)!;
        assert.equal(saved.status, "applied");
        assert.equal(saved.approvedBy, h.actors["demo-manager"]);
        assert.ok(saved.approvedAt);
        assert.equal(
          w.weeks[0].shifts.find((s) => s.id === "open-0")!.employeeId,
          "emp-2",
        );
        assert.equal(w.notifications!.length, 3);
        assert.ok(
          w.audit.some(
            (a) =>
              a.details?.requestId === r.id &&
              a.details?.before &&
              a.details?.after,
          ),
        );
        assert.equal((await approve(saved)).status, 409);
        assert.deepEqual(await h.storedWorkspace(), w);
      },
    );
    await t.test(
      "approval and a manager roster edit share one atomic revision queue",
      async () => {
        await fixture();
        const request = await accept(await create());
        await login("demo-manager");
        const before = await get();
        const responses = await Promise.all([
          action({
            action: "approve",
            id: request.id,
            version: request.version,
            revision: before.revision,
            note: "Concurrent approval",
          }),
          post(
            {
              type: "budgets",
              week: WEEK,
              budgets: [13, 12, 12, 12, 12, 12, 12],
            },
            before.revision,
          ),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        const after = await get();
        assert.equal(after.revision, before.revision + 1);
        assert.equal(
          after.requests![0].status,
          responses[0].status === 200 ? "applied" : "pending-manager",
        );
      },
    );
    await t.test(
      "new adjacent-week work creates a fresh rest-period conflict",
      async () => {
        await fixture();
        const request = await accept(await create());
        await login("demo-manager");
        const w = await get();
        const previous = structuredClone(workflowFixture().weeks[0]);
        previous.start = "2026-11-09";
        previous.shifts = previous.shifts.map((s) => ({
          ...s,
          id: "previous-" + s.id,
          date: new Date(Date.parse(s.date + "T12:00:00Z") - 7 * 86400000)
            .toISOString()
            .slice(0, 10),
        }));
        previous.shifts.find((s) => s.id === "previous-close-6")!.employeeId =
          "emp-2";
        w.employees[1].minRestHours = 12;
        w.weeks.push(previous);
        w.revision++;
        await h.replaceWorkspace(w as Workspace);
        const result = await approve(request);
        assert.equal(result.status, 422);
        assert.match((await result.json()).error, /rest/i);
        assert.deepEqual(await get(), w);
      },
    );
    await t.test(
      "fresh availability and qualification changes block application with no partial write",
      async () => {
        await fixture();
        let r = await accept(await create());
        await login("demo-manager");
        let w = await get();
        const availability = [...w.employees[1].availability];
        availability[0] = null;
        assert.equal(
          (
            await post({
              type: "availability",
              employeeId: "emp-2",
              availability,
            })
          ).status,
          200,
        );
        w = await get();
        assert.equal((await approve(r)).status, 422);
        assert.deepEqual(await get(), w);
        await fixture();
        await login("emp-3");
        const result = await action({
          action: "create-shift",
          kind: "cover",
          week: WEEK,
          shiftId: "close-0",
          targetEmployeeId: "emp-4",
        });
        assert.equal(result.status, 200, await result.text());
        r = await accept((await feed()).requests[0], "emp-4");
        await login("demo-manager");
        w = await get();
        assert.equal(
          (
            await post({
              type: "competencies",
              employeeId: "emp-4",
              skillIds: w.employees[3].competencies
                .filter((q) => q.skillId !== "close")
                .map((q) => q.skillId),
              supervisionSkillId: null,
            })
          ).status,
          200,
        );
        w = await get();
        const refused = await approve(r);
        assert.equal(refused.status, 422);
        assert.match((await refused.json()).error, /qualif|clos/i);
        assert.deepEqual(await get(), w);
      },
    );
    await t.test(
      "read-only assessment mirrors approval checks, is scoped, and never writes",
      async () => {
        await fixture();
        await login("emp-1");
        const cands = await (
          await fetch(`${base}/api/workforce?view=candidates&week=${WEEK}&shiftId=open-0`)
        ).json();
        const blocked = cands.options.find((o: any) => o.employeeId === "emp-3");
        assert.ok(Array.isArray(blocked.issues) && blocked.issues.length);
        assert.ok(blocked.issues.every((i: any) => typeof i.preExisting === "boolean"));
        assert.deepEqual(
          cands.options.find((o: any) => o.employeeId === "emp-2").issues,
          [],
        );
        const r = await accept(await create());
        await login("demo-manager");
        const before = await h.storedWorkspace();
        const assess = async () =>
          fetch(`${base}/api/workforce?view=assessment&id=${r.id}`);
        let res = await assess();
        let body = await res.json();
        assert.equal(res.status, 200, JSON.stringify(body));
        assert.equal(body.valid, true);
        assert.equal(body.sourcesCurrent, true);
        assert.deepEqual(await h.storedWorkspace(), before);
        await login("emp-3");
        assert.equal((await assess()).status, 403);
        await login("demo-manager");
        const w = await get();
        const availability = [...w.employees[1].availability];
        availability[0] = null;
        assert.equal(
          (await post({ type: "availability", employeeId: "emp-2", availability })).status,
          200,
        );
        body = await (await assess()).json();
        assert.equal(body.valid, false);
        const introduced = body.issues.filter((i: any) => !i.preExisting);
        assert.ok(introduced.some((i: any) => i.code === "availability" && i.employeeId === "emp-2"));
        // The preflight and the real approval agree.
        assert.equal((await approve(r)).status, 422);
      },
    );
    await t.test(
      "trainee replacing only independent opener is never labelled eligible",
      async () => {
        await fixture();
        let w = await get();
        w.employees[1].supervisionSkillId = "train";
        await h.replaceWorkspace(w as Workspace);
        await login("emp-1");
        const candidates = await (
          await fetch(
            `${base}/api/workforce?view=candidates&week=${WEEK}&shiftId=open-0`,
          )
        ).json();
        const target = candidates.options.find(
          (o: any) => o.employeeId === "emp-2",
        );
        assert.equal(target.eligible, false);
        assert.match(target.reasons.join(" "), /supervis/i);
        assert.equal(
          (
            await action({
              action: "create-shift",
              kind: "cover",
              week: WEEK,
              shiftId: "open-0",
              targetEmployeeId: "emp-2",
            })
          ).status,
          422,
        );
      },
    );
    await t.test(
      "two-way swap revalidates both sides and invalidates overlapping pending offers",
      async () => {
        await fixture();
        const swap = await accept(
          await create("swap", "open-0", "emp-2", {
            counterWeek: WEEK,
            counterShiftId: "open-1",
          }),
        );
        await login("emp-2");
        const sent = await action({
          action: "create-shift",
          kind: "cover",
          week: WEEK,
          shiftId: "open-1",
          targetEmployeeId: "emp-3",
        });
        assert.equal(sent.status, 200, await sent.text());
        const other = (await feed()).requests.find(
          (q: WorkforceRequest) => q.requesterId === "emp-2",
        );
        await accept(other, "emp-3");
        const approved = await approve(swap);
        assert.equal(approved.status, 200, await approved.text());
        const w = await get();
        assert.equal(
          w.weeks[0].shifts.find((s) => s.id === "open-0")!.employeeId,
          "emp-2",
        );
        assert.equal(
          w.weeks[0].shifts.find((s) => s.id === "open-1")!.employeeId,
          "emp-1",
        );
        assert.equal(
          w.requests!.find((q) => q.id === other.id)!.status,
          "invalidated",
        );
      },
    );
    await t.test(
      "swap eligibility checks qualifications on the return shift too",
      async () => {
        await fixture();
        const w = await get();
        w.employees[0].competencies = w.employees[0].competencies.filter(
          (q) => q.skillId !== "close",
        );
        await h.replaceWorkspace(w as Workspace);
        await login("emp-1");
        const result = await action({
          action: "create-shift",
          kind: "swap",
          week: WEEK,
          shiftId: "open-0",
          targetEmployeeId: "emp-4",
          counterWeek: WEEK,
          counterShiftId: "close-1",
        });
        assert.equal(result.status, 422);
        assert.match((await result.json()).error, /qualif|clos/i);
        await login("demo-manager");
        assert.deepEqual(await get(), w);
      },
    );
    await t.test(
      "changed source and stale request versions reject before mutation",
      async () => {
        await fixture();
        const r = await accept(await create());
        await login("demo-manager");
        const w = await get(),
          s = w.weeks[0].shifts.find((s) => s.id === "open-0")!;
        assert.equal(
          (await post({ type: "shift", week: WEEK, shift: { ...s, end: 990 } }))
            .status,
          200,
        );
        const changed = await get();
        assert.equal((await approve(r)).status, 409);
        assert.deepEqual(await get(), changed);
        await fixture();
        const first = await create();
        const accepted = await accept(first);
        await login("emp-1");
        assert.equal(
          (
            await action({
              action: "cancel",
              id: accepted.id,
              version: first.version,
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "decline, cancellation, rejection and notifications stay scoped",
      async () => {
        await fixture();
        let r = await create();
        await login("emp-2");
        assert.equal(
          (await action({ action: "decline", id: r.id, version: r.version }))
            .status,
          200,
        );
        r = (await feed()).requests[0];
        assert.equal(r.status, "declined");
        await login("emp-1");
        r = await create();
        assert.equal(
          (await action({ action: "cancel", id: r.id, version: r.version }))
            .status,
          200,
        );
        r = await create();
        await login("demo-manager");
        assert.equal(
          (await action({ action: "reject", id: r.id, version: r.version }))
            .status,
          200,
        );
        const f = await feed(),
          notification = f.notifications[0];
        await login("emp-3");
        assert.equal(
          (await action({ action: "read-notification", id: notification.id }))
            .status,
          403,
        );
        await login("emp-1");
        assert.equal(
          (await action({ action: "read-notification", id: notification.id }))
            .status,
          200,
        );
        assert.ok(
          (await feed()).notifications
            .find((n: any) => n.id === notification.id)
            .readBy.includes("emp-1"),
        );
      },
    );
    await t.test(
      "time off is a request; conflicts cannot be silently approved",
      async () => {
        await fixture();
        await login("emp-1");
        assert.equal(
          (await action({ action: "create-time-off", dates: ["2026-11-16"] }))
            .status,
          200,
        );
        let r = (await feed()).requests[0];
        await login("demo-manager");
        let before = await get();
        assert.equal((await approve(r)).status, 422);
        assert.deepEqual(await get(), before);
        await login("emp-1");
        assert.equal(
          (await action({ action: "create-time-off", dates: ["2026-11-17"] }))
            .status,
          200,
        );
        r = (await feed()).requests[0];
        assert.equal((await approve(r)).status, 200);
        assert.ok(
          (await get()).employees[0].absentDates.includes("2026-11-17"),
        );
      },
    );
    await t.test(
      "approved availability and preferences include dated exceptions without self-certification",
      async () => {
        await fixture();
        await login("emp-1");
        const p = await feed(),
          qualifications = p.employee.competencies;
        const body = {
          action: "create-availability",
          availability: p.employee.availability,
          dateOverrides: [{ date: "2026-11-17", window: null }],
          preferredHours: 20,
        };
        assert.equal((await action({ ...body, competencies: [] })).status, 422);
        assert.equal((await action(body)).status, 200);
        const r = (await feed()).requests[0];
        assert.equal((await approve(r)).status, 200);
        const w = await get();
        assert.deepEqual(w.employees[0].availabilityOverrides, [
          { date: "2026-11-17", window: null },
        ]);
        assert.equal(w.employees[0].preferredHours, 20);
        assert.deepEqual(w.employees[0].competencies, qualifications);
      },
    );
    await t.test(
      "manager-recorded agreements require explicit consent and apply with audit",
      async () => {
        await fixture();
        assert.equal(
          (
            await action({
              action: "record-agreement",
              requesterId: "emp-1",
              kind: "cover",
              week: WEEK,
              shiftId: "open-0",
              targetEmployeeId: "emp-2",
              agreementConfirmed: false,
            })
          ).status,
          422,
        );
        const r = await action({
          action: "record-agreement",
          requesterId: "emp-1",
          kind: "cover",
          week: WEEK,
          shiftId: "open-0",
          targetEmployeeId: "emp-2",
          agreementConfirmed: true,
        });
        assert.equal(r.status, 200, await r.text());
        const w = await get();
        assert.equal(w.requests![0].status, "applied");
        assert.equal((w.requests![0] as any).source, "manager-recorded");
        assert.equal(
          w.weeks[0].shifts.find((s) => s.id === "open-0")!.employeeId,
          "emp-2",
        );
      },
    );
    await t.test(
      "requests, notifications, audit and demo sessions persist across restart",
      async () => {
        const w = await get();
        await stop();
        await start();
        assert.deepEqual(await get(), w);
        assert.equal((await feed()).requests[0].status, "applied");
      },
    );
  },
);
