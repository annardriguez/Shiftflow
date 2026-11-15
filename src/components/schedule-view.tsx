"use client";
import { useState } from "react";
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
  ArrowRight,
  Clock3,
} from "lucide-react";
import { useApp } from "./provider";
import {
  Avatar,
  Badge,
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
import type { Shift, ShiftKind, Workspace } from "@/lib/types";
import { SkillBadges, SkillCoverage, CoverDialog } from "./skills";
import { skillDiagnostics } from "@/lib/skills";
import { Planner } from "./planner";
import { exportRoster } from "@/lib/download";
export { exportRoster } from "@/lib/download";
export function Schedule() {
  return (
    <LoadGuard>
      <ScheduleContent />
    </LoadGuard>
  );
}
function ScheduleContent() {
  const { data, week } = useApp(),
    [query, setQuery] = useState(""),
    [role, setRole] = useState("all"),
    [view, setView] = useState<"week" | "list">("week"),
    [dialog, setDialog] = useState<{
      shift?: Shift;
      employeeId?: string;
      day?: number;
    } | null>(null),
    [smart, setSmart] = useState(false);
  if (!data) return null;
  const roster = getWeek(data, week),
    m = metrics(roster, data),
    people = data.employees.filter(
      (e) =>
        e.name.toLowerCase().includes(query.toLowerCase()) &&
        (role === "all" || e.role === role),
    );
  const skillIssues = skillDiagnostics(
    data,
    roster.shifts,
    DAYS.map((_, i) => dateAt(week, i)),
  ).issues;
  return (
    <>
      <PageTitle
        eyebrow="A GOOD WEEK STARTS HERE"
        title="Make room for a great week."
        description="A clear plan for your people. Flexibility for everything else."
      >
        <button className="btn" onClick={() => exportRoster(data, week)}>
          <Download size={16} />
          Export
        </button>
        <button className="btn primary" onClick={() => setDialog({})}>
          <Plus size={16} />
          Add shift
        </button>
      </PageTitle>
      <div className="schedule-topline">
        <div className="flex-row">
          <WeekPicker />
          <Badge tone="sand">
            {roster.provenance
              ? "Saved engine draft"
              : roster.validationPolicy
                ? "Saved workflow draft"
                : "Manual draft"}
          </Badge>
        </div>
        <button className="btn smart-btn" onClick={() => setSmart(true)}>
          <Sparkles size={16} />
          Generate & compare
        </button>
      </div>
      <div className="schedule-summary">
        <span>
          <Clock3 size={17} />
          <strong>{m.hours}h</strong> scheduled
        </span>
        <span>
          <span className="status-dot" />
          {m.coverage}% target coverage
        </span>
        <span>
          <AlertTriangle size={16} />
          {m.gaps.length} intervals below target
        </span>
        <span className="auto-save">
          <Check size={14} /> Draft changes save automatically
        </span>
      </div>
      {skillIssues.length > 0 && (
        <div className="skill-roster-alert" role="status">
          <AlertTriangle size={18} />
          <div>
            <strong>
              {skillIssues.length} mandatory skill / supervision checks need
              attention
            </strong>
            <p>
              {skillIssues[0].message} Open a shift for interval details and
              Find Shift Cover.
            </p>
          </div>
        </div>
      )}
      {smart && <Planner key={week} onClose={() => setSmart(false)} />}
      <section className="panel schedule-panel">
        <div className="schedule-toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              placeholder="Find a team member…"
              aria-label="Find a team member"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter by role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="all">All roles</option>
            <option>Team member</option>
            <option>Shift leader</option>
          </select>
          <div className="view-toggle">
            <button
              className={view === "week" ? "selected" : ""}
              onClick={() => setView("week")}
              aria-pressed={view === "week"}
            >
              <CalendarDays size={15} />
              Week
            </button>
            <button
              className={view === "list" ? "selected" : ""}
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
            >
              <List size={15} />
              List
            </button>
          </div>
        </div>
        {view === "week" ? (
          <div className="roster-scroll">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>
                    <span>YOUR TEAM</span>
                    <small>{people.length} team members</small>
                  </th>
                  {DAYS.map((d, i) => (
                    <th key={d} className={i === 0 ? "highlight-col" : ""}>
                      <span>
                        {d.toUpperCase()}{" "}
                        <b>
                          {new Date(
                            `${dateAt(week, i)}T12:00:00Z`,
                          ).getUTCDate()}
                        </b>
                      </span>
                      <small>
                        <NumberValue value={dayHours(roster, i)} /> /{" "}
                        {roster.budgets[i]} hrs
                      </small>
                    </th>
                  ))}
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
                            <NumberValue value={employeeHours(roster, e.id)} />h
                            / {e.preferredHours}h preferred
                          </small>
                        </div>
                      </div>
                    </td>
                    {DAYS.map((_, day) => {
                      const ss = roster.shifts.filter(
                          (s) =>
                            s.employeeId === e.id &&
                            s.date === dateAt(week, day),
                        ),
                        absent = e.absentDates.includes(dateAt(week, day));
                      return (
                        <td key={day}>
                          {ss.length ? (
                            ss.map((s) => (
                              <button
                                key={s.id}
                                className={`roster-shift ${s.kind.toLowerCase()}`}
                                onClick={() => setDialog({ shift: s })}
                              >
                                <strong>
                                  {time(s.start)} – {time(s.end)}
                                </strong>
                                <span>
                                  {s.kind}
                                  <b>{paidHours(s)}h</b>
                                </span>
                              </button>
                            ))
                          ) : absent ? (
                            <span className="off-label absence">Time off</span>
                          ) : !availabilityOn(e, dateAt(week, day)) ? (
                            <span className="off-label">Unavailable</span>
                          ) : (
                            <button
                              className="add-cell"
                              aria-label={`Add shift for ${e.name} on ${DAYS[day]}`}
                              onClick={() =>
                                setDialog({ employeeId: e.id, day })
                              }
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
          <div className="table-scroll">
            <table className="team-table">
              <thead>
                <tr>
                  <th>TEAM MEMBER</th>
                  <th>DATE</th>
                  <th>SHIFT</th>
                  <th>PAID HOURS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {roster.shifts
                  .filter((s) => people.some((e) => e.id === s.employeeId))
                  .sort(
                    (a, b) => a.date.localeCompare(b.date) || a.start - b.start,
                  )
                  .map((s) => {
                    const e = data.employees.find(
                      (e) => e.id === s.employeeId,
                    )!;
                    return (
                      <tr key={s.id}>
                        <td>
                          <div className="person-cell">
                            <Avatar employee={e} small />
                            {e.name}
                          </div>
                        </td>
                        <td>{s.date}</td>
                        <td>
                          {time(s.start)}–{time(s.end)} <Badge>{s.kind}</Badge>
                        </td>
                        <td>{paidHours(s)}h</td>
                        <td>
                          <button
                            className="text-link"
                            onClick={() => setDialog({ shift: s })}
                          >
                            Edit <ArrowRight size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        {people.length === 0 && (
          <div className="empty-state">
            <Search size={25} />
            <h3>No team members found</h3>
            <p>Try a different name or role.</p>
          </div>
        )}
        <div className="panel-foot">
          <div className="shift-legend">
            <span>
              <i className="shift-dot opening" />
              Opening
            </span>
            <span>
              <i className="shift-dot midday" />
              Midday
            </span>
            <span>
              <i className="shift-dot closing" />
              Closing
            </span>
          </div>
          <span>Amsterdam time · Unpaid breaks excluded</span>
        </div>
      </section>
      <div className="info-box schedule-info">
        <ShieldInfo />
        Every edit is checked against confirmed availability, approved absences,
        break rules, rest periods, and individual hour limits.
      </div>
      {dialog && (
        <ShiftDialog {...dialog} onClose={() => setDialog(null)} />
      )}{" "}
    </>
  );
}
function ShieldInfo() {
  return <Check size={17} />;
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
  const { data, week, mutate, saving } = useApp();
  const [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [cover, setCover] = useState(false);
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
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await mutate({ type: "shift", week, shift: form });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove() {
    try {
      await mutate({ type: "delete-shift", week, id: form.id });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function setTime(key: "start" | "end" | "breakStart", v: string) {
    const [h, m] = v.split(":").map(Number);
    setForm({ ...form, [key]: h * 60 + m });
  }
  if (cover && shift)
    return <CoverDialog shift={shift} onClose={() => setCover(false)} />;
  return (
    <Modal
      title={shift ? "A little adjustment" : "Add a shift"}
      description="Build your draft, one good shift at a time."
      onClose={onClose}
    >
      <form onSubmit={save} className="editor-form">
        <ErrorBox error={error} />
        <label>
          Team member
          <select
            value={form.employeeId}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
          >
            {data.employees.map((e) => (
              <option value={e.id} key={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Date
            <select
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            >
              {DAYS.map((d, i) => (
                <option key={d} value={dateAt(week, i)}>
                  {d}, {dateAt(week, i)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Shift type
            <select
              value={form.kind}
              onChange={(e) =>
                setForm({ ...form, kind: e.target.value as ShiftKind })
              }
            >
              <option>Opening</option>
              <option>Midday</option>
              <option>Closing</option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Start time
            <input
              type="time"
              step="1800"
              required
              value={time(form.start)}
              onChange={(e) => setTime("start", e.target.value)}
            />
          </label>
          <label>
            End time
            <input
              type="time"
              step="1800"
              required
              value={time(form.end)}
              onChange={(e) => setTime("end", e.target.value)}
            />
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
                  breakStart: Number(e.target.value)
                    ? (form.breakStart ?? form.start + 180)
                    : null,
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
              <input
                type="time"
                step="1800"
                required
                value={time(form.breakStart ?? form.start)}
                onChange={(e) => setTime("breakStart", e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="shift-preview">
          <div>
            <Clock3 size={17} />
            <strong>{Math.max(0, paidHours(form))} paid hours</strong>
          </div>
          <p>
            {a
              ? `Confirmed availability: ${time(a.start)}–${time(a.end)}`
              : "Not available on this day"}
            {employee?.absentDates.includes(form.date)
              ? " · Approved absence"
              : ""}
          </p>
        </div>
        <fieldset className="skill-checklist">
          <legend>Additional personal duties for this shift</legend>
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
                      : (form.requiredSkillIds ?? []).filter(
                          (id) => id !== k.id,
                        ),
                  })
                }
              />
              {k.name}
            </label>
          ))}
        </fieldset>
        <SkillCoverage shift={form} />
        {shift && (
          <button
            type="button"
            className="btn full-width"
            onClick={() => setCover(true)}
          >
            Find Shift Cover <ArrowRight size={15} />
          </button>
        )}
        {shift && (
          <p className="form-hint">
            Cover preview uses the last saved shift. Save your edits first to
            assess a changed shift.
          </p>
        )}
        <p className="form-hint">
          Demo rules: 11h minimum rest; 30-minute break after 5.5h. These are
          configurable prototype defaults requiring employment-law review.
        </p>
        <div className="modal-actions">
          {shift && (
            <button
              type="button"
              className="btn danger"
              disabled={saving}
              onClick={() =>
                confirmDelete ? remove() : setConfirmDelete(true)
              }
            >
              <Trash2 size={15} />
              {confirmDelete ? "Confirm removal" : "Remove"}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving} type="submit">
            {saving ? "Saving…" : "Save shift"}
            <Check size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
