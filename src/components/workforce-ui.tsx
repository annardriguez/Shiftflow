"use client";
import { workspaceFetch } from "@/lib/workspace-fetch";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { AccountMenu } from "./auth-ui";
import { useApp } from "./provider";
import { Badge, ErrorBox, LoadGuard, Modal, PageTitle } from "./ui";
import { SkillBadges } from "./skills";
import { DAYS, dateAt, time, paidHours, weekLabel } from "@/lib/schedule";
import type {
  WorkforceRequest,
  PortalData,
  CoverOption,
  SwapOption,
  LocalNotification,
  DemoActor,
} from "@/lib/workforce-types";
import type { Workspace, Shift, Employee, Window } from "@/lib/types";
async function api(url: string, body?: unknown) {
  const r = await workspaceFetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
export { AccountMenu } from "./auth-ui";
export function EmployeeEntry() {
  return (
    <>
      <PageTitle
        eyebrow="EMPLOYEE ACCESS"
        title="Your team has their own sign-in."
        description="Employees use their provisioned accounts to view shifts and respond to offers. Managers review their requests here."
      />
      <Link className="btn primary" href="/requests">
        Review requests
      </Link>
      <p className="info-box">
        To test another fictional account, sign out and use its supplied
        credentials. You cannot assume an employee’s identity.
      </p>
    </>
  );
}
interface ManagerFeed {
  revision: number;
  requests: WorkforceRequest[];
  notifications: LocalNotification[];
  names: Record<string, string>;
}
function useFeed() {
  const [feed, setFeed] = useState<ManagerFeed | null>(null),
    [error, setError] = useState("");
  const load = useCallback(() => {
    api("/api/workforce")
      .then(setFeed)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  return { feed, error, setError, load };
}
export function ManagerRequests() {
  return (
    <LoadGuard>
      <ManagerRequestsContent />
    </LoadGuard>
  );
}
function ManagerRequestsContent() {
  const { data, reload, actor } = useApp(),
    { feed, error, setError, load } = useFeed();
  const [filter, setFilter] = useState("pending"),
    [busy, setBusy] = useState(false),
    [record, setRecord] = useState(false);
  if (!data || !actor) return null;
  async function act(r: WorkforceRequest, action: string, note: string) {
    setBusy(true);
    setError("");
    try {
      await api("/api/workforce", {
        action,
        id: r.id,
        version: r.version,
        revision: feed!.revision,
        note,
      });
      load();
      reload();
    } catch (e) {
      setError((e as Error).message);
      load();
      reload();
    } finally {
      setBusy(false);
    }
  }
  const requests = (feed?.requests ?? []).filter(
    (r) =>
      filter === "all" ||
      (filter === "pending"
        ? ["pending-colleague", "pending-manager"].includes(r.status)
        : r.status === "applied"),
  );
  return (
    <>
      <PageTitle
        eyebrow="PEOPLE FIRST · LOCAL APPROVALS"
        title="Every change, clearly agreed."
        description="Review requests, recheck the current roster and apply approved changes in ShiftFlow. Strobbo is not connected."
      >
        <button className="btn" disabled={busy} onClick={load}>
          Refresh requests
        </button>
        <button className="btn primary" onClick={() => setRecord(true)}>
          Record agreed change
        </button>
      </PageTitle>
      <div className="info-box">
        Employee cover offers and swaps need colleague acceptance before
        approval. Approval revalidates the entire proposal, including skills and
        supervision, then saves the roster, request and audit together. If a
        manual fixture has coverage gaps, generate and save a feasible roster in{" "}
        <Link href="/schedule">Schedule</Link> first.
      </div>
      <ErrorBox error={error} />
      <NotificationList
        notifications={feed?.notifications ?? []}
        actor={actor}
        onRead={load}
      />
      <div className="request-filters">
        {["pending", "applied", "all"].map((f) => (
          <button
            key={f}
            className={`btn ${filter === f ? "primary" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "pending"
              ? "Needs attention"
              : f === "applied"
                ? "Applied locally"
                : "All requests"}
          </button>
        ))}
      </div>
      {!feed ? (
        <p role="status">Loading requests…</p>
      ) : !requests.length ? (
        <div className="panel empty-state">
          <h2>You’re all caught up.</h2>
          <p>Employee offers and requests will appear here.</p>
          <Link className="btn" href="/employee">
            Explore employee portal
          </Link>
        </div>
      ) : (
        requests.map((r) => (
          <RequestCard
            key={r.id}
            request={r}
            names={feed.names}
            actor={actor}
            busy={busy}
            act={act}
          />
        ))
      )}
      {record && (
        <AgreementDialog
          workspace={data}
          revision={feed?.revision ?? data.revision}
          onClose={() => setRecord(false)}
          onDone={() => {
            setRecord(false);
            load();
            reload();
          }}
        />
      )}
    </>
  );
}
function NotificationList({
  notifications,
  actor,
  onRead,
}: {
  notifications: LocalNotification[];
  actor: DemoActor;
  onRead: () => void;
}) {
  const [error, setError] = useState("");
  const unread = notifications.filter((n) => !n.readBy.includes(actor.id));
  return (
    <details className="panel local-notifications">
      <summary>Local notifications · {unread.length} unread</summary>
      <p className="form-hint">
        In-app only. No emails, WhatsApp messages or external notifications are
        sent.
      </p>
      <ErrorBox error={error} />
      {notifications.slice(0, 30).map((n) => (
        <div className="notification-row" key={n.id}>
          <span>
            {n.message}
            <small>{new Date(n.at).toLocaleString()}</small>
          </span>
          {!n.readBy.includes(actor.id) && (
            <button
              className="btn"
              onClick={() =>
                api("/api/workforce", { action: "read-notification", id: n.id })
                  .then(onRead)
                  .catch((e) => setError(e.message))
              }
            >
              Mark read
            </button>
          )}
        </div>
      ))}
      {!notifications.length && <p>No local notifications yet.</p>}
    </details>
  );
}
function description(r: WorkforceRequest, names: Record<string, string>) {
  if ("targetEmployeeId" in r)
    return `${names[r.requesterId] ?? r.requesterId} → ${names[r.targetEmployeeId] ?? r.targetEmployeeId}: ${r.shift.date}, ${time(r.shift.start)}–${time(r.shift.end)}${r.counterShift ? ` ↔ ${r.counterShift.date}, ${time(r.counterShift.start)}–${time(r.counterShift.end)}` : ""}`;
  if (r.kind === "time-off")
    return `${names[r.requesterId] ?? r.requesterId}: ${r.dates.join(", ")}`;
  return `${names[r.requesterId] ?? r.requesterId}: recurring availability, ${r.dateOverrides.length} dated overrides and ${r.preferredHours}h preferred`;
}
function RequestCard({
  request: r,
  names,
  actor,
  busy,
  act,
}: {
  request: WorkforceRequest;
  names: Record<string, string>;
  actor: DemoActor;
  busy: boolean;
  act: (r: WorkforceRequest, action: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(""),
    [confirm, setConfirm] = useState(false);
  const active = ["pending-colleague", "pending-manager"].includes(r.status),
    receiving = "targetEmployeeId" in r && r.targetEmployeeId === actor.id;
  return (
    <article className="panel request-card">
      <div className="request-card-heading">
        <div>
          <h3>
            {r.kind === "cover"
              ? "Shift cover"
              : r.kind === "swap"
                ? "Shift swap"
                : r.kind === "time-off"
                  ? "Time off"
                  : "Availability & preferences"}
          </h3>
          <p>{description(r, names)}</p>
        </div>
        <Badge
          tone={r.status === "applied" ? "sage" : active ? "sand" : "neutral"}
        >
          {r.status.replaceAll("-", " ")}
        </Badge>
      </div>
      {r.note && <p className="request-note">“{r.note}”</p>}
      {"source" in r && r.source === "manager-recorded" && (
        <Badge tone="sand">Manager-recorded agreement</Badge>
      )}
      {r.kind === "availability" && (
        <details>
          <summary>Proposed availability</summary>
          {r.availability.map((w, i) => (
            <p key={i}>
              {DAYS[i]}: {w ? `${time(w.start)}–${time(w.end)}` : "Unavailable"}
            </p>
          ))}
          {r.dateOverrides.map((o) => (
            <p key={o.date}>
              {o.date}:{" "}
              {o.window
                ? `${time(o.window.start)}–${time(o.window.end)}`
                : "Unavailable"}
            </p>
          ))}
        </details>
      )}
      {r.approvedAt && (
        <p className="form-hint">
          Applied in ShiftFlow by {names[r.approvedBy!] ?? r.approvedBy} ·{" "}
          {new Date(r.approvedAt).toLocaleString()} · roster revision{" "}
          {r.appliedRevision}. Strobbo: not connected.
        </p>
      )}
      {active && (
        <>
          <label className="request-response">
            Response / audit note
            <input
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional explanation"
            />
          </label>
          <div className="flex-row request-actions">
            {actor.role === "manager" ? (
              <>
                {r.status === "pending-manager" ? (
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      confirm
                        ? act(r, "approve", note).then(() => setConfirm(false))
                        : setConfirm(true)
                    }
                  >
                    {confirm ? "Revalidate & apply now" : "Review approval"}
                  </button>
                ) : (
                  <span className="form-hint">
                    Awaiting colleague acceptance.
                  </span>
                )}
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => act(r, "reject", note)}
                >
                  Reject
                </button>
              </>
            ) : receiving && r.status === "pending-colleague" ? (
              <>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => act(r, "accept", note)}
                >
                  Accept offer
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => act(r, "decline", note)}
                >
                  Decline
                </button>
              </>
            ) : null}
            {r.requesterId === actor.id && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => act(r, "cancel", note)}
              >
                Cancel request
              </button>
            )}
          </div>
          {confirm && (
            <p className="info-box">
              This applies the complete change to the current ShiftFlow roster
              after fresh validation. Both parties receive local notification
              events. Nothing is synchronized to Strobbo.
            </p>
          )}
        </>
      )}
      <details>
        <summary>History · {r.history.length} events</summary>
        <ol className="request-history">
          {r.history.map((h, i) => (
            <li key={i}>
              <strong>{h.to.replaceAll("-", " ")}</strong> ·{" "}
              {names[h.actorId] ?? h.actorId}
              <small>
                {new Date(h.at).toLocaleString()} {h.note && `· ${h.note}`}
              </small>
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}
export function EmployeePortal() {
  const { actor } = useApp();
  const [data, setData] = useState<PortalData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [week, setWeek] = useState("2026-11-16"),
    [offer, setOffer] = useState<Shift | null>(null),
    [personal, setPersonal] = useState<"time-off" | "availability" | null>(
      null,
    ),
    [tab, setTab] = useState("shifts");
  const load = useCallback(() => {
    api("/api/workforce")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  if (!actor) return null;
  async function act(r: WorkforceRequest, action: string, note: string) {
    setBusy(true);
    setError("");
    try {
      await api("/api/workforce", {
        action,
        id: r.id,
        version: r.version,
        revision: data!.revision,
        note,
      });
      load();
    } catch (e) {
      setError((e as Error).message);
      load();
    } finally {
      setBusy(false);
    }
  }
  const shifts = data?.weeks.find((w) => w.start === week)?.shifts ?? [];
  return (
    <div className="employee-shell">
      <header className="employee-header">
        <Link href="/employee" className="brand">
          shiftflow<span>.</span>
        </Link>
        <AccountMenu />
      </header>
      <main className="employee-main">
        <div className="eyebrow">YOUR TEAM, IN FLOW · FICTIONAL DATA</div>
        <h1>Hi {actor.name.split(" ")[0]}, here’s your week.</h1>
        <p className="employee-intro">
          {actor.tenantName}. Your shifts, cover offers and requests, in one
          place. All changes need manager approval. Strobbo is not connected.
        </p>
        <ErrorBox error={error} />
        {!data ? (
          <p role="status">Loading your portal…</p>
        ) : (
          <>
            <div className="employee-profile">
              <SkillBadges
                employee={data.employee}
                catalog={data.skillCatalog}
              />
              <span>
                {data.employee.preferredHours}h preferred /{" "}
                {data.employee.maxHours}h maximum
              </span>
            </div>
            <div className="request-filters">
              {["shifts", "requests", "availability"].map((t) => (
                <button
                  key={t}
                  className={`btn ${tab === t ? "primary" : ""}`}
                  onClick={() => setTab(t)}
                >
                  {t === "shifts"
                    ? "My shifts"
                    : t === "requests"
                      ? `My requests · ${data.requests.filter((r) => ["pending-colleague", "pending-manager"].includes(r.status)).length} pending`
                      : "Availability & time off"}
                </button>
              ))}
              <button className="btn" onClick={load}>
                Refresh
              </button>
            </div>
            <NotificationList
              notifications={data.notifications}
              actor={actor}
              onRead={load}
            />
            {tab === "shifts" ? (
              <>
                <div className="employee-week">
                  <button
                    className="btn"
                    aria-label="Previous week"
                    onClick={() => setWeek(dateAt(week, -7))}
                  >
                    ←
                  </button>
                  <strong>{weekLabel(week)}</strong>
                  <button
                    className="btn"
                    aria-label="Next week"
                    onClick={() => setWeek(dateAt(week, 7))}
                  >
                    →
                  </button>
                </div>
                <p className="form-hint">
                  Local draft assignments · Amsterdam time · unpaid breaks
                  excluded.
                </p>
                {!shifts.length ? (
                  <div className="panel empty-state">
                    <h2>No shifts this week.</h2>
                    <p>
                      Check another week or ask the fictional manager to save a
                      roster.
                    </p>
                  </div>
                ) : (
                  [...shifts]
                    .sort(
                      (a, b) =>
                        a.date.localeCompare(b.date) || a.start - b.start,
                    )
                    .map((s) => (
                      <article className="panel my-shift" key={s.id}>
                        <div>
                          <strong>{s.date}</strong>
                          <h2>
                            {time(s.start)}–{time(s.end)}
                          </h2>
                          <p>
                            {s.kind} · {paidHours(s)} paid hours
                          </p>
                          <small>
                            {s.breakMinutes
                              ? `Break ${time(s.breakStart!)} · ${s.breakMinutes}m unpaid`
                              : "No unpaid break"}
                          </small>
                        </div>
                        <button
                          className="btn primary"
                          onClick={() => setOffer(s)}
                        >
                          Find cover or swap
                        </button>
                      </article>
                    ))
                )}
              </>
            ) : tab === "requests" ? (
              <>
                {!data.requests.length ? (
                  <div className="panel empty-state">
                    <h2>No requests yet.</h2>
                    <p>Offer a shift or ask for time off to get started.</p>
                  </div>
                ) : (
                  data.requests.map((r) => (
                    <RequestCard
                      key={r.id}
                      request={r}
                      names={data.names}
                      actor={actor}
                      busy={busy}
                      act={act}
                    />
                  ))
                )}
              </>
            ) : (
              <section className="panel employee-preferences">
                <h2>Your availability</h2>
                {data.employee.availability.map((w, i) => (
                  <div className="availability-line" key={i}>
                    <strong>{DAYS[i]}</strong>
                    <span>
                      {w ? `${time(w.start)}–${time(w.end)}` : "Unavailable"}
                    </span>
                  </div>
                ))}
                {data.employee.availabilityOverrides?.map((o) => (
                  <p key={o.date}>
                    {o.date}:{" "}
                    {o.window
                      ? `${time(o.window.start)}–${time(o.window.end)}`
                      : "Unavailable"}
                  </p>
                ))}
                <p>
                  Approved time off:{" "}
                  {data.employee.absentDates.join(", ") || "None"}
                </p>
                <div className="flex-row">
                  <button
                    className="btn primary"
                    onClick={() => setPersonal("availability")}
                  >
                    Request availability change
                  </button>
                  <button
                    className="btn"
                    onClick={() => setPersonal("time-off")}
                  >
                    Request time off
                  </button>
                </div>
                <p className="form-hint">
                  Your competencies are verified by the manager. You cannot
                  certify your own skills.
                </p>
              </section>
            )}
          </>
        )}
        {offer && data && (
          <OfferDialog
            shift={offer}
            week={week}
            revision={data.revision}
            onClose={() => setOffer(null)}
            onDone={() => {
              setOffer(null);
              setTab("requests");
              load();
            }}
          />
        )}
        {personal && data && (
          <PersonalDialog
            kind={personal}
            data={data}
            onClose={() => setPersonal(null)}
            onDone={() => {
              setPersonal(null);
              setTab("requests");
              load();
            }}
          />
        )}
      </main>
      <footer className="employee-footer">
        Local authenticated workspace · Fictional data · Milestone 5
      </footer>
    </div>
  );
}
function OfferDialog({
  shift,
  week,
  revision,
  onClose,
  onDone,
  recording,
}: {
  shift: Shift;
  week: string;
  revision: number;
  onClose: () => void;
  onDone: () => void;
  recording?: { requesterId: string };
}) {
  const [mode, setMode] = useState<"cover" | "swap">("cover"),
    [options, setOptions] = useState<(CoverOption | SwapOption)[]>([]),
    [selected, setSelected] = useState(""),
    [checkedRevision, setCheckedRevision] = useState<number | null>(null),
    [current, setCurrent] = useState(shift),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [note, setNote] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setOptions([]);
    setSelected("");
    setCheckedRevision(null);
    setLoading(true);
    setError("");
    api(
      `/api/workforce?view=candidates&mode=${mode}&week=${week}&shiftId=${encodeURIComponent(shift.id)}`,
    )
      .then((r) => {
        if (live) {
          setOptions(r.options);
          setCheckedRevision(r.revision);
          setCurrent(r.offeredShift);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [mode, week, shift.id, attempt]);
  function key(o: CoverOption | SwapOption) {
    return "employeeId" in o ? o.employeeId : o.shift.id;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const choice = options.find((o) => key(o) === selected);
    if (!choice?.eligible || checkedRevision === null) return;
    setSaving(true);
    setError("");
    try {
      const targetEmployeeId =
        "employeeId" in choice ? choice.employeeId : choice.shift.employeeId;
      await api("/api/workforce", {
        action: recording ? "record-agreement" : "create-shift",
        revision: checkedRevision,
        kind: mode,
        week,
        shiftId: shift.id,
        targetEmployeeId,
        ...("shift" in choice
          ? { counterWeek: choice.week, counterShiftId: choice.shift.id }
          : {}),
        note,
        ...(recording
          ? {
              requesterId: recording.requesterId,
              agreementConfirmed: confirmed,
            }
          : {}),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={recording ? "Record an agreed change" : "Find Shift Cover"}
      description={
        recording
          ? "Record an agreement, revalidate and apply it locally as the demo manager."
          : "Check cover or a two-way swap. The colleague accepts, then the manager approves."
      }
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={submit}>
        <ErrorBox error={error} />
        <div className="info-box">
          Offered shift: {current.date} · {time(current.start)}–
          {time(current.end)} · {current.kind}.{" "}
          {revision !== checkedRevision && checkedRevision !== null
            ? "The latest saved roster is used."
            : ""}
        </div>
        <div className="request-filters">
          <button
            type="button"
            className={`btn ${mode === "cover" ? "primary" : ""}`}
            disabled={saving}
            onClick={() => setMode("cover")}
          >
            Give away shift
          </button>
          <button
            type="button"
            className={`btn ${mode === "swap" ? "primary" : ""}`}
            disabled={saving}
            onClick={() => setMode("swap")}
          >
            Two-way swap
          </button>
          <button
            type="button"
            className="btn"
            disabled={saving || loading}
            onClick={() => setAttempt((n) => n + 1)}
          >
            Recheck eligibility
          </button>
        </div>
        <p className="form-hint">
          Eligibility checks the entire proposed roster and adjacent weeks.
          Qualifications, coverage, supervision, availability, rest, breaks and
          hour limits are mandatory. Preferences only rank eligible covers. Swap
          options include the selected and adjacent stored weeks.
        </p>
        {checkedRevision !== null && (
          <p className="form-hint">
            Checked at workspace revision {checkedRevision}. We revalidate when
            you send the request and before approval.
          </p>
        )}
        {loading ? (
          <p role="status">Checking all configured mandatory rules…</p>
        ) : (
          <div className="cover-options">
            {options.map((o) => (
              <label
                className={`cover-option ${o.eligible ? "eligible" : "ineligible"}`}
                key={key(o)}
              >
                <div className="cover-option-header">
                  <input
                    type="radio"
                    name="candidate"
                    disabled={!o.eligible || saving}
                    checked={selected === key(o)}
                    value={key(o)}
                    onChange={() => setSelected(key(o))}
                  />
                  <strong>{"name" in o ? o.name : o.employeeName}</strong>
                  <Badge tone={o.eligible ? "sage" : "peach"}>
                    {o.eligible ? "Eligible" : "Ineligible"}
                  </Badge>
                </div>
                {"scheduledHours" in o ? (
                  <p>
                    {o.scheduledHours}h currently scheduled / {o.preferredHours}
                    h preferred {o.canClose ? "· Can close " : ""}
                    {o.canSupervise ? "· Can supervise" : ""}
                  </p>
                ) : (
                  <p>
                    {o.shift.date} · {time(o.shift.start)}–{time(o.shift.end)} ·{" "}
                    {o.shift.kind}
                  </p>
                )}
                {!o.eligible && (
                  <details>
                    <summary>
                      {o.reasons[0] ?? "Mandatory check failed"}
                    </summary>
                    {o.reasons.slice(1, 20).map((r, i) => (
                      <p key={i}>{r}</p>
                    ))}
                    {o.reasons.length > 20 && (
                      <p>
                        {o.reasons.length - 20} additional violations. Ask the
                        manager to repair the roster.
                      </p>
                    )}
                  </details>
                )}
              </label>
            ))}
            {!options.length && !error && (
              <p>No colleagues or return shifts are available to assess.</p>
            )}
          </div>
        )}
        <label>
          {recording
            ? "Agreement and source (required)"
            : "Message to your colleague (optional)"}
          <textarea
            value={note}
            maxLength={500}
            required={!!recording}
            minLength={recording ? 5 : 0}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              recording
                ? "For example: both colleagues agreed in person."
                : "Can you help cover this shift?"
            }
          />
        </label>
        {recording && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I have confirmed this agreement with both employees.
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={
              saving ||
              loading ||
              !selected ||
              (recording && !confirmed) ||
              checkedRevision === null
            }
          >
            {saving
              ? "Revalidating…"
              : recording
                ? "Validate & apply agreed change"
                : "Send request"}
          </button>
        </div>
        <p className="form-hint">
          Saving in ShiftFlow never updates Strobbo. All people and agreements
          in this demo are fictional.
        </p>
      </form>
    </Modal>
  );
}
function AgreementDialog({
  workspace,
  revision,
  onClose,
  onDone,
}: {
  workspace: Workspace;
  revision: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [owner, setOwner] = useState(workspace.employees[0].id),
    [shiftId, setShiftId] = useState(""),
    [start, setStart] = useState(false);
  const shifts = workspace.weeks.flatMap((w) =>
      w.shifts
        .filter((s) => s.employeeId === owner)
        .map((s) => ({ shift: s, week: w.start })),
    ),
    choice = shifts.find((s) => s.shift.id === shiftId);
  if (start && choice)
    return (
      <OfferDialog
        recording={{ requesterId: owner }}
        shift={choice.shift}
        week={choice.week}
        revision={revision}
        onClose={onClose}
        onDone={onDone}
      />
    );
  return (
    <Modal
      title="Record an agreed shift change"
      description="For a manager-recorded agreement. Confirm both employees’ consent and retain the source in the audit."
      onClose={onClose}
    >
      <div className="editor-form">
        <label>
          Employee offering a shift
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
          Offered shift
          <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            <option value="">Select a saved shift</option>
            {shifts.map((s) => (
              <option key={s.shift.id} value={s.shift.id}>
                {s.shift.date} · {time(s.shift.start)}–{time(s.shift.end)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn primary"
          disabled={!choice}
          onClick={() => setStart(true)}
        >
          Find eligible cover or swap
        </button>
      </div>
    </Modal>
  );
}
function PersonalDialog({
  kind,
  data,
  onClose,
  onDone,
}: {
  kind: "time-off" | "availability";
  data: PortalData;
  onClose: () => void;
  onDone: () => void;
}) {
  const [start, setStart] = useState("2026-11-16"),
    [end, setEnd] = useState("2026-11-16"),
    [availability, setAvailability] = useState<(Window | null)[]>(
      data.employee.availability,
    ),
    [overrides, setOverrides] = useState(
      data.employee.availabilityOverrides ?? [],
    ),
    [hours, setHours] = useState(data.employee.preferredHours),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [overrideDate, setOverrideDate] = useState("2026-11-16"),
    [overrideWindow, setOverrideWindow] = useState<Window | null>(null);
  function setClock(value: string, apply: (v: number) => void) {
    const [h, m] = value.split(":").map(Number);
    apply(h * 60 + m);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (kind === "time-off") {
        const length =
          Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
        if (length < 1 || length > 31)
          throw new Error("Choose a range of 1–31 days.");
        await api("/api/workforce", {
          action: "create-time-off",
          revision: data.revision,
          dates: Array.from({ length }, (_, i) => dateAt(start, i)),
          note,
        });
      } else
        await api("/api/workforce", {
          action: "create-availability",
          revision: data.revision,
          availability,
          dateOverrides: overrides,
          preferredHours: hours,
          note,
        });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={
        kind === "time-off"
          ? "Request time off"
          : "Request availability & preferences"
      }
      description="Your manager reviews the request. Your existing availability and shifts stay unchanged until approval."
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={submit}>
        <ErrorBox error={error} />
        {kind === "time-off" ? (
          <div className="form-row">
            <label>
              First day
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
              Last day
              <input
                type="date"
                required
                min={start}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
        ) : (
          <>
            <label>
              Preferred weekly hours
              <input
                type="number"
                min={0}
                max={data.employee.maxHours}
                step={0.5}
                required
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </label>
            <h3>Recurring weekly availability</h3>
            {availability.map((w, i) => (
              <div className="personal-day" key={i}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!w}
                    onChange={(e) =>
                      setAvailability(
                        availability.map((v, j) =>
                          j === i
                            ? e.target.checked
                              ? { start: 600, end: 1380 }
                              : null
                            : v,
                        ),
                      )
                    }
                  />
                  {DAYS[i]}
                </label>
                {w && (
                  <>
                    <label>
                      From
                      <input
                        type="time"
                        required
                        step="1800"
                        value={time(w.start)}
                        onChange={(e) =>
                          setClock(e.target.value, (v) =>
                            setAvailability(
                              availability.map((a, j) =>
                                j === i ? { ...w, start: v } : a,
                              ),
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Until
                      <input
                        type="time"
                        required
                        step="1800"
                        value={time(w.end)}
                        onChange={(e) =>
                          setClock(e.target.value, (v) =>
                            setAvailability(
                              availability.map((a, j) =>
                                j === i ? { ...w, end: v } : a,
                              ),
                            ),
                          )
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            ))}
            <h3>Date-specific exceptions</h3>
            {overrides.map((o) => (
              <div className="availability-line" key={o.date}>
                <span>
                  {o.date}:{" "}
                  {o.window
                    ? `${time(o.window.start)}–${time(o.window.end)}`
                    : "Unavailable"}
                </span>
                <button
                  className="text-link"
                  type="button"
                  onClick={() =>
                    setOverrides(overrides.filter((v) => v.date !== o.date))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="form-row">
              <label>
                Date
                <input
                  type="date"
                  required
                  value={overrideDate}
                  onChange={(e) => setOverrideDate(e.target.value)}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!overrideWindow}
                  onChange={(e) =>
                    setOverrideWindow(
                      e.target.checked ? { start: 600, end: 1380 } : null,
                    )
                  }
                />
                Available on this date
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
                    onChange={(e) =>
                      setClock(e.target.value, (v) =>
                        setOverrideWindow({ ...overrideWindow, start: v }),
                      )
                    }
                  />
                </label>
                <label>
                  Until
                  <input
                    type="time"
                    step="1800"
                    required
                    value={time(overrideWindow.end)}
                    onChange={(e) =>
                      setClock(e.target.value, (v) =>
                        setOverrideWindow({ ...overrideWindow, end: v }),
                      )
                    }
                  />
                </label>
              </div>
            )}
            <button
              className="btn"
              type="button"
              onClick={() =>
                setOverrides([
                  ...overrides.filter((o) => o.date !== overrideDate),
                  { date: overrideDate, window: overrideWindow },
                ])
              }
            >
              Add / replace exception
            </button>
            <p className="form-hint">
              Add the exception above before submitting. Approved absences
              always take precedence.
            </p>
          </>
        )}
        <label>
          Note (optional)
          <textarea
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            {saving ? "Submitting…" : "Submit for manager review"}
          </button>
        </div>
        <p className="form-hint">
          Approval cannot leave existing assignments unavailable or remove
          required skilled cover. Your manager may need to rearrange shifts
          first.
        </p>
      </form>
    </Modal>
  );
}
