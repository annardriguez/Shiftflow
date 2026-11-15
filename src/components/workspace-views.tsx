"use client";
import { useState } from "react";
import {
  Plus,
  Search,
  Check,
  CalendarDays,
  Save,
  RotateCcw,
  KeyRound,
  ShieldCheck,
  HelpCircle,
  Pencil,
  Unplug,
  FlaskConical,
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
  coverage,
  dateAt,
  dayHours,
  DAYS,
  employeeHours,
  getWeek,
  metrics,
  time,
} from "@/lib/schedule";
import { qualified } from "@/lib/skills";
import { dayOfMonth, hours, plural, relativeTime, shortDate } from "@/lib/format";
import type { Employee, Scenario, Window } from "@/lib/types";
import { SkillBadges, SkillProfileDialog, SkillRulesPanel } from "./skills";
import { LabourChart } from "./dashboard";

/* =====================================================================
   Team
   ===================================================================== */

export function Team() {
  return (
    <LoadGuard>
      <TeamContent />
    </LoadGuard>
  );
}

function Cap({ e, skill, label }: { e: Employee; skill: string; label: string }) {
  if (!e.skillsReviewedAt)
    return (
      <span className="cap unknown" title={`${label}: unknown, skills not verified`}>
        ?
      </span>
    );
  const yes = qualified(e, skill);
  return (
    <span
      className={`cap ${yes ? "yes" : ""} ${skill === "close" ? "close" : ""}`}
      title={`${label}: ${yes ? "verified" : "no"}`}
      aria-label={`${label}: ${yes ? "yes" : "no"}`}
    >
      {yes ? (skill === "close" ? <KeyRound size={12} /> : <Check size={12} strokeWidth={3} />) : "–"}
    </span>
  );
}

