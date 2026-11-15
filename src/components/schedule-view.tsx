"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Download,
  Search,
  Sparkles,
  CalendarDays,
  List,
  AlertTriangle,
  Trash2,
  Check,
  Clock3,
  ArrowLeftRight,
  CheckCircle2,
  PenLine,
  ChevronRight,
} from "lucide-react";
import { useApp } from "./provider";
import {
  Avatar,
  Badge,
  Callout,
  EmptyState,
  ErrorBox,
  LoadGuard,
  Modal,
  NumberValue,
  PageTitle,
  WeekPicker,
} from "./ui";
import {
  availabilityOn,
  dateAt,
  dayHours,
  DAYS,
  employeeHours,
  getWeek,
  metrics,
  paidHours,
  time,
} from "@/lib/schedule";
import type { Shift, ShiftKind } from "@/lib/types";
import { SkillBadges, SkillCoverage } from "./skills";
import { skillDiagnostics } from "@/lib/skills";
import { ReplacementFinder, ShiftHero } from "./replacement";
import { RequestStatusPill } from "./requests";
import { exportRoster } from "@/lib/download";
import { statusMeta } from "@/lib/swap-insights";
import { dayOfMonth, hours, longDate, plural, today } from "@/lib/format";
import type { ShiftRequest } from "@/lib/workforce-types";
export { exportRoster } from "@/lib/download";

export function useNarrow(px = 760) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(`(max-width: ${px}px)`);
    const set = () => setNarrow(m.matches);
    set();
    m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, [px]);
  return narrow;
}

export function Schedule() {
  return (
    <LoadGuard>
      <ScheduleContent />
    </LoadGuard>
  );
}

