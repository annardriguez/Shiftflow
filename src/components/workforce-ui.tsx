"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  CalendarDays,
  ChevronRight,
  ChevronLeft,
  Clock3,
  Inbox,
  CheckCircle2,
  RefreshCw,
  PenLine,
  ShieldCheck,
  AlertTriangle,
  Unplug,
  Home,
  ListChecks,
  UserRound,
  CalendarOff,
  LoaderCircle,
  KeyRound,
  Sun,
  Plus,
  Users,
  Construction,
} from "lucide-react";
import { AccountMenu } from "./auth-ui";
import { useApp } from "./provider";
import {
  Avatar,
  Brand,
  Callout,
  CanClose,
  EmptyState,
  ErrorBox,
  LoadGuard,
  Modal,
  PageTitle,
  Skeleton,
  StatusPill,
} from "./ui";
import { ReplacementFinder, ShiftHero } from "./replacement";
import {
  ChangeCards,
  KindIcon,
  PersonalChange,
  RequestStatusPill,
  Stepper,
  Timeline,
  nameOf,
  requestSummary,
  requestTitle,
  requestWhen,
  type Names,
} from "./requests";
import { CapabilityTags } from "./skills";
import { ACTION_DONE, api, useManagerFeed } from "@/lib/client-api";
import {
  blockersFor,
  matchesFilter,
  notificationText,
  statusMeta,
  type RequestFilter,
} from "@/lib/swap-insights";
import { qualified } from "@/lib/skills";
import { DAYS, dateAt, time, weekLabel } from "@/lib/schedule";
import {
  absoluteTime,
  dayOfMonth,
  firstName,
  hours,
  longDate,
  mondayOf,
  paid,
  plural,
  relativeDay,
  relativeTime,
  shortDate,
  timeRange,
  today,
  weekdayShort,
} from "@/lib/format";
import type {
  WorkforceRequest,
  PortalData,
  RequestAssessment,
  ShiftRequest,
} from "@/lib/workforce-types";
import { notificationFor } from "@/lib/workforce-types";
import type { Workspace, Shift, Window } from "@/lib/types";

export { AccountMenu } from "./auth-ui";

const isActive = (r: WorkforceRequest) => statusMeta(r).active;

/* =====================================================================
   Team access (manager-facing explainer for the /employee route)
   ===================================================================== */

export function EmployeeEntry() {
  return (
    <>
      <PageTitle
        title="Team access"
        description="Every team member signs in with their own account and sees only their own shifts and requests."
      />
      <div className="how-it-works">
        <div>
          <b>1</b>
          <h3>Own account, own data</h3>
          <p>Employees see their schedule, requests addressed to them and their own availability. Never the full roster.</p>
        </div>
        <div>
          <b>2</b>
          <h3>Swaps start with the employee</h3>
          <p>They pick a shift, ShiftFlow shows who can take it, and the colleague accepts or declines.</p>
        </div>
        <div>
          <b>3</b>
          <h3>You stay in control</h3>
          <p>Nothing changes on the roster until you approve it in the Swap Centre.</p>
        </div>
      </div>
      <Callout tone="neutral" title="Accounts are created by an administrator">
        There’s no public sign-up, and you can’t sign in as someone else. To try the employee view, sign out and use a
        team member’s account.
      </Callout>
      <div>
        <Link className="btn primary" href="/requests">
          Open Swap Centre <ChevronRight size={15} />
        </Link>
      </div>
    </>
  );
}

/* =====================================================================
   Swap Centre (manager)
   ===================================================================== */

export function ManagerRequests() {
  return (
    <LoadGuard>
      <SwapCentre />
    </LoadGuard>
  );
}