function TeamContent() {
  const { data, week } = useApp(),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState<"all" | "close" | "open" | "train" | "unverified">("all"),
    [editor, setEditor] = useState<Employee | "new" | null>(null),
    [skillEditor, setSkillEditor] = useState<Employee | null>(null);
  if (!data) return null;
  const roster = getWeek(data, week);
  const people = data.employees.filter(
    (e) =>
      (e.name + " " + e.role).toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "unverified" ? !e.skillsReviewedAt : qualified(e, filter))),
  );
  const closers = data.employees.filter((e) => qualified(e, "close")).length,
    openers = data.employees.filter((e) => qualified(e, "open")).length,
    supervisors = data.employees.filter((e) => qualified(e, "train") && !e.supervisionSkillId).length,
    trainees = data.employees.filter((e) => e.supervisionSkillId).length,
    unverified = data.employees.filter((e) => !e.skillsReviewedAt).length;
  return (
    <>
      <PageTitle title="Team" description="Who can do what. Verified skills decide who can open, close and cover each shift.">
        <button className="btn primary" onClick={() => setEditor("new")}>
          <Plus size={15} /> Add team member
        </button>
      </PageTitle>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">
            <KeyRound size={13} /> Can close
          </span>
          <span className="stat-value">
            {closers}
            <small>of {data.employees.length}</small>
          </span>
          <span className="stat-note">Needed on every closing shift</span>
        </div>
        <div className="stat">
          <span className="stat-label">Can open</span>
          <span className="stat-value">{openers}</span>
          <span className="stat-note">Needed for the first hour</span>
        </div>
        <div className="stat">
          <span className="stat-label">Supervisors / in training</span>
          <span className="stat-value">
            {supervisors}
            <small>/ {trainees}</small>
          </span>
          <span className="stat-note">Up to {data.restaurant.skillRules.supervisionCapacity} trainees each</span>
        </div>
        <div className="stat">
          <span className="stat-label">Skills unverified</span>
          <span className="stat-value">{unverified}</span>
          <span className={`stat-note ${unverified ? "caution" : "positive"}`}>
            {unverified ? "Can’t be suggested for swaps" : "Everyone verified"}
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="filter-bar">
          <div className="segmented" role="tablist" aria-label="Filter by skill">
            {(
              [
                ["all", "Everyone"],
                ["close", "Can close"],
                ["open", "Can open"],
                ["train", "Supervisors"],
                ["unverified", "Unverified"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="search-field" style={{ width: 240 }}>
            <Search size={15} />
            <input aria-label="Search team" placeholder="Search team" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="table-scroll">
          <table className="team-table directory">
            <thead>
              <tr>
                <th>Person</th>
                <th>
                  <div className="capability-grid" style={{ textTransform: "none", letterSpacing: 0 }}>
                    <span>Opens</span>
                    <span>Closes</span>
                    <span>Supervises</span>
                    <span>Service</span>
                  </div>
                </th>
                <th>Shift types</th>
                <th>This week</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((e) => {
                const h = employeeHours(roster, e.id);
                return (
                  <tr key={e.id}>
                    <td>
                      <div className="person-cell">
                        <Avatar employee={e} />
                        <div>
                          <strong>{e.name}</strong>
                          <small>
                            {e.role}
                            {e.supervisionSkillId ? " · In training" : ""}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="capability-grid">
                        <Cap e={e} skill="open" label="Opens" />
                        <Cap e={e} skill="close" label="Closes" />
                        {e.supervisionSkillId ? (
                          <span className="cap trainee" title="In training: works with a supervisor">
                            Trainee
                          </span>
                        ) : (
                          <Cap e={e} skill="train" label="Supervises" />
                        )}
                        <Cap e={e} skill="service" label="Service" />
                      </div>
                    </td>
                    <td>
                      <span className="table-sub" style={{ color: "var(--ink-2)" }}>
                        {e.eligible.join(", ")}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 4 }}>
                        <span className="tabular" style={{ fontSize: 13 }}>
                          <NumberValue value={h} />h <span className="muted">of {e.preferredHours}h preferred · max {e.maxHours}h</span>
                        </span>
                        <span className="hours-track">
                          <i style={{ width: `${Math.min(100, (h / Math.max(e.preferredHours, 1)) * 100)}%`, background: h > e.preferredHours ? "#e2a33a" : undefined }} />
                        </span>
                      </div>
                    </td>
                    <td>
                      <button className="btn small" onClick={() => setSkillEditor(e)} aria-label={`Verify skills for ${e.name}`}>
                        <ShieldCheck size={13} /> Skills
                      </button>{" "}
                      <button className="icon-btn" onClick={() => setEditor(e)} aria-label={`Edit ${e.name}`}>
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!people.length && (
            <EmptyState icon={<Search size={20} />} title="No one matches">
              Try another name or filter.
            </EmptyState>
          )}
        </div>
        <div className="panel-foot">
          <span style={{ display: "inline-flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span className="cap yes" style={{ width: 22, display: "inline-grid" }}>
              <Check size={11} strokeWidth={3} />
            </span>
            Verified
            <span className="cap" style={{ width: 22, display: "inline-grid" }}>–</span>
            Not qualified
            <span className="cap unknown" style={{ width: 22, display: "inline-grid" }}>?</span>
            Unknown until verified
          </span>
          <span>Preferred hours are a preference; maximum hours are a hard limit.</span>
        </div>
      </section>
      {skillEditor && <SkillProfileDialog employee={skillEditor} onClose={() => setSkillEditor(null)} />}
      {editor && <EmployeeDialog employee={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} />}
    </>
  );
}

function EmployeeDialog({ employee, onClose }: { employee?: Employee; onClose: () => void }) {
  const { mutate, saving, notify } = useApp(),
    [error, setError] = useState(""),
    [form, setForm] = useState<Employee>(
      () =>
        employee ?? {
          id: crypto.randomUUID(),
          name: "",
          email: "",
          role: "Team member",
          color: "sage",
          preferredHours: 20,
          maxHours: 32,
          competencies: [],
          supervisionSkillId: null,
          skillsReviewedAt: null,
          minRestHours: 11,
          maxShiftHours: 9,
          eligible: ["Opening", "Midday", "Closing"],
          availability: Array.from({ length: 7 }, () => ({ start: 600, end: 1380 })),
          absentDates: [],
        },
    );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutate({ type: "employee", employee: form });
      notify(employee ? "Profile updated" : `${form.name} added to the team`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={employee ? `Edit ${employee.name}` : "Add team member"}
      description="Profile details only. Sign-in accounts are created separately by an administrator."
      onClose={onClose}
      variant="drawer"
    >
      <form className="editor-form" onSubmit={save}>
        <ErrorBox error={error} />
        <label>
          Full name
          <input required minLength={2} maxLength={80} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Email
          <input type="email" required value={form.email} placeholder="name@example.test" onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <div className="form-row">
          <label>
            Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Employee["role"] })}>
              <option>Team member</option>
              <option>Shift leader</option>
            </select>
          </label>
          <label>
            Avatar colour
            <select value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}>
              {["sage", "blue", "peach", "lilac", "rose", "sand"].map((c) => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Preferred hours / week
            <input type="number" min={0} max={60} step={0.5} value={form.preferredHours} required onChange={(e) => setForm({ ...form, preferredHours: Number(e.target.value) })} />
          </label>
          <label>
            Maximum hours / week
            <input type="number" min={0} max={60} step={0.5} required value={form.maxHours} onChange={(e) => setForm({ ...form, maxHours: Number(e.target.value) })} />
          </label>
        </div>
        <fieldset>
          <legend>Can work these shift types</legend>
          <div className="flex-row">
            {(["Opening", "Midday", "Closing"] as const).map((k) => (
              <label className="checkbox-label" key={k}>
                <input
                  type="checkbox"
                  checked={form.eligible.includes(k)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      eligible: e.target.checked ? [...form.eligible, k] : form.eligible.filter((x) => x !== k),
                    })
                  }
                />
                {k}
              </label>
            ))}
          </div>
          <span className="form-hint">Skills like closing are verified separately under Skills.</span>
        </fieldset>
        {employee && form.absentDates.length > 0 && (
          <Callout tone="neutral" title="Approved time off">
            {form.absentDates.map(shortDate).join(", ")}
          </Callout>
        )}
        <p className="form-hint">
          New people start as available 10:00–23:00 every day with unverified skills. Update their availability and
          verify skills before scheduling them.
        </p>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            <Check size={15} /> {saving ? "Saving…" : employee ? "Save changes" : "Add to team"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* =====================================================================
   Availability
   ===================================================================== */

export function Availability() {
  return (
    <LoadGuard>
      <AvailabilityContent />
    </LoadGuard>
  );
}
function AvailabilityContent() {
  const { data, week } = useApp(),
    [editor, setEditor] = useState<Employee | null>(null),
    [query, setQuery] = useState("");
  if (!data) return null;
  const pending = (data.requests ?? []).filter(
    (r) => (r.kind === "availability" || r.kind === "time-off") && (r.status === "pending-manager"),
  ).length;
  const windowFor = (e: Employee, d: number) => {
    const date = dateAt(week, d);
    const o = e.availabilityOverrides?.find((x) => x.date === date);
    return o ? { w: o.window, override: true } : { w: e.availability[d], override: false };
  };
  return (
    <>
      <PageTitle title="Availability" description="When each person can work. Shifts and swaps are always checked against this.">
        <WeekPicker />
      </PageTitle>
      {pending > 0 && (
        <Callout tone="caution" title={`${plural(pending, "availability or time-off request")} waiting for you`}>
          Review them in the <a className="text-link" href="/requests">Swap Centre</a>.
        </Callout>
      )}
      <section className="panel">
        <div className="filter-bar">
          <div className="flex-row" style={{ fontSize: 12.5, color: "var(--muted)", gap: 14 }}>
            <span className="flex-row" style={{ gap: 6 }}>
              <span className="availability-block" style={{ width: 22, height: 14 }} /> Available
            </span>
            <span className="flex-row" style={{ gap: 6 }}>
              <span className="availability-block absence" style={{ width: 22, height: 14 }} /> Time off
            </span>
            <span className="flex-row" style={{ gap: 6 }}>
              <span className="availability-block unavailable" style={{ width: 22, height: 14 }} /> Unavailable
            </span>
          </div>
          <div className="search-field" style={{ width: 240 }}>
            <Search size={15} />
            <input placeholder="Search team" aria-label="Search availability" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="table-scroll">
          <table className="team-table availability-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Person</th>
                {DAYS.map((d, i) => (
                  <th key={d}>
                    {d} {dayOfMonth(dateAt(week, i))}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.employees
                .filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
                .map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="person-cell">
                        <Avatar employee={e} small />
                        <strong>{e.name}</strong>
                      </div>
                    </td>
                    {DAYS.map((_, d) => {
                      const { w, override } = windowFor(e, d);
                      return (
                        <td key={d}>
                          {e.absentDates.includes(dateAt(week, d)) ? (
                            <span className="availability-block absence">Time off</span>
                          ) : (
                            <button
                              className={`availability-block ${w ? "" : "unavailable"}`}
                              style={{ width: "100%" }}
                              aria-label={`Edit ${e.name}'s ${DAYS[d]} availability`}
                              onClick={() => setEditor(e)}
                              title={override ? "One-off change for this date" : undefined}
                            >
                              {w ? `${time(w.start)}–${time(w.end)}` : "—"}
                              {override && " *"}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td>
                      <button className="icon-btn" onClick={() => setEditor(e)} aria-label={`Edit availability for ${e.name}`}>
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          <span>* One-off change for that date. Approved time off always takes priority.</span>
          <span>Changes that clash with existing shifts are blocked until those shifts are moved.</span>
        </div>
      </section>
      {editor && <AvailabilityDialog employee={editor} onClose={() => setEditor(null)} />}
    </>
  );
}

function AvailabilityDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { mutate, saving, notify } = useApp(),
    [windows, setWindows] = useState<(Window | null)[]>(structuredClone(employee.availability)),
    [error, setError] = useState("");
  function update(i: number, key: "start" | "end", value: string) {
    const [h, m] = value.split(":").map(Number);
    setWindows((w) => w.map((v, d) => (d === i ? { ...(v ?? { start: 600, end: 1380 }), [key]: h * 60 + m } : v)));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutate({ type: "availability", employeeId: employee.id, availability: windows });
      notify(`Availability updated for ${employee.name.split(" ")[0]}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title={`${employee.name}’s availability`} description="Repeats every week. Times in half-hour steps." onClose={onClose} variant="drawer">
      <form className="editor-form" onSubmit={save}>
        <ErrorBox error={error} />
        <div className="availability-editor">
          {DAYS.map((d, i) => (
            <div key={d}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={windows[i] !== null}
                  onChange={(e) =>
                    setWindows((w) => w.map((a, k) => (k === i ? (e.target.checked ? { start: 600, end: 1380 } : null) : a)))
                  }
                />
                <strong>{d}</strong>
              </label>
              {windows[i] ? (
                <>
                  <input aria-label={`${d} from`} type="time" step="1800" required value={time(windows[i]!.start)} onChange={(e) => update(i, "start", e.target.value)} />
                  <input aria-label={`${d} until`} type="time" step="1800" required value={time(windows[i]!.end)} onChange={(e) => update(i, "end", e.target.value)} />
                </>
              ) : (
                <span className="muted" style={{ gridColumn: "span 2" }}>
                  Not available
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="form-hint">Existing shifts must still fit inside the new availability.</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            <Check size={15} /> {saving ? "Saving…" : "Save availability"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* =====================================================================
   Labour & coverage
   ===================================================================== */

export function Labour() {
  return (
    <LoadGuard>
      <LabourContent />
    </LoadGuard>
  );
}
function LabourContent() {
  const { data, week } = useApp(),
    [editing, setEditing] = useState(false);
  if (!data) return null;
  const roster = getWeek(data, week),
    m = metrics(roster, data),
    intervals = coverage(roster, data.scenario),
    diff = m.hours - m.budget;
  return (
    <>
      <PageTitle title="Labour & coverage" description="Scheduled hours against your targets, and where the team is stretched thin.">
        <WeekPicker />
        <button className="btn" onClick={() => setEditing(true)}>
          Edit daily targets
        </button>
      </PageTitle>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Scheduled paid hours</span>
          <span className="stat-value">
            <NumberValue value={m.hours} />h
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Labour target</span>
          <span className="stat-value">{m.budget}h</span>
        </div>
        <div className="stat">
          <span className="stat-label">Difference</span>
          <span className="stat-value" style={{ color: diff > 0 ? "var(--caution)" : undefined }}>
            {diff > 0 ? "+" : ""}
            {diff.toFixed(1)}h
          </span>
          <span className="stat-note">Targets guide planning; they’re not hard limits</span>
        </div>
        <div className="stat">
          <span className="stat-label">Staffing coverage</span>
          <span className="stat-value">
            {m.coverage}
            <small>%</small>
          </span>
          <span className={`stat-note ${m.gaps.length ? "caution" : "positive"}`}>{plural(m.gaps.length, "half-hour")} short</span>
        </div>
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Hours per day</h2>
              <p>Scheduled paid hours against each day’s target.</p>
            </div>
          </div>
          <LabourChart week={roster} />
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Hours per person</h2>
              <p>Against each person’s preferred hours.</p>
            </div>
          </div>
          <div style={{ maxHeight: 290, overflow: "auto" }}>
            {data.employees.map((e) => {
              const h = employeeHours(roster, e.id);
              return (
                <div key={e.id} className="avail-day" style={{ gridTemplateColumns: "minmax(0,1fr) 120px 64px" }}>
                  <div className="person-cell">
                    <Avatar employee={e} size="xs" />
                    <strong style={{ fontSize: 13 }}>{e.name}</strong>
                  </div>
                  <span className="hours-track">
                    <i style={{ width: `${Math.min(100, (h / Math.max(e.preferredHours, 1)) * 100)}%`, background: h > e.preferredHours ? "#e2a33a" : undefined }} />
                  </span>
                  <span className="tabular" style={{ textAlign: "right", color: "var(--muted)", fontSize: 12.5 }}>
                    {h}/{e.preferredHours}h
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <section className="panel coverage-panel">
        <div className="panel-heading">
          <div>
            <h2>Staffing by half-hour</h2>
            <p>People on duty against the staffing target. Breaks are excluded.</p>
          </div>
          <Badge tone={m.gaps.length ? "caution" : "positive"}>{plural(m.gaps.length, "half-hour")} short</Badge>
        </div>
        <div className="coverage-scroll">
          <div className="coverage-grid">
            <div className="coverage-row">
              <span />
              {Array.from({ length: 26 }, (_, i) => (
                <span key={i} className="coverage-time" style={{ background: "none", boxShadow: "none", height: "auto" }}>
                  {i % 4 === 0 ? time(600 + i * 30) : ""}
                </span>
              ))}
            </div>
            {DAYS.map((d, i) => (
              <div className="coverage-row" key={d}>
                <span className="coverage-time" style={{ background: "none", boxShadow: "none", height: "auto", fontWeight: 600 }}>
                  {d}
                </span>
                {intervals
                  .filter((x) => x.day === i)
                  .map((x) => (
                    <span
                      key={x.minute}
                      className={x.shortage ? "gap" : "covered"}
                      title={`${d} ${time(x.minute)}: ${x.actual} on duty, target ${x.target}`}
                      aria-label={`${d} ${time(x.minute)}: ${x.actual} on duty of ${x.target}`}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>
        <div className="panel-foot">
          <span className="flex-row" style={{ gap: 12 }}>
            <span className="flex-row" style={{ gap: 6 }}>
              <span className="legend-swatch" style={{ background: "#fde8c8" }} /> Below target
            </span>
            <span className="flex-row" style={{ gap: 6 }}>
              <span className="legend-swatch" style={{ background: "var(--positive-soft)", boxShadow: "inset 0 0 0 1px var(--positive-line)" }} /> On target
            </span>
          </span>
          <span>Staffing targets come from the demo demand profile for this workspace.</span>
        </div>
      </section>
      {editing && <BudgetDialog onClose={() => setEditing(false)} />}
    </>
  );
}

function BudgetDialog({ onClose }: { onClose: () => void }) {
  const { data, week, mutate, saving, notify } = useApp(),
    [budgets, setBudgets] = useState(() => [...getWeek(data!, week).budgets]),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutate({ type: "budgets", week, budgets });
      notify("Labour targets saved");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title="Daily labour targets" description="Paid hours you’d like to stay around each day. Rosters can go over." onClose={onClose}>
      <form className="editor-form" onSubmit={save}>
        <ErrorBox error={error} />
        <div className="budget-editor">
          {DAYS.map((d, i) => (
            <label key={d} className="field">
              <span>
                {d} {dayOfMonth(dateAt(week, i))}
              </span>
              <input
                type="number"
                min={0}
                max={300}
                step={0.5}
                required
                aria-label={`${d} target hours`}
                value={budgets[i]}
                onChange={(e) => setBudgets((b) => b.map((v, j) => (j === i ? Number(e.target.value) : v)))}
              />
            </label>
          ))}
        </div>
        <div className="detail-list">
          <div>
            <span className="k">Week total</span>
            <span className="v">{budgets.reduce((a, b) => a + b, 0)}h</span>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            <Save size={15} /> {saving ? "Saving…" : "Save targets"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export { ManagerRequests as Requests } from "./workforce-ui";

/* =====================================================================
   Settings
   ===================================================================== */

export function Settings() {
  return (
    <LoadGuard>
      <SettingsContent />
    </LoadGuard>
  );
}
function SettingsContent() {
  const { data, mutate, saving, notify } = useApp(),
    [scenario, setScenario] = useState<Scenario | null>(null),
    [error, setError] = useState("");
  if (!data) return null;
  async function reset() {
    if (!scenario) return;
    try {
      await mutate({ type: "scenario", scenario });
      notify("Demo data reloaded");
      setScenario(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <PageTitle title="Settings" description="Restaurant details, staffing rules and working-time defaults." />
      <SkillRulesPanel />
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Restaurant</h2>
            </div>
          </div>
          <dl className="details-list">
            <div>
              <dt>Name</dt>
              <dd>{data.restaurant.name}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{data.restaurant.location}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{data.restaurant.timezone}</dd>
            </div>
            <div>
              <dt>Opening hours (incl. prep)</dt>
              <dd>
                {time(data.restaurant.open)}–{time(data.restaurant.close)}
              </dd>
            </div>
            <div>
              <dt>Sign-in</dt>
              <dd>Password · per-restaurant roles</dd>
            </div>
            <div>
              <dt>Notifications</dt>
              <dd>In-app only</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Working-time rules</h2>
              <p>Enforced on every shift, swap and generated roster.</p>
            </div>
          </div>
          <dl className="details-list">
            <div>
              <dt>Time steps</dt>
              <dd>30 minutes</dd>
            </div>
            <div>
              <dt>Rest between shifts</dt>
              <dd>At least 11 hours</dd>
            </div>
            <div>
              <dt>Longest shift</dt>
              <dd>9 hours</dd>
            </div>
            <div>
              <dt>Break on shifts over 5.5 hours</dt>
              <dd>30 minutes, unpaid</dd>
            </div>
            <div>
              <dt>Weekly hours</dt>
              <dd>Per person (zero-hour contracts)</dd>
            </div>
          </dl>
          <div className="panel-foot">
            Defaults for adult staff. Confirm them against your collective agreement before relying on them.
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Integrations</h2>
          </div>
        </div>
        <div className="panel-body">
          <Callout tone="caution" icon={<Unplug size={16} />} title="No external scheduling system connected">
            Approved swaps update the ShiftFlow roster only. If your restaurant also uses another scheduling or payroll
            system, update it manually, or export the roster as CSV from the Schedule.
          </Callout>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              <FlaskConical size={15} /> Demo data
            </h2>
            <p>This workspace runs on a fictional team. Load a different week to explore.</p>
          </div>
        </div>
        <div className="scenario-grid">
          {(
            [
              { id: "normal", name: "Regular week", desc: "Varied availability, lunch peaks and a few days off." },
              { id: "high-demand", name: "Busy week", desc: "Higher staffing and labour targets." },
              { id: "shortage", name: "Short-staffed week", desc: "Very limited Friday and Saturday availability." },
            ] as const
          ).map((s) => (
            <div className={`scenario-card ${data.scenario === s.id ? "selected" : ""}`} key={s.id}>
              <div className="flex-row" style={{ justifyContent: "space-between" }}>
                <h3>{s.name}</h3>
                {data.scenario === s.id && <Badge tone="accent">Loaded</Badge>}
              </div>
              <p>{s.desc}</p>
              <div>
                <button
                  className="btn small"
                  onClick={() => {
                    setScenario(s.id);
                    setError("");
                  }}
                >
                  <RotateCcw size={13} /> {data.scenario === s.id ? "Reset" : "Load"}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="panel-foot">
          <span>Workspace version {data.revision}</span>
          <span>{data.audit[0] ? `Last change ${relativeTime(data.audit[0].at)}` : ""}</span>
        </div>
      </section>
      {scenario && (
        <Modal title="Replace all workspace data?" description="This resets the roster, team, availability and targets for every week." onClose={() => setScenario(null)}>
          <div className="modal-body" style={{ padding: 0, display: "grid", gap: 14 }}>
            <ErrorBox error={error} />
            <Callout tone="caution">
              Your edits will be replaced by the demo data set. Export any roster you want to keep first. Request history
              is kept; open requests expire.
            </Callout>
            <div className="modal-actions">
              <button className="btn" onClick={() => setScenario(null)}>
                Keep my changes
              </button>
              <button className="btn danger" disabled={saving} onClick={reset}>
                {saving ? "Loading…" : "Replace data"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}