function ScheduleContent() {
  const { data, week } = useApp(),
    narrow = useNarrow(),
    [query, setQuery] = useState(""),
    [role, setRole] = useState("all"),
    [view, setView] = useState<"week" | "list" | null>(null),
    [dialog, setDialog] = useState<{ shift?: Shift; employeeId?: string; day?: number } | null>(null);
  if (!data) return null;
  const mode = view ?? (narrow ? "list" : "week");
  const roster = getWeek(data, week),
    m = metrics(roster, data),
    t = today(),
    people = data.employees.filter(
      (e) => e.name.toLowerCase().includes(query.toLowerCase()) && (role === "all" || e.role === role),
    );
  const dates = DAYS.map((_, i) => dateAt(week, i));
  const skillIssues = skillDiagnostics(data, roster.shifts, dates).issues;
  const issuesByDay = dates.map((d) => skillIssues.filter((i) => i.date === d).length);
  const gapsByDay = dates.map((_, i) => m.gaps.filter((g) => g.day === i).length);
  const activeRequests = (data.requests ?? []).filter(
    (r): r is ShiftRequest => (r.kind === "cover" || r.kind === "swap") && statusMeta(r).active,
  );
  const requestFor = (id: string) =>
    activeRequests.find((r) => r.shift.id === id || r.counterShift?.id === id);
  const budget = roster.budgets.reduce((a, b) => a + b, 0);
  const provenance = roster.provenance
    ? `Generated (${roster.provenance.strategy.replaceAll("-", " ")})${roster.provenance.edited ? ", edited" : ""}`
    : "Built manually";
  return (
    <>
      <PageTitle title="Schedule" description={`${plural(roster.shifts.length, "shift")} this week · ${provenance}`}>
        <button className="btn" onClick={() => exportRoster(data, week)}>
          <Download size={15} /> Export CSV
        </button>
        <Link className="btn" href="/intelligence">
          <Sparkles size={15} /> Generate week
        </Link>
        <button className="btn primary" onClick={() => setDialog({})}>
          <Plus size={15} /> Add shift
        </button>
      </PageTitle>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Scheduled hours</span>
          <span className="stat-value">
            <NumberValue value={m.hours} />
            <small>/ {budget}h target</small>
          </span>
          <span className={`stat-note ${m.hours > budget ? "caution" : ""}`}>
            {m.hours > budget ? `${hours(m.hours - budget)} over target` : `${hours(budget - m.hours)} under target`}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Staffing coverage</span>
          <span className="stat-value">
            {m.coverage}
            <small>%</small>
          </span>
          <span className={`stat-note ${m.gaps.length ? "caution" : "positive"}`}>
            {m.gaps.length ? `${plural(m.gaps.length, "half-hour")} short of target` : "Every half-hour on target"}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Skills & supervision</span>
          <span className="stat-value">{skillIssues.length ? skillIssues.length : <CheckCircle2 size={22} color="var(--positive)" />}</span>
          <span className={`stat-note ${skillIssues.length ? "negative" : "positive"}`}>
            {skillIssues.length ? "issues to fix before approving swaps" : "All required skills covered"}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Open swap requests</span>
          <span className="stat-value">{activeRequests.filter((r) => dates.includes(r.shift.date)).length}</span>
          <Link className="stat-note text-link" href="/requests" style={{ fontSize: 12 }}>
            Open Swap Centre <ChevronRight size={12} />
          </Link>
        </div>
      </div>
      {skillIssues.length > 0 && (
        <Callout tone="caution" title={`${plural(skillIssues.length, "skill or supervision issue")} this week`}>
          {humanIssue(skillIssues[0].message)} Swaps that touch these days can’t be approved until they’re fixed. Days
          with issues are marked in the roster.
        </Callout>
      )}
      <section className="panel schedule-panel">
        <div className="schedule-toolbar">
          <WeekPicker />
          <div className="search-field">
            <Search size={15} />
            <input
              placeholder="Search team"
              aria-label="Search team"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="all">All roles</option>
            <option>Team member</option>
            <option>Shift leader</option>
          </select>
          <div className="view-toggle" role="group" aria-label="View">
            <button className={mode === "week" ? "selected" : ""} onClick={() => setView("week")} aria-pressed={mode === "week"}>
              <CalendarDays size={14} /> Week
            </button>
            <button className={mode === "list" ? "selected" : ""} onClick={() => setView("list")} aria-pressed={mode === "list"}>
              <List size={14} /> List
            </button>
          </div>
        </div>
        {mode === "week" ? (
          <div className="roster-scroll">
            <table className="roster-table">
              <colgroup>
                <col className="person-col" />
                {DAYS.map((d) => (
                  <col key={d} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th>
                    <div className="person-head">
                      <span>Team</span>
                      <small>{plural(people.length, "person", "people")}</small>
                    </div>
                  </th>
                  {DAYS.map((d, i) => {
                    const isToday = dates[i] === t;
                    const flagged = issuesByDay[i] + gapsByDay[i];
                    return (
                      <th key={d} className={isToday ? "is-today" : ""} aria-current={isToday ? "date" : undefined}>
                        <div className="day-head">
                          <div className="dh-top">
                            <span>{d}</span>
                            <b className={isToday ? "dh-today" : ""}>{dayOfMonth(dates[i])}</b>
                          </div>
                          <div className="dh-meta">
                            <span>
                              <NumberValue value={dayHours(roster, i)} />/{roster.budgets[i]}h
                            </span>
                            {issuesByDay[i] ? (
                              <span className="dh-flag" title={`${issuesByDay[i]} skill or supervision issues`}>
                                <AlertTriangle size={11} /> Skills
                              </span>
                            ) : flagged ? (
                              <span className="dh-flag" title={`${gapsByDay[i]} half-hours below staffing target`}>
                                <AlertTriangle size={11} /> Short
                              </span>
                            ) : roster.shifts.some((s) => s.date === dates[i]) ? (
                              <span className="dh-flag ok">
                                <Check size={11} /> Covered
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {people.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="person-cell">
                        <Avatar employee={e} small />
                        <div>
                          <strong>{e.name}</strong>
                          <SkillBadges employee={e} compact />
                          <small>
                            <NumberValue value={employeeHours(roster, e.id)} />h of {e.preferredHours}h preferred
                          </small>
                        </div>
                      </div>
                    </td>
                    {DAYS.map((_, day) => {
                      const date = dates[day];
                      const ss = roster.shifts.filter((s) => s.employeeId === e.id && s.date === date),
                        absent = e.absentDates.includes(date);
                      return (
                        <td key={day} className={date === t ? "is-today" : ""}>
                          {ss.length ? (
                            ss.map((s) => {
                              const req = requestFor(s.id);
                              return (
                                <button
                                  key={s.id}
                                  className={`roster-shift ${s.kind.toLowerCase()} ${req ? "has-request" : ""}`}
                                  onClick={() => setDialog({ shift: s })}
                                  aria-label={`${e.name}, ${longDate(date)}, ${time(s.start)} to ${time(s.end)}, ${s.kind}${req ? `, ${statusMeta(req).label}` : ""}`}
                                >
                                  <strong>
                                    {time(s.start)}–{time(s.end)}
                                  </strong>
                                  <span>
                                    {s.kind}
                                    <b>{paidHours(s)}h</b>
                                  </span>
                                  {req && (
                                    <span
                                      className={`shift-flag ${req.status === "pending-manager" ? "" : "caution"}`}
                                      title={statusMeta(req).label}
                                    >
                                      <ArrowLeftRight size={9} strokeWidth={3} />
                                    </span>
                                  )}
                                </button>
                              );
                            })
                          ) : absent ? (
                            <span className="off-label absence">Time off</span>
                          ) : !availabilityOn(e, date) ? (
                            <span className="off-label">Unavailable</span>
                          ) : (
                            <button
                              className="add-cell"
                              aria-label={`Add shift for ${e.name} on ${longDate(date)}`}
                              onClick={() => setDialog({ employeeId: e.id, day })}
                            >
                              <Plus size={15} />
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="agenda">
            {dates.map((date, i) => {
              const ss = roster.shifts
                .filter((s) => s.date === date && people.some((p) => p.id === s.employeeId))
                .sort((a, b) => a.start - b.start);
              return (
                <div className="agenda-day" key={date}>
                  <div className={`agenda-day-head ${date === t ? "today" : ""}`}>
                    <span>
                      {longDate(date)}
                      {date === t && " · Today"}
                    </span>
                    <small>
                      {plural(ss.length, "shift")} · <NumberValue value={dayHours(roster, i)} />/{roster.budgets[i]}h
                      {issuesByDay[i] ? " · skills to fix" : ""}
                    </small>
                  </div>
                  {!ss.length && (
                    <p className="form-hint" style={{ padding: "10px 16px" }}>
                      No shifts.
                    </p>
                  )}
                  {ss.map((s) => {
                    const e = data.employees.find((x) => x.id === s.employeeId)!;
                    const req = requestFor(s.id);
                    return (
                      <button className="agenda-row" key={s.id} onClick={() => setDialog({ shift: s })}>
                        <span className={`kind-bar ${s.kind.toLowerCase()}`} />
                        <span className="when">
                          <strong>
                            {time(s.start)}–{time(s.end)}
                          </strong>
                          <small>
                            {s.kind} · {paidHours(s)}h
                          </small>
                        </span>
                        <span className="person-cell">
                          <Avatar employee={e} small />
                          <div>
                            <strong>{e.name}</strong>
                            <SkillBadges employee={e} compact />
                          </div>
                        </span>
                        {req ? <RequestStatusPill request={req} /> : <span />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        {people.length === 0 && (
          <EmptyState icon={<Search size={20} />} title="No one matches">
            Try a different name or role.
          </EmptyState>
        )}
        <div className="panel-foot">
          <div className="shift-legend">
            <span>
              <i className="shift-dot opening" /> Opening
            </span>
            <span>
              <i className="shift-dot midday" /> Midday
            </span>
            <span>
              <i className="shift-dot closing" /> Closing
            </span>
            <span>
              <span className="shift-flag" style={{ position: "static", display: "inline-grid", placeItems: "center", width: 14, height: 14, borderRadius: "50%", background: "var(--accent)", color: "#fff" }}>
                <ArrowLeftRight size={8} strokeWidth={3} />
              </span>
              Swap in progress
            </span>
          </div>
          <span>Local time · unpaid breaks excluded · every edit is checked before saving</span>
        </div>
      </section>
      {dialog && <ShiftDialog {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

/** Make the client-side skill diagnostic messages read naturally. */
export function humanIssue(message: string) {
  return message
    .replace(/needs (.+?) supervision; no capacity available\.?/i, "is in training and has no supervisor on shift.")
    .replace(/not qualified to close independently\.?/i, "is scheduled to close but isn’t qualified to.")
    .replace(/skill profile needs manager review\.?/i, "is scheduled before their skills were verified.")
    .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}): /, (_, d: string, t: string) => `${longDate(d)} at ${t}: `);
}

export function ShiftDialog({
  shift,
  employeeId,
  day = 0,
  onClose,
}: {
  shift?: Shift;
  employeeId?: string;
  day?: number;
  onClose: () => void;
}) {
  const { data, week, mutate, saving, notify, reload } = useApp();
  const [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [finder, setFinder] = useState(false),
    [editing, setEditing] = useState(!shift);
  const [form, setForm] = useState<Shift>(
    () =>
      shift ?? {
        id: crypto.randomUUID(),
        employeeId: employeeId ?? data?.employees[0].id ?? "",
        date: dateAt(week, day),
        start: 600,
        end: 960,
        breakMinutes: 30,
        breakStart: 780,
        kind: "Opening",
      },
  );
  if (!data) return null;
  const employee = data.employees.find((e) => e.id === form.employeeId),
    a = employee ? availabilityOn(employee, form.date) : null;
  const req = shift
    ? (data.requests ?? []).find(
        (r): r is ShiftRequest =>
          (r.kind === "cover" || r.kind === "swap") &&
          statusMeta(r).active &&
          (r.shift.id === shift.id || r.counterShift?.id === shift.id),
      )
    : undefined;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await mutate({ type: "shift", week, shift: form });
      notify(shift ? "Shift updated" : "Shift added");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove() {
    try {
      await mutate({ type: "delete-shift", week, id: form.id });
      notify("Shift removed");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function setTime(key: "start" | "end" | "breakStart", v: string) {
    const [h, m] = v.split(":").map(Number);
    setForm({ ...form, [key]: h * 60 + m });
  }
  if (finder && shift)
    return (
      <ReplacementFinder
        shift={shift}
        week={week}
        ownerName={employee?.name}
        recording={{ requesterId: shift.employeeId }}
        onClose={() => setFinder(false)}
        onDone={(message) => {
          notify(message);
          reload();
          onClose();
        }}
      />
    );
  return (
    <Modal
      title={shift ? "Shift" : "Add a shift"}
      description={shift ? undefined : "Every shift is checked against availability, rest and hour limits when you save."}
      onClose={onClose}
      variant="drawer"
    >
      <form onSubmit={save} className="editor-form">
        {shift && (
          <>
            <ShiftHero shift={shift} />
            {employee && (
              <div className="person-cell">
                <Avatar employee={employee} />
                <div>
                  <strong>{employee.name}</strong>
                  <SkillBadges employee={employee} />
                </div>
              </div>
            )}
            {req && (
              <Callout tone="accent" title="A swap is in progress for this shift">
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <RequestStatusPill request={req} />
                  <Link className="text-link" href="/requests">
                    Review in Swap Centre <ChevronRight size={12} />
                  </Link>
                </span>
              </Callout>
            )}
            <div className="flex-row">
              <button type="button" className="btn" onClick={() => setFinder(true)}>
                <PenLine size={15} /> Record agreed swap
              </button>
              {!editing && (
                <button type="button" className="btn" onClick={() => setEditing(true)}>
                  Edit times
                </button>
              )}
            </div>
            <SkillCoverage shift={form} />
          </>
        )}
        <ErrorBox error={error} />
        {editing && (
          <>
            <label>
              Team member
              <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                {data.employees.map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                Day
                <select value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}>
                  {DAYS.map((d, i) => (
                    <option key={d} value={dateAt(week, i)}>
                      {longDate(dateAt(week, i))}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Shift type
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ShiftKind })}>
                  <option>Opening</option>
                  <option>Midday</option>
                  <option>Closing</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                Starts
                <input type="time" step="1800" required value={time(form.start)} onChange={(e) => setTime("start", e.target.value)} />
              </label>
              <label>
                Ends
                <input type="time" step="1800" required value={time(form.end)} onChange={(e) => setTime("end", e.target.value)} />
              </label>
            </div>
            <div className="form-row">
              <label>
                Unpaid break
                <select
                  value={form.breakMinutes}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      breakMinutes: Number(e.target.value),
                      breakStart: Number(e.target.value) ? (form.breakStart ?? form.start + 180) : null,
                    })
                  }
                >
                  <option value={0}>No break</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </label>
              {form.breakMinutes > 0 && (
                <label>
                  Break starts
                  <input type="time" step="1800" required value={time(form.breakStart ?? form.start)} onChange={(e) => setTime("breakStart", e.target.value)} />
                </label>
              )}
            </div>
            <div className="detail-list">
              <div>
                <span className="k">
                  <Clock3 size={13} style={{ verticalAlign: -2 }} /> Paid hours
                </span>
                <span className="v">{hours(Math.max(0, paidHours(form)))}</span>
              </div>
              <div>
                <span className="k">{employee?.name.split(" ")[0]}’s availability</span>
                <span className="v" style={!a ? { color: "var(--negative)" } : undefined}>
                  {employee?.absentDates.includes(form.date)
                    ? "Approved time off"
                    : a
                      ? `${time(a.start)}–${time(a.end)}`
                      : "Not available"}
                </span>
              </div>
            </div>
            <details className="disclosure">
              <summary>Extra duties for this shift</summary>
              <div className="skill-checklist" style={{ display: "grid", gap: 8 }}>
                {data.restaurant.skillRules.catalog.map((k) => (
                  <label key={k.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={(form.requiredSkillIds ?? []).includes(k.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          requiredSkillIds: e.target.checked
                            ? [...(form.requiredSkillIds ?? []), k.id]
                            : (form.requiredSkillIds ?? []).filter((id) => id !== k.id),
                        })
                      }
                    />
                    {k.name}
                  </label>
                ))}
              </div>
            </details>
            {!shift && <SkillCoverage shift={form} />}
            <p className="form-hint">
              Rules in this workspace: 11 hours’ rest between shifts and a 30-minute break after 5.5 hours. These are
              defaults to confirm against your employment agreements.
            </p>
          </>
        )}
        <div className="modal-actions">
          {shift && (
            <button type="button" className="btn danger" disabled={saving} onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))}>
              <Trash2 size={15} />
              {confirmDelete ? "Confirm remove" : "Remove"}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {editing ? "Cancel" : "Close"}
          </button>
          {editing && (
            <button className="btn primary" disabled={saving} type="submit" aria-busy={saving}>
              <Check size={15} />
              {saving ? "Saving…" : shift ? "Save changes" : "Add shift"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}