const FILTERS: { id: RequestFilter; label: string }[] = [
  { id: "approval", label: "Awaiting approval" },
  { id: "colleague", label: "Awaiting colleague" },
  { id: "applied", label: "Applied" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

function SwapCentre() {
  const { data, reload, notify } = useApp(),
    { feed, error, setError, load } = useManagerFeed();
  const [filter, setFilter] = useState<RequestFilter>("approval"),
    [type, setType] = useState<"all" | "shift" | "personal">("all"),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [record, setRecord] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    // Start on the most useful tab.
    if (feed && !feed.requests.some((r) => r.status === "pending-manager") && filter === "approval") {
      if (feed.requests.some((r) => r.status === "pending-colleague")) setFilter("colleague");
      else setFilter("all");
    }
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!feed]);
  const requests = useMemo(
    () =>
      (feed?.requests ?? []).filter(
        (r) =>
          matchesFilter(r, filter) &&
          (type === "all" ||
            (type === "shift" ? r.kind === "cover" || r.kind === "swap" : r.kind === "time-off" || r.kind === "availability")),
      ),
    [feed, filter, type],
  );
  const selected =
    requests.find((r) => r.id === selectedId) ?? (requests.length ? requests[0] : undefined);
  if (!data) return null;
  const all = feed?.requests ?? [];
  const count = (f: RequestFilter) => all.filter((r) => matchesFilter(r, f)).length;
  const weekAgo = Date.now() - 7 * 86400000;
  const appliedWeek = all.filter((r) => r.status === "applied" && r.approvedAt && Date.parse(r.approvedAt) > weekAgo).length;

  async function act(r: WorkforceRequest, action: string, note: string) {
    if (!feed) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/workforce", { action, id: r.id, version: r.version, revision: feed.revision, note });
      notify(ACTION_DONE[action] ?? "Done");
    } catch (e) {
      setError((e as Error).message);
      notify("That change couldn’t be saved", "error");
    } finally {
      load();
      reload();
      setBusy(false);
    }
  }
  const names: Names = feed?.names ?? {};
  const canClose = (id: string) => {
    const e = data.employees.find((x) => x.id === id);
    return !!e && qualified(e, "close");
  };
  return (
    <>
      <PageTitle
        title="Swap Centre"
        description="Review replacement requests, see exactly what would change on the roster, and approve with confidence."
      >
        <button className="btn" onClick={load} disabled={busy} aria-label="Refresh requests">
          <RefreshCw size={15} /> Refresh
        </button>
        <button className="btn primary" onClick={() => setRecord(true)}>
          <PenLine size={15} /> Record agreed change
        </button>
      </PageTitle>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Awaiting your approval</span>
          <span className="stat-value">{feed ? count("approval") : "–"}</span>
          <span className={`stat-note ${count("approval") ? "caution" : ""}`}>
            {count("approval") ? "Colleague already accepted" : "Nothing waiting on you"}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Awaiting colleague</span>
          <span className="stat-value">{feed ? count("colleague") : "–"}</span>
          <span className="stat-note">Sent, not yet answered</span>
        </div>
        <div className="stat">
          <span className="stat-label">Applied in the last 7 days</span>
          <span className="stat-value">{feed ? appliedWeek : "–"}</span>
          <span className="stat-note">Saved to the ShiftFlow roster</span>
        </div>
        <div className="stat">
          <span className="stat-label">Declined, rejected or expired</span>
          <span className="stat-value">{feed ? count("closed") : "–"}</span>
          <span className="stat-note">Roster unchanged</span>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className={`swap-layout ${feed && !requests.length ? "single" : ""}`}>
        <section className="panel" aria-label="Requests">
          <div className="filter-bar">
            <div className="segmented" role="tablist" aria-label="Request status">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => {
                    setFilter(f.id);
                    setSelectedId(null);
                  }}
                >
                  {f.label}
                  {(f.id === "approval" || f.id === "colleague") && count(f.id) > 0 && (
                    <span className={`count ${f.id === "approval" ? "accent" : ""}`}>{count(f.id)}</span>
                  )}
                </button>
              ))}
            </div>
            <select aria-label="Request type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="all">All types</option>
              <option value="shift">Swaps & cover</option>
              <option value="personal">Time off & availability</option>
            </select>
          </div>
          {!feed ? (
            <Skeleton rows={5} />
          ) : !requests.length ? (
            <EmptyState
              icon={filter === "approval" ? <CheckCircle2 size={20} /> : <Inbox size={20} />}
              title={
                filter === "approval"
                  ? "You’re all caught up"
                  : filter === "colleague"
                    ? "No requests waiting on colleagues"
                    : all.length
                      ? "Nothing here"
                      : "No swap requests yet"
              }
            >
              {all.length
                ? "Requests in other states are in the other tabs."
                : "When a team member asks a colleague to take a shift, it shows up here for your approval."}
            </EmptyState>
          ) : (
            <div className="request-list" role="list">
              {requests.map((r) => (
                <button
                  key={r.id}
                  role="listitem"
                  className={`request-row ${selected?.id === r.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(r.id)}
                  aria-current={selected?.id === r.id}
                >
                  <span className="people-pair">
                    <Avatar employee={{ name: nameOf(names, r.requesterId) }} small />
                    {"targetEmployeeId" in r && (
                      <Avatar employee={{ name: nameOf(names, r.targetEmployeeId) }} small />
                    )}
                  </span>
                  <span className="rr-main">
                    <span className="rr-title">
                      <KindIcon kind={r.kind} size={14} />
                      <span>
                        {requestTitle(r)} · {requestSummary(r, names)}
                      </span>
                    </span>
                    <span className="rr-sub">{requestWhen(r)}</span>
                  </span>
                  <span className="rr-side">
                    <RequestStatusPill request={r} />
                    <small>{relativeTime(r.updatedAt)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        {feed && !requests.length ? null : selected ? (
          <RequestDetail
            key={selected.id + selected.version}
            request={selected}
            names={names}
            busy={busy}
            act={act}
            workspace={data}
            canClose={canClose}
          />
        ) : (
          feed && (
            <section className="panel request-detail">
              <EmptyState icon={<ArrowLeftRight size={20} />} title="Select a request">
                Details, roster impact and approval actions appear here.
              </EmptyState>
            </section>
          )
        )}
      </div>
      {record && (
        <AgreementDialog
          workspace={data}
          onClose={() => setRecord(false)}
          onDone={(message) => {
            setRecord(false);
            notify(message);
            load();
            reload();
          }}
        />
      )}
    </>
  );
}

function useAssessment(request: WorkforceRequest, enabled: boolean) {
  const [result, setResult] = useState<RequestAssessment | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setLoading(true);
    setError("");
    api<RequestAssessment>(`/api/workforce?view=assessment&id=${request.id}`)
      .then((r) => live && setResult(r))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [request.id, request.version, enabled, attempt]);
  return { result, loading, error, recheck: () => setAttempt((n) => n + 1) };
}

function AssessmentPanel({
  request,
  check,
}: {
  request: WorkforceRequest;
  check: ReturnType<typeof useAssessment>;
}) {
  const { result, loading, error, recheck } = check;
  const isShift = "targetEmployeeId" in request;
  if (loading && !result)
    return (
      <Callout tone="neutral" icon={<LoaderCircle size={16} className="spin" />} title="Checking the current roster…">
        Running the same checks approval will run.
      </Callout>
    );
  if (error) return <ErrorBox error={error} />;
  if (!result) return null;
  const recheckBtn = (
    <button className="text-link" onClick={recheck} disabled={loading} style={{ marginTop: 4 }}>
      <RefreshCw size={12} /> Check again
    </button>
  );
  if (!result.sourcesCurrent)
    return (
      <Callout tone="negative" title="The shift has changed since this was requested">
        Approval would fail. Reject it and ask the team member to send a new request.
      </Callout>
    );
  if (result.valid)
    return (
      <Callout tone="positive" title={isShift ? "Safe to apply" : "No roster conflicts"}>
        {isShift
          ? "Passes every mandatory check on the current roster: availability, skills, closing cover, supervision, rest and hours."
          : "Approving won’t leave any saved shift uncovered or break a working-time rule."}
        <div>{recheckBtn}</div>
      </Callout>
    );
  const introduced = result.issues.filter((i) => !i.preExisting);
  const existing = result.issues.filter((i) => i.preExisting);
  const blockers = blockersFor(introduced);
  return (
    <Callout tone={introduced.length ? "negative" : "caution"} title={introduced.length ? "Approving would break the roster" : "The roster already has gaps in this period"}>
      {introduced.length > 0 ? (
        <ul style={{ paddingLeft: 16, margin: "4px 0" }}>
          {blockers.slice(0, 5).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <p>
          This change itself is fine, but {plural(existing.length, "existing issue")} in the affected week
          {existing.length === 1 ? "" : "s"} must be fixed in the Schedule before anything can be applied.
        </p>
      )}
      {introduced.length > 0 && existing.length > 0 && (
        <p>There are also {plural(existing.length, "existing issue")} on the roster.</p>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        {recheckBtn}
        {!introduced.length && (
          <Link className="text-link" href="/schedule" style={{ marginTop: 4 }}>
            Open schedule <ChevronRight size={12} />
          </Link>
        )}
      </div>
    </Callout>
  );
}

function RequestDetail({
  request: r,
  names,
  busy,
  act,
  workspace,
  canClose,
}: {
  request: WorkforceRequest;
  names: Names;
  busy: boolean;
  act: (r: WorkforceRequest, action: string, note: string) => Promise<void>;
  workspace: Workspace;
  canClose: (id: string) => boolean;
}) {
  const [note, setNote] = useState(""),
    [confirm, setConfirm] = useState<null | "approve" | "reject" | "cancel">(null);
  const active = isActive(r);
  const check = useAssessment(r, active);
  const meta = statusMeta(r);
  const employee = workspace.employees.find((e) => e.id === r.requesterId);
  const blocked = !!check.result && !check.result.valid;
  const shift = "shift" in r ? r : null;
  const confirmText =
    confirm === "approve"
      ? shift
        ? `${firstName(nameOf(names, shift.targetEmployeeId))} will replace ${firstName(nameOf(names, r.requesterId))} on ${shortDate(shift.shift.date)}${shift.kind === "swap" && shift.counterShift ? `, and ${firstName(nameOf(names, r.requesterId))} takes ${shortDate(shift.counterShift.date)}` : ""}. Both are notified in ShiftFlow.`
        : r.kind === "time-off"
          ? `${nameOf(names, r.requesterId)} will be marked unavailable on ${plural(r.dates.length, "day")}.`
          : `${nameOf(names, r.requesterId)}’s availability and preferred hours will be updated.`
      : confirm === "reject"
        ? "The request is closed and the roster stays as it is. Everyone involved is notified."
        : "The request is withdrawn and the roster stays as it is.";
  return (
    <section className="panel request-detail" aria-label="Request details">
      <header>
        <div className="rd-top">
          <h2>
            <KindIcon kind={r.kind} /> {requestTitle(r)}
          </h2>
          <RequestStatusPill request={r} />
        </div>
        <span className="form-hint">
          Requested by {nameOf(names, r.requesterId)} · {relativeTime(r.createdAt)}
          {"source" in r && r.source === "manager-recorded" && " · recorded by a manager"}
        </span>
        <Stepper request={r} />
      </header>
      <div className="rd-body">
        <div className="section">
          <h3>{r.status === "applied" ? "What changed" : "What would change"}</h3>
          {shift ? (
            <ChangeCards request={r} names={names} canClose={canClose} />
          ) : (
            <PersonalChange request={r} current={employee} />
          )}
        </div>
        {r.note && (
          <div className="section">
            <h3>Note</h3>
            <q className="request-note">{r.note}</q>
          </div>
        )}
        {active && (
          <div className="section">
            <h3>Roster check</h3>
            <AssessmentPanel request={r} check={check} />
            {r.status === "pending-colleague" && (
              <p className="form-hint">
                Waiting for {firstName(nameOf(names, shift?.targetEmployeeId))} to accept. You can approve once they do.
              </p>
            )}
          </div>
        )}
        {r.status === "applied" && (
          <div className="section">
            <h3>Approval record</h3>
            <div className="detail-list">
              <div>
                <span className="k">Approved by</span>
                <span className="v">{nameOf(names, r.approvedBy)}</span>
              </div>
              <div>
                <span className="k">Approved at</span>
                <span className="v">{r.approvedAt && absoluteTime(r.approvedAt)}</span>
              </div>
              <div>
                <span className="k">ShiftFlow roster</span>
                <span className="v">Updated (version {r.appliedRevision})</span>
              </div>
              <div>
                <span className="k">External scheduling system</span>
                <span className="v" style={{ color: "var(--caution)" }}>
                  Not connected · update manually
                </span>
              </div>
            </div>
          </div>
        )}
        {!active && r.status !== "applied" && (
          <Callout tone="neutral" title={meta.label}>
            {meta.next}
          </Callout>
        )}
        <div className="section">
          <h3>History</h3>
          <Timeline request={r} names={names} />
        </div>
      </div>
      {active && (
        <div className="rd-actions">
          {confirm ? (
            <>
              <Callout tone={confirm === "approve" ? "accent" : "neutral"} title={confirm === "approve" ? "Approve and apply to roster?" : confirm === "reject" ? "Reject this request?" : "Withdraw this request?"}>
                {confirmText}
              </Callout>
              <label className="field">
                Note for the team (optional)
                <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={confirm === "reject" ? "e.g. We need Liam on the close that night." : ""} />
              </label>
              <div className="flex-row" style={{ justifyContent: "flex-end" }}>
                <button className="btn" disabled={busy} onClick={() => setConfirm(null)}>
                  Back
                </button>
                <button
                  className={`btn ${confirm === "approve" ? "positive" : confirm === "reject" ? "danger" : ""}`}
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => act(r, confirm, note).then(() => setConfirm(null))}
                >
                  {busy ? <LoaderCircle size={15} className="spin" /> : null}
                  {confirm === "approve" ? "Confirm approval" : confirm === "reject" ? "Reject request" : "Withdraw request"}
                </button>
              </div>
            </>
          ) : (
            <div className="flex-row" style={{ justifyContent: "flex-end" }}>
              {r.status === "pending-colleague" && (
                <button className="btn ghost" disabled={busy} onClick={() => setConfirm("cancel")}>
                  Withdraw
                </button>
              )}
              <button className="btn danger" disabled={busy} onClick={() => setConfirm("reject")}>
                Reject
              </button>
              {r.status === "pending-manager" && (
                <button
                  className="btn positive"
                  disabled={busy || blocked || check.loading}
                  onClick={() => setConfirm("approve")}
                  title={blocked ? "Fix the issues above first" : undefined}
                >
                  <CheckCircle2 size={15} /> Approve & apply
                </button>
              )}
            </div>
          )}
          <span className="sync-note">
            <Unplug size={12} /> Updates the ShiftFlow roster only. No external system is connected.
          </span>
        </div>
      )}
    </section>
  );
}

/* =====================================================================
   Manager: record an agreed change
   ===================================================================== */

function AgreementDialog({
  workspace,
  onClose,
  onDone,
}: {
  workspace: Workspace;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [owner, setOwner] = useState(workspace.employees[0].id),
    [shiftId, setShiftId] = useState(""),
    [start, setStart] = useState(false);
  const shifts = workspace.weeks
      .flatMap((w) => w.shifts.filter((s) => s.employeeId === owner).map((s) => ({ shift: s, week: w.start })))
      .sort((a, b) => a.shift.date.localeCompare(b.shift.date) || a.shift.start - b.shift.start),
    choice = shifts.find((s) => s.shift.id === shiftId);
  if (start && choice)
    return (
      <ReplacementFinder
        recording={{ requesterId: owner }}
        shift={choice.shift}
        week={choice.week}
        ownerName={workspace.employees.find((e) => e.id === owner)?.name}
        onClose={onClose}
        onDone={onDone}
      />
    );
  return (
    <Modal
      title="Record an agreed change"
      description="Use this when two colleagues already agreed a swap, for example in person or by message. ShiftFlow still checks it before applying."
      onClose={onClose}
    >
      <div className="editor-form">
        <label>
          Who is giving up a shift?
          <select
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setShiftId("");
            }}
          >
            {workspace.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Which shift?
          <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            <option value="">Choose a shift</option>
            {shifts.map((s) => (
              <option key={s.shift.id} value={s.shift.id}>
                {shortDate(s.shift.date)} · {timeRange(s.shift)} · {s.shift.kind}
              </option>
            ))}
          </select>
          {!shifts.length && <span className="form-hint">No saved shifts for this person.</span>}
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!choice} onClick={() => setStart(true)}>
            Find who can take it <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* =====================================================================
   Employee app (mobile-first)
   ===================================================================== */

type Tab = "home" | "requests" | "availability" | "profile";

export function EmployeePortal() {
  const { actor, notify } = useApp();
  const [data, setData] = useState<PortalData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [week, setWeek] = useState(() => mondayOf(today())),
    [open, setOpen] = useState<{ shift: Shift; week: string } | null>(null),
    [finder, setFinder] = useState<{ shift: Shift; week: string } | null>(null),
    [personal, setPersonal] = useState<"time-off" | "availability" | null>(null),
    [tab, setTab] = useState<Tab>("home");
  const load = useCallback(() => {
    api<PortalData>("/api/workforce")
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // If this week has no data yet, jump to the first week that does.
  useEffect(() => {
    if (data && !data.weeks.some((w) => w.start === week) && data.weeks.length)
      setWeek(data.weeks.find((w) => w.start >= week)?.start ?? data.weeks[0].start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);
  if (!actor) return null;

  async function act(r: WorkforceRequest, action: string, note = "") {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/workforce", { action, id: r.id, version: r.version, revision: data.revision, note });
      notify(ACTION_DONE[action] ?? "Done");
    } catch (e) {
      setError((e as Error).message);
      notify("That didn’t go through", "error");
    } finally {
      load();
      setBusy(false);
    }
  }

  const incoming = (data?.requests ?? []).filter(
    (r) => "targetEmployeeId" in r && r.targetEmployeeId === actor.id && r.status === "pending-colleague",
  ) as ShiftRequest[];
  const mine = (data?.requests ?? []).filter((r) => r.requesterId === actor.id);
  const pendingMine = mine.filter(isActive);
  const tabs: { id: Tab; label: string; icon: typeof Home; count?: number }[] = [
    { id: "home", label: "My shifts", icon: Home },
    { id: "requests", label: "Requests", icon: ListChecks, count: incoming.length + pendingMine.length },
    { id: "availability", label: "Availability", icon: CalendarDays },
    { id: "profile", label: "Profile", icon: UserRound },
  ];
  const restaurant = (actor.tenantName ?? "").split("·")[0].trim();

  return (
    <div className="emp-shell">
      <header className="emp-header">
        <Brand />
        <AccountMenu compact />
      </header>
      <nav className="tabbar" aria-label="Sections">
        {tabs.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            <t.icon size={20} />
            {t.label}
            {!!t.count && <span className="count accent">{t.count}</span>}
          </button>
        ))}
      </nav>
      <main className="emp-main">
        <ErrorBox error={error} />
        {!data ? (
          <div className="panel">
            <Skeleton rows={4} />
          </div>
        ) : tab === "home" ? (
          <HomeTab
            data={data}
            restaurant={restaurant}
            incoming={incoming}
            pendingMine={pendingMine}
            busy={busy}
            act={act}
            week={week}
            setWeek={setWeek}
            onOpen={(shift, w) => setOpen({ shift, week: w })}
            goRequests={() => setTab("requests")}
          />
        ) : tab === "requests" ? (
          <RequestsTab data={data} busy={busy} act={act} />
        ) : tab === "availability" ? (
          <AvailabilityTab data={data} onRequest={setPersonal} />
        ) : (
          <ProfileTab data={data} restaurant={restaurant} onRead={load} />
        )}
      </main>
      {open && data && (
        <ShiftSheet
          shift={open.shift}
          request={data.requests.find(
            (r) => "shift" in r && r.shift.id === open.shift.id && r.requesterId === actor.id && isActive(r),
          )}
          names={data.names}
          onClose={() => setOpen(null)}
          onFind={() => {
            setFinder(open);
            setOpen(null);
          }}
          onViewRequest={() => {
            setOpen(null);
            setTab("requests");
          }}
        />
      )}
      {finder && (
        <ReplacementFinder
          shift={finder.shift}
          week={finder.week}
          onClose={() => setFinder(null)}
          onDone={(message) => {
            setFinder(null);
            notify(message);
            load();
          }}
        />
      )}
      {personal && data && (
        <PersonalDialog
          kind={personal}
          data={data}
          onClose={() => setPersonal(null)}
          onDone={(message) => {
            setPersonal(null);
            notify(message);
            setTab("requests");
            load();
          }}
        />
      )}
    </div>
  );
}

function sortShifts(s: Shift[]) {
  return [...s].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

function HomeTab({
  data,
  restaurant,
  incoming,
  pendingMine,
  busy,
  act,
  week,
  setWeek,
  onOpen,
  goRequests,
}: {
  data: PortalData;
  restaurant: string;
  incoming: ShiftRequest[];
  pendingMine: WorkforceRequest[];
  busy: boolean;
  act: (r: WorkforceRequest, action: string, note?: string) => Promise<void>;
  week: string;
  setWeek: (w: string) => void;
  onOpen: (s: Shift, week: string) => void;
  goRequests: () => void;
}) {
  const t = today();
  const all = data.weeks.flatMap((w) => w.shifts.map((s) => ({ shift: s, week: w.start })));
  const upcoming = all
    .filter((x) => x.shift.date >= t)
    .sort((a, b) => a.shift.date.localeCompare(b.shift.date) || a.shift.start - b.shift.start);
  const next = upcoming[0];
  const shifts = sortShifts(data.weeks.find((w) => w.start === week)?.shifts ?? []);
  const weekHours = shifts.reduce((n, s) => n + paid(s), 0);
  const requestFor = (id: string) =>
    data.requests.find((r) => "shift" in r && r.shift.id === id && r.requesterId === data.actor.id && isActive(r));
  return (
    <>
      <div className="emp-greeting">
        <h1>Hi {firstName(data.actor.name)}</h1>
        <p>
          {restaurant} · {next ? `Next shift ${relativeDay(next.shift.date).toLowerCase() === "today" ? "today" : relativeDay(next.shift.date)}` : "No upcoming shifts"}
        </p>
      </div>
      {incoming.map((r) => (
        <article className="offer-card" key={r.id} aria-label="Shift request for you">
          <div className="oc-top">
            <Avatar employee={{ name: nameOf(data.names, r.requesterId) }} />
            <div>
              <strong>
                {firstName(nameOf(data.names, r.requesterId))} {r.kind === "swap" ? "wants to swap shifts" : "asked you to take a shift"}
              </strong>
              <small>{relativeTime(r.createdAt)}</small>
            </div>
          </div>
          <ShiftHero shift={r.shift} />
          {r.kind === "swap" && r.counterShift && (
            <div className="detail-list">
              <div>
                <span className="k">You’d give up</span>
                <span className="v">
                  {shortDate(r.counterShift.date)} · {timeRange(r.counterShift)}
                </span>
              </div>
            </div>
          )}
          {r.note && <q className="request-note">{r.note}</q>}
          <p className="form-hint">
            <ShieldCheck size={12} style={{ verticalAlign: -2 }} /> You meet every requirement for this shift. If you
            accept, your manager approves it before the roster changes.
          </p>
          <div className="oc-actions">
            <button className="btn large" disabled={busy} onClick={() => act(r, "decline")}>
              Decline
            </button>
            <button className="btn primary large" disabled={busy} aria-busy={busy} onClick={() => act(r, "accept")}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />} Accept
            </button>
          </div>
        </article>
      ))}
      {next ? (
        <section className="next-shift" aria-label="Your next shift">
          <span className="ns-label">Your next shift</span>
          <div className="ns-when">
            <span className="ns-day">{relativeDay(next.shift.date) === shortDate(next.shift.date) ? longDate(next.shift.date) : `${relativeDay(next.shift.date)} · ${longDate(next.shift.date)}`}</span>
            <span className="ns-time">{timeRange(next.shift)}</span>
          </div>
          <div className="ns-meta">
            <span>{next.shift.kind}</span>
            <span>{hours(paid(next.shift))} paid</span>
            {next.shift.breakMinutes > 0 && <span>Break {time(next.shift.breakStart!)}</span>}
            {requestFor(next.shift.id) && <span>Replacement requested</span>}
          </div>
          <div className="ns-actions">
            <button className="btn" onClick={() => onOpen(next.shift, next.week)}>
              View shift
            </button>
            {!requestFor(next.shift.id) && (
              <button className="btn ghost-light" onClick={() => onOpen(next.shift, next.week)}>
                Can’t make it?
              </button>
            )}
          </div>
        </section>
      ) : (
        <div className="panel">
          <EmptyState icon={<Sun size={20} />} title="No upcoming shifts">
            Your upcoming shifts will appear here once your manager adds them.
          </EmptyState>
        </div>
      )}
      {pendingMine.length > 0 && (
        <button className="panel attention-item" onClick={goRequests} style={{ borderRadius: 12 }}>
          <span className="a-icon accent">
            <ArrowLeftRight size={15} />
          </span>
          <span className="a-text">
            <strong>{plural(pendingMine.length, "request")} in progress</strong>
            <small>{statusMeta(pendingMine[0]).label} · {requestWhen(pendingMine[0])}</small>
          </span>
          <ChevronRight size={16} />
        </button>
      )}
      <section className="emp-section" aria-label="Schedule">
        <div className="emp-section-head">
          <h2>Schedule</h2>
          <span className="form-hint">
            {plural(shifts.length, "shift")} · {hours(weekHours)}
          </span>
        </div>
        <div className="week-nav">
          <button className="icon-btn" aria-label="Previous week" onClick={() => setWeek(dateAt(week, -7))}>
            <ChevronLeft size={18} />
          </button>
          <strong>{weekLabel(week)}</strong>
          <button className="icon-btn" aria-label="Next week" onClick={() => setWeek(dateAt(week, 7))}>
            <ChevronRight size={18} />
          </button>
        </div>
        {!shifts.length ? (
          <div className="panel">
            <EmptyState icon={<CalendarDays size={20} />} title="No shifts this week">
              Enjoy the time off, or check another week.
            </EmptyState>
          </div>
        ) : (
          shifts.map((s) => {
            const req = requestFor(s.id);
            return (
              <button
                key={s.id}
                className={`shift-tile ${s.kind.toLowerCase()} ${s.date === t ? "today" : ""}`}
                onClick={() => onOpen(s, week)}
                aria-label={`${longDate(s.date)}, ${timeRange(s)}, ${s.kind}`}
              >
                <span className="st-date">
                  <small>{weekdayShort(s.date)}</small>
                  <b>{dayOfMonth(s.date)}</b>
                </span>
                <span className="st-main">
                  <strong>{timeRange(s)}</strong>
                  <small>
                    {s.kind} · {hours(paid(s))}
                    {s.date === t && " · Today"}
                  </small>
                  {req && (
                    <span>
                      <RequestStatusPill request={req} />
                    </span>
                  )}
                </span>
                <ChevronRight size={18} />
              </button>
            );
          })
        )}
        <p className="form-hint">Times are local. Unpaid breaks aren’t counted in paid hours.</p>
      </section>
    </>
  );
}

function ShiftSheet({
  shift,
  request,
  names,
  onClose,
  onFind,
  onViewRequest,
}: {
  shift: Shift;
  request?: WorkforceRequest;
  names: Names;
  onClose: () => void;
  onFind: () => void;
  onViewRequest: () => void;
}) {
  const past = shift.date < today();
  return (
    <Modal title="Shift details" onClose={onClose} variant="drawer">
      <div className="modal-body" style={{ display: "grid", gap: 16 }}>
        <ShiftHero shift={shift} />
        <div className="detail-list">
          <div>
            <span className="k">Assigned to</span>
            <span className="v">You</span>
          </div>
          <div>
            <span className="k">Paid hours</span>
            <span className="v">{hours(paid(shift))}</span>
          </div>
          <div>
            <span className="k">Unpaid break</span>
            <span className="v">
              {shift.breakMinutes ? `${time(shift.breakStart!)} · ${shift.breakMinutes} min` : "None"}
            </span>
          </div>
          {shift.kind === "Closing" && (
            <div>
              <span className="k">Requirement</span>
              <span className="v">
                <CanClose /> Closing qualification
              </span>
            </div>
          )}
        </div>
        {request ? (
          <div className="req-card">
            <div className="rc-top">
              <div>
                <strong>Replacement requested</strong>
                <small>{requestSummary(request, names)}</small>
              </div>
              <RequestStatusPill request={request} />
            </div>
            <Stepper request={request} />
            <p className="form-hint">{statusMeta(request).next} This shift stays yours until a manager approves.</p>
          </div>
        ) : past ? (
          <Callout tone="neutral">This shift is in the past.</Callout>
        ) : (
          <Callout tone="accent" title="Can’t make it?">
            ShiftFlow shows which colleagues can actually take this shift, so you only ask people who are available
            and qualified.
          </Callout>
        )}
        <div className="modal-actions">
          {request ? (
            <button className="btn primary" onClick={onViewRequest}>
              View request
            </button>
          ) : (
            !past && (
              <button className="btn primary large" onClick={onFind}>
                <Users size={16} /> Find a replacement
              </button>
            )
          )}
        </div>
      </div>
    </Modal>
  );
}

function RequestsTab({
  data,
  busy,
  act,
}: {
  data: PortalData;
  busy: boolean;
  act: (r: WorkforceRequest, action: string, note?: string) => Promise<void>;
}) {
  const [view, setView] = useState<"active" | "past">("active");
  const [cancel, setCancel] = useState<WorkforceRequest | null>(null);
  const list = data.requests.filter((r) => (view === "active" ? isActive(r) : !isActive(r)));
  return (
    <>
      <div className="emp-greeting">
        <h1>Requests</h1>
        <p>Swaps, cover, time off and availability changes.</p>
      </div>
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={view === "active"} onClick={() => setView("active")}>
          In progress
          {data.requests.filter(isActive).length > 0 && <span className="count">{data.requests.filter(isActive).length}</span>}
        </button>
        <button role="tab" aria-selected={view === "past"} onClick={() => setView("past")}>
          Past
        </button>
      </div>
      {!list.length ? (
        <div className="panel">
          <EmptyState icon={<Inbox size={20} />} title={view === "active" ? "No requests in progress" : "No past requests"}>
            {view === "active"
              ? "Tap one of your shifts and choose “Find a replacement” to get started."
              : "Finished requests will be listed here."}
          </EmptyState>
        </div>
      ) : (
        list.map((r) => {
          const incoming = "targetEmployeeId" in r && r.targetEmployeeId === data.actor.id;
          return (
            <article className="req-card" key={r.id}>
              <div className="rc-top">
                <div>
                  <strong>
                    {incoming
                      ? `${firstName(nameOf(data.names, r.requesterId))} → you`
                      : "targetEmployeeId" in r
                        ? `${requestTitle(r)} with ${firstName(nameOf(data.names, r.targetEmployeeId))}`
                        : requestTitle(r)}
                  </strong>
                  <small>{requestWhen(r)}</small>
                </div>
                <RequestStatusPill request={r} />
              </div>
              {("shift" in r || r.kind === "time-off") && <Stepper request={r} />}
              <p className="form-hint">{statusMeta(r).next}</p>
              {r.status === "applied" && "shift" in r && (
                <p className="sync-note">
                  <CheckCircle2 size={12} /> Updated in ShiftFlow on {r.approvedAt && absoluteTime(r.approvedAt)}
                </p>
              )}
              <details className="disclosure">
                <summary>Details & history</summary>
                <div style={{ display: "grid", gap: 12 }}>
                  {"shift" in r ? (
                    <ChangeCards request={r} names={data.names} />
                  ) : (
                    <PersonalChange request={r} />
                  )}
                  <Timeline request={r} names={data.names} />
                </div>
              </details>
              {isActive(r) && (
                <div className="rc-actions">
                  {incoming && r.status === "pending-colleague" ? (
                    <>
                      <button className="btn" disabled={busy} onClick={() => act(r, "decline")}>
                        Decline
                      </button>
                      <button className="btn primary" disabled={busy} onClick={() => act(r, "accept")}>
                        Accept
                      </button>
                    </>
                  ) : r.requesterId === data.actor.id ? (
                    <button className="btn" disabled={busy} onClick={() => setCancel(r)}>
                      Cancel request
                    </button>
                  ) : null}
                </div>
              )}
            </article>
          );
        })
      )}
      {cancel && (
        <Modal title="Cancel this request?" description="The roster stays as it is and anyone involved is notified." onClose={() => setCancel(null)}>
          <div className="modal-body" style={{ padding: 0 }}>
            <div className="modal-actions">
              <button className="btn" onClick={() => setCancel(null)}>
                Keep request
              </button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => act(cancel, "cancel").then(() => setCancel(null))}
              >
                Cancel request
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function AvailBar({ w }: { w: Window | null }) {
  const open = 600,
    close = 1380,
    span = close - open;
  return (
    <div className="avail-bar">
      {w ? (
        <i
          style={{
            left: `${(Math.max(0, w.start - open) / span) * 100}%`,
            width: `${((Math.min(close, w.end) - Math.max(open, w.start)) / span) * 100}%`,
          }}
        >
          {time(w.start)}–{time(w.end)}
        </i>
      ) : (
        <span className="none">Not available</span>
      )}
    </div>
  );
}

function AvailabilityTab({
  data,
  onRequest,
}: {
  data: PortalData;
  onRequest: (k: "time-off" | "availability") => void;
}) {
  const e = data.employee;
  const upcomingOff = e.absentDates.filter((d) => d >= today());
  const pending = data.requests.filter(
    (r) => r.requesterId === data.actor.id && isActive(r) && (r.kind === "availability" || r.kind === "time-off"),
  );
  return (
    <>
      <div className="emp-greeting">
        <h1>Availability</h1>
        <p>When you can work. Your manager uses this when planning and when checking swaps.</p>
      </div>
      {pending.length > 0 && (
        <Callout tone="caution" title={`${plural(pending.length, "change")} waiting for approval`}>
          Your current availability applies until your manager approves.
        </Callout>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Every week</h2>
          <span className="form-hint">{e.preferredHours}h preferred</span>
        </div>
        <div className="avail-week">
          {e.availability.map((w, i) => (
            <div className="avail-day" key={i}>
              <b>{DAYS[i]}</b>
              <AvailBar w={w} />
            </div>
          ))}
        </div>
      </section>
      {(e.availabilityOverrides?.length ?? 0) > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <h2>One-off changes</h2>
          </div>
          <div className="avail-week">
            {e.availabilityOverrides!.map((o) => (
              <div className="avail-day" key={o.date} style={{ gridTemplateColumns: "92px minmax(0,1fr)" }}>
                <b>{shortDate(o.date)}</b>
                <AvailBar w={o.window} />
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Time off</h2>
        </div>
        <div className="panel-body">
          {upcomingOff.length ? (
            <div className="c-chips" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {upcomingOff.map((d) => (
                <span className="chip neutral" key={d}>
                  <CalendarOff size={12} /> {shortDate(d)}
                </span>
              ))}
            </div>
          ) : (
            <p className="form-hint">No upcoming approved time off.</p>
          )}
        </div>
      </section>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
        <button className="btn large" onClick={() => onRequest("time-off")}>
          <CalendarOff size={16} /> Request time off
        </button>
        <button className="btn primary large" onClick={() => onRequest("availability")}>
          <Clock3 size={16} /> Change availability
        </button>
      </div>
    </>
  );
}

function ProfileTab({
  data,
  restaurant,
  onRead,
}: {
  data: PortalData;
  restaurant: string;
  onRead: () => void;
}) {
  const e = data.employee;
  const notes = data.notifications.filter((n) => notificationFor(n, data.actor));
  const unread = notes.filter((n) => !n.readBy.includes(data.actor.id));
  async function markAll() {
    await Promise.allSettled(unread.map((n) => api("/api/workforce", { action: "read-notification", id: n.id })));
    onRead();
  }
  return (
    <>
      <section className="panel profile-card">
        <Avatar employee={e} size="large" />
        <div>
          <h1 style={{ fontSize: 19 }}>{e.name}</h1>
          <small>
            {e.role} · {restaurant}
          </small>
          <small>{e.email}</small>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Skills</h2>
          <span className="form-hint">Verified by your manager</span>
        </div>
        <div className="panel-body" style={{ display: "grid", gap: 10 }}>
          <CapabilityTags employee={e} catalog={data.skillCatalog} />
          <p className="form-hint">
            Skills decide which shifts you can be asked to cover. If something is missing, ask your manager to review
            your profile.
          </p>
        </div>
      </section>
      <section className="panel">
        <div className="detail-list" style={{ border: 0 }}>
          <div>
            <span className="k">Preferred hours per week</span>
            <span className="v">{e.preferredHours}h</span>
          </div>
          <div>
            <span className="k">Maximum hours per week</span>
            <span className="v">{e.maxHours}h</span>
          </div>
          <div>
            <span className="k">Shift types</span>
            <span className="v">{e.eligible.join(", ")}</span>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Notifications</h2>
          {unread.length > 0 && (
            <button className="text-link" onClick={markAll}>
              Mark all read
            </button>
          )}
        </div>
        <div className="panel-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {!notes.length ? (
            <p className="form-hint" style={{ padding: "8px 0" }}>
              No notifications yet.
            </p>
          ) : (
            notes.slice(0, 20).map((n) => (
              <div className="notif-item" key={n.id}>
                <span className={`unread-dot ${n.readBy.includes(data.actor.id) ? "read" : ""}`} />
                <span>
                  {notificationText(n.message, data.requests.find((r) => r.id === n.requestId), data.names)}
                  <small>{relativeTime(n.at)}</small>
                </span>
              </div>
            ))
          )}
        </div>
        <div className="panel-foot">In-app only. ShiftFlow doesn’t send emails or WhatsApp messages.</div>
      </section>
    </>
  );
}

/* =====================================================================
   Time off / availability request
   ===================================================================== */

function PersonalDialog({
  kind,
  data,
  onClose,
  onDone,
}: {
  kind: "time-off" | "availability";
  data: PortalData;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const first = dateAt(today(), 1);
  const [start, setStart] = useState(first),
    [end, setEnd] = useState(first),
    [availability, setAvailability] = useState<(Window | null)[]>(data.employee.availability),
    [overrides, setOverrides] = useState(data.employee.availabilityOverrides ?? []),
    [hoursPref, setHours] = useState(data.employee.preferredHours),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [overrideDate, setOverrideDate] = useState(first),
    [overrideWindow, setOverrideWindow] = useState<Window | null>(null);
  function setClock(value: string, apply: (v: number) => void) {
    const [h, m] = value.split(":").map(Number);
    apply(h * 60 + m);
  }
  const length = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const clash =
    kind === "time-off"
      ? data.weeks.flatMap((w) => w.shifts).filter((s) => s.date >= start && s.date <= end)
      : [];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (kind === "time-off") {
        if (length < 1 || length > 31) throw new Error("Choose a range of 1 to 31 days.");
        await api("/api/workforce", {
          action: "create-time-off",
          revision: data.revision,
          dates: Array.from({ length }, (_, i) => dateAt(start, i)),
          note,
        });
        onDone("Time-off request sent to your manager");
      } else {
        await api("/api/workforce", {
          action: "create-availability",
          revision: data.revision,
          availability,
          dateOverrides: overrides,
          preferredHours: hoursPref,
          note,
        });
        onDone("Availability change sent to your manager");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={kind === "time-off" ? "Request time off" : "Change availability"}
      description="Your manager reviews this. Nothing changes until it’s approved."
      onClose={onClose}
      variant="drawer"
    >
      <form className="editor-form" onSubmit={submit}>
        <ErrorBox error={error} />
        {kind === "time-off" ? (
          <>
            <div className="form-row">
              <label>
                From
                <input
                  type="date"
                  required
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    if (e.target.value > end) setEnd(e.target.value);
                  }}
                />
              </label>
              <label>
                Until
                <input type="date" required min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <p className="form-hint">{length > 0 ? plural(length, "day") : "Choose a valid range"}</p>
            {clash.length > 0 && (
              <Callout tone="caution" title={`You have ${plural(clash.length, "shift")} in this period`}>
                {clash.map((s) => `${shortDate(s.date)} ${timeRange(s)}`).join(", ")}. Find a replacement for these
                first, otherwise your manager can’t approve the time off.
              </Callout>
            )}
          </>
        ) : (
          <>
            <label>
              Preferred hours per week
              <input
                type="number"
                min={0}
                max={data.employee.maxHours}
                step={0.5}
                required
                value={hoursPref}
                onChange={(e) => setHours(Number(e.target.value))}
              />
              <span className="form-hint">Maximum {data.employee.maxHours}h.</span>
            </label>
            <fieldset>
              <legend>Every week</legend>
              {availability.map((w, i) => (
                <div className="personal-day" key={i}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={!!w}
                      onChange={(e) =>
                        setAvailability(
                          availability.map((v, j) => (j === i ? (e.target.checked ? { start: 600, end: 1380 } : null) : v)),
                        )
                      }
                    />
                    {DAYS[i]}
                  </label>
                  {w ? (
                    <>
                      <label className="field">
                        From
                        <input
                          type="time"
                          required
                          step="1800"
                          value={time(w.start)}
                          onChange={(e) =>
                            setClock(e.target.value, (v) =>
                              setAvailability(availability.map((a, j) => (j === i ? { ...w, start: v } : a))),
                            )
                          }
                        />
                      </label>
                      <label className="field">
                        Until
                        <input
                          type="time"
                          required
                          step="1800"
                          value={time(w.end)}
                          onChange={(e) =>
                            setClock(e.target.value, (v) =>
                              setAvailability(availability.map((a, j) => (j === i ? { ...w, end: v } : a))),
                            )
                          }
                        />
                      </label>
                    </>
                  ) : (
                    <span className="form-hint" style={{ gridColumn: "span 2" }}>
                      Not available
                    </span>
                  )}
                </div>
              ))}
            </fieldset>
            <fieldset>
              <legend>One-off changes</legend>
              {overrides.map((o) => (
                <div className="availability-line" key={o.date}>
                  <span>
                    {shortDate(o.date)}: {o.window ? `${time(o.window.start)}–${time(o.window.end)}` : "Not available"}
                  </span>
                  <button className="text-link" type="button" onClick={() => setOverrides(overrides.filter((v) => v.date !== o.date))}>
                    Remove
                  </button>
                </div>
              ))}
              <div className="form-row">
                <label>
                  Date
                  <input type="date" value={overrideDate} onChange={(e) => setOverrideDate(e.target.value)} />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!overrideWindow}
                    onChange={(e) => setOverrideWindow(e.target.checked ? { start: 600, end: 1380 } : null)}
                  />
                  Available that day
                </label>
              </div>
              {overrideWindow && (
                <div className="form-row">
                  <label>
                    From
                    <input
                      type="time"
                      step="1800"
                      required
                      value={time(overrideWindow.start)}
                      onChange={(e) => setClock(e.target.value, (v) => setOverrideWindow({ ...overrideWindow, start: v }))}
                    />
                  </label>
                  <label>
                    Until
                    <input
                      type="time"
                      step="1800"
                      required
                      value={time(overrideWindow.end)}
                      onChange={(e) => setClock(e.target.value, (v) => setOverrideWindow({ ...overrideWindow, end: v }))}
                    />
                  </label>
                </div>
              )}
              <button
                className="btn small"
                type="button"
                onClick={() =>
                  setOverrides([...overrides.filter((o) => o.date !== overrideDate), { date: overrideDate, window: overrideWindow }])
                }
              >
                <Plus size={14} /> Add one-off change
              </button>
            </fieldset>
          </>
        )}
        <label>
          Note for your manager (optional)
          <textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving} aria-busy={saving}>
            {saving ? "Sending…" : "Send for approval"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Re-exported for the schedule drawer.
export { ReplacementFinder };
