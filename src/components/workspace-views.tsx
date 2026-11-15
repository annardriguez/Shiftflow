"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  ArrowUpRight,
  ArrowRight,
  Check,
  Users,
  Clock3,
  CalendarDays,
  ArrowLeftRight,
  Save,
  AlertTriangle,
  Sprout,
  FlaskConical,
  RotateCcw,
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
  coverage,
  dateAt,
  dayHours,
  DAYS,
  employeeHours,
  getWeek,
  metrics,
  time,
} from "@/lib/schedule";
import type { Employee, Scenario, Window } from "@/lib/types";
import { SkillBadges, SkillProfileDialog, SkillRulesPanel } from "./skills";
import { LabourChart } from "./dashboard";

export function Team() {
  return (
    <LoadGuard>
      <TeamContent />
    </LoadGuard>
  );
}
function TeamContent() {
  const { data, week } = useApp(),
    [query, setQuery] = useState(""),
    [editor, setEditor] = useState<Employee | "new" | null>(null),
    [skillEditor, setSkillEditor] = useState<Employee | null>(null);
  if (!data) return null;
  const roster = getWeek(data, week),
    people = data.employees.filter((e) =>
      (e.name + " " + e.role).toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <>
      <PageTitle
        eyebrow="THE PEOPLE WHO MAKE IT HAPPEN"
        title="Great teams. Great things."
        description="A little understanding goes a long way. Get to know your team’s rhythm."
      >
        <button className="btn primary" onClick={() => setEditor("new")}>
          <Plus size={16} />
          Add team member
        </button>
      </PageTitle>
      <div className="section-strip">
        <span>
          <Users size={17} />
          <strong>{data.employees.length}</strong> team members
        </span>
        <Badge>Fictional workforce</Badge>
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search team"
            placeholder="Search the team…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table className="team-table directory">
            <thead>
              <tr>
                <th>TEAM MEMBER</th>
                <th>ROLE & ELIGIBILITY</th>
                <th>PREFERRED / MAX HOURS</th>
                <th>THIS WEEK</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className="person-cell">
                      <Avatar employee={e} />
                      <div>
                        <strong>{e.name}</strong>
                        <small>{e.email}</small>
                        <SkillBadges employee={e} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <strong className="table-normal">{e.role}</strong>
                    <small className="table-sub">
                      {e.eligible.join(" · ")}
                    </small>
                  </td>
                  <td>
                    {e.preferredHours}h{" "}
                    <span className="muted">/ {e.maxHours}h maximum</span>
                  </td>
                  <td>
                    <Badge
                      tone={
                        employeeHours(roster, e.id) >= e.preferredHours
                          ? "sage"
                          : "sand"
                      }
                    >
                      {employeeHours(roster, e.id)}h assigned
                    </Badge>
                  </td>
                  <td>
                    <button
                      className="btn small"
                      onClick={() => setSkillEditor(e)}
                      aria-label={`Review skills for ${e.name}`}
                    >
                      Skills
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => setEditor(e)}
                      aria-label={`Edit ${e.name}`}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!people.length && (
            <div className="empty-state">
              <Search size={25} />
              <h3>No matching team members</h3>
              <p>Try another name or role.</p>
            </div>
          )}
        </div>
      </section>
      <div className="info-box">
        <FlaskConical size={18} />
        All 15 initial employees are fictional. Preferred hours are a
        preference; maximum hours are a hard limit.
      </div>
      {skillEditor && (
        <SkillProfileDialog
          employee={skillEditor}
          onClose={() => setSkillEditor(null)}
        />
      )}
      {editor && (
        <EmployeeDialog
          employee={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
function EmployeeDialog({
  employee,
  onClose,
}: {
  employee?: Employee;
  onClose: () => void;
}) {
  const { mutate, saving } = useApp(),
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
          availability: Array.from({ length: 7 }, () => ({
            start: 600,
            end: 1380,
          })),
          absentDates: [],
        },
    );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutate({ type: "employee", employee: form });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={employee ? "People, with preferences" : "A new face on the team"}
      description="Fictional employment profiles only. Sign-in access is provisioned separately by the local administrator; contact details and shift-leader roles do not change account permissions."
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={save}>
        <ErrorBox error={error} />
        <label>
          Full name
          <input
            required
            minLength={2}
            maxLength={80}
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Email address
          <input
            type="email"
            required
            value={form.email}
            placeholder="name@example.test"
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            Role
            <select
              value={form.role}
              onChange={(e) =>
                setForm({ ...form, role: e.target.value as Employee["role"] })
              }
            >
              <option>Team member</option>
              <option>Shift leader</option>
            </select>
          </label>
          <label>
            Profile colour
            <select
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            >
              {["sage", "blue", "peach", "lilac", "rose", "sand"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Preferred weekly hours
            <input
              type="number"
              min={0}
              max={60}
              step={0.5}
              value={form.preferredHours}
              required
              onChange={(e) =>
                setForm({ ...form, preferredHours: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Maximum weekly hours
            <input
              type="number"
              min={0}
              max={60}
              step={0.5}
              required
              value={form.maxHours}
              onChange={(e) =>
                setForm({ ...form, maxHours: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <fieldset>
          <legend>Eligible shift types</legend>
          <div className="checkbox-row">
            {(["Opening", "Midday", "Closing"] as const).map((k) => (
              <label className="checkbox-label" key={k}>
                <input
                  type="checkbox"
                  checked={form.eligible.includes(k)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      eligible: e.target.checked
                        ? [...form.eligible, k]
                        : form.eligible.filter((x) => x !== k),
                    })
                  }
                />
                {k}
              </label>
            ))}
          </div>
        </fieldset>
        {employee && form.absentDates.length > 0 && (
          <div className="info-box">
            Approved fictional absences: {form.absentDates.join(", ")}. Absence
            requests are part of a future milestone.
          </div>
        )}
        <p className="form-hint">
          11h minimum rest · 9h maximum shift. New profiles start available
          10:00–23:00 daily; update availability before scheduling.
        </p>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            {saving ? "Saving…" : "Save team member"}
            <Check size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

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
  return (
    <>
      <PageTitle
        eyebrow="EVERYONE HAS THEIR OWN RHYTHM"
        title="Find the time that fits."
        description="Confirmed recurring availability, with room for life outside work."
      >
        <WeekPicker />
      </PageTitle>
      <div className="section-strip">
        <div className="flex-row">
          <span>
            <span className="status-dot" />
            Confirmed availability
          </span>
          <span>
            <span className="status-dot absence-dot" />
            Approved absence
          </span>
        </div>
        <div className="search-field">
          <Search size={16} />
          <input
            placeholder="Find a team member…"
            aria-label="Search availability"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <section className="panel">
        <div className="roster-scroll">
          <table className="availability-table">
            <thead>
              <tr>
                <th>TEAM MEMBER</th>
                {DAYS.map((d, i) => (
                  <th key={d}>
                    {d.toUpperCase()} <span>{dateAt(week, i).slice(-2)}</span>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.employees
                .filter((e) =>
                  e.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="person-cell">
                        <Avatar employee={e} small />
                        <strong>{e.name}</strong>
                      </div>
                    </td>
                    {e.availability.map((a, d) => (
                      <td key={d}>
                        {e.absentDates.includes(dateAt(week, d)) ? (
                          <span className="availability-block absence">
                            Approved time off
                          </span>
                        ) : a ? (
                          <button
                            className="availability-block"
                            aria-label={`Edit ${e.name}'s ${DAYS[d]} availability`}
                            onClick={() => setEditor(e)}
                          >
                            {time(a.start)} – {time(a.end)}
                          </button>
                        ) : (
                          <button
                            className="availability-block unavailable"
                            aria-label={`Edit ${e.name}'s ${DAYS[d]} availability`}
                            onClick={() => setEditor(e)}
                          >
                            Unavailable
                          </button>
                        )}
                      </td>
                    ))}
                    <td>
                      <button
                        className="icon-btn"
                        onClick={() => setEditor(e)}
                        aria-label={`Edit availability for ${e.name}`}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="info-box">
        <CalendarDays size={18} />
        Recurring windows apply to every week. Approved date-specific absences
        override them. Changes that conflict with existing shifts are blocked.
      </div>
      {editor && (
        <AvailabilityDialog employee={editor} onClose={() => setEditor(null)} />
      )}
    </>
  );
}
function AvailabilityDialog({
  employee,
  onClose,
}: {
  employee: Employee;
  onClose: () => void;
}) {
  const { mutate, saving } = useApp(),
    [windows, setWindows] = useState<(Window | null)[]>(
      structuredClone(employee.availability),
    ),
    [error, setError] = useState("");
  function update(i: number, key: "start" | "end", value: string) {
    const [h, m] = value.split(":").map(Number);
    setWindows((w) =>
      w.map((v, d) =>
        d === i
          ? { ...(v ?? { start: 600, end: 1380 }), [key]: h * 60 + m }
          : v,
      ),
    );
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutate({
        type: "availability",
        employeeId: employee.id,
        availability: windows,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title="A week that works for you"
      description={`Recurring confirmed availability · ${employee.name}`}
      onClose={onClose}
    >
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
                    setWindows((w) =>
                      w.map((a, k) =>
                        k === i
                          ? e.target.checked
                            ? { start: 600, end: 1380 }
                            : null
                          : a,
                      ),
                    )
                  }
                />
                <strong>{d}</strong>
              </label>
              {windows[i] ? (
                <>
                  <input
                    aria-label={`${d} availability start`}
                    type="time"
                    step="1800"
                    required
                    value={time(windows[i]!.start)}
                    onChange={(e) => update(i, "start", e.target.value)}
                  />
                  <span>to</span>
                  <input
                    aria-label={`${d} availability end`}
                    type="time"
                    step="1800"
                    required
                    value={time(windows[i]!.end)}
                    onChange={(e) => update(i, "end", e.target.value)}
                  />
                </>
              ) : (
                <span className="muted">Not available</span>
              )}
            </div>
          ))}
        </div>
        <p className="form-hint">
          Half-hour intervals · Europe/Amsterdam. Existing shifts must remain
          within confirmed availability.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            {saving ? "Saving…" : "Save availability"}
            <Check size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

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
    intervals = coverage(roster, data.scenario);
  return (
    <>
      <PageTitle
        eyebrow="A LITTLE CLARITY GOES A LONG WAY"
        title="Know where your hours go."
        description="Thoughtful labour planning starts with an honest picture."
      >
        <WeekPicker />
        <button className="btn primary" onClick={() => setEditing(true)}>
          Edit daily targets
        </button>
      </PageTitle>
      <div className="labour-metrics">
        <div>
          <span>Scheduled paid hours</span>
          <strong>
            {m.hours}
            <small> hrs</small>
          </strong>
        </div>
        <div>
          <span>Recommended weekly hours</span>
          <strong>
            {m.budget}
            <small> hrs</small>
          </strong>
        </div>
        <div>
          <span>Budget deviation</span>
          <strong className={m.hours > m.budget ? "orange-text" : ""}>
            {m.hours - m.budget > 0 ? "+" : ""}
            {(m.hours - m.budget).toFixed(1)}
            <small> hrs</small>
          </strong>
        </div>
        <div>
          <span>Staffing target coverage</span>
          <strong>
            {m.coverage}
            <small>%</small>
          </strong>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Every day has its own rhythm</h2>
            <p>Labour recommendations are soft targets, never hard ceilings.</p>
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-swatch target" />
              Recommended
            </span>
            <span>
              <i className="legend-swatch actual" />
              Scheduled
            </span>
          </div>
        </div>
        <LabourChart week={roster} />
        <div className="table-scroll">
          <table className="team-table">
            <thead>
              <tr>
                <th>DAY</th>
                {DAYS.map((d) => (
                  <th key={d}>{d.toUpperCase()}</th>
                ))}
                <th>WEEK</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Recommended</td>
                {roster.budgets.map((b, i) => (
                  <td key={i}>{b}h</td>
                ))}
                <td>{m.budget}h</td>
              </tr>
              <tr>
                <td>Scheduled</td>
                {DAYS.map((d, i) => (
                  <td key={d}>{dayHours(roster, i)}h</td>
                ))}
                <td>{m.hours}h</td>
              </tr>
              <tr>
                <td>Deviation</td>
                {DAYS.map((d, i) => {
                  const v = dayHours(roster, i) - roster.budgets[i];
                  return (
                    <td key={d} className={v > 0 ? "orange-text" : ""}>
                      {v > 0 ? "+" : ""}
                      {v}h
                    </td>
                  );
                })}
                <td>{(m.hours - m.budget).toFixed(1)}h</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel coverage-panel">
        <div className="panel-heading">
          <div>
            <h2>The gaps behind the numbers</h2>
            <p>
              People present in each 30-minute interval. Unpaid breaks reduce
              coverage.
            </p>
          </div>
          <Badge tone={m.gaps.length ? "peach" : "sage"}>
            {m.gaps.length} intervals below target
          </Badge>
        </div>
        <div className="coverage-scroll">
          <div className="coverage-grid">
            <div className="coverage-time">
              <span />
              {Array.from({ length: 26 }, (_, i) => (
                <span key={i}>{i % 2 === 0 ? time(600 + i * 30) : ""}</span>
              ))}
            </div>
            {DAYS.map((d, i) => (
              <div className="coverage-row" key={d}>
                <strong>{d}</strong>
                {intervals
                  .filter((x) => x.day === i)
                  .map((x) => (
                    <span
                      key={x.minute}
                      className={x.shortage ? "gap" : "covered"}
                      title={`${d} ${time(x.minute)}: ${x.actual} present / ${x.target} required`}
                      aria-label={`${d} ${time(x.minute)}: ${x.actual} present of ${x.target} required`}
                    >
                      {x.actual}
                      <small>/{x.target}</small>
                    </span>
                  ))}
              </div>
            ))}
          </div>
        </div>
        <div className="panel-foot">
          <span>
            <i className="legend-swatch gap" />
            Below target <i className="legend-swatch covered" />
            Target met
          </span>
          <span>Actual headcount / target · Synthetic demand</span>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Different people. Different preferences.</h2>
            <p>
              Preferred hours guide the conversation. Equal hours are not
              assumed to be fair.
            </p>
          </div>
          <Users size={19} />
        </div>
        <div className="preference-grid">
          {data.employees.map((e) => (
            <div className="preference-row" key={e.id}>
              <div className="person-cell">
                <Avatar employee={e} small />
                <span>{e.name}</span>
              </div>
              <div className="hours-track">
                <span
                  style={{
                    width: `${Math.min(employeeHours(roster, e.id) / Math.max(e.preferredHours, 1), 1) * 100}%`,
                  }}
                />
              </div>
              <span>
                {employeeHours(roster, e.id)} / {e.preferredHours}h
              </span>
            </div>
          ))}
        </div>
        <div className="panel-foot">
          Descriptive metrics only. No prediction, fairness score, or labour
          savings are claimed in this milestone.
        </div>
      </section>
      {editing && <BudgetDialog onClose={() => setEditing(false)} />}
    </>
  );
}
function BudgetDialog({ onClose }: { onClose: () => void }) {
  const { data, week, mutate, saving } = useApp(),
    [budgets, setBudgets] = useState(() => [...getWeek(data!, week).budgets]),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutate({ type: "budgets", week, budgets });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title="Give your week a little direction"
      description="Recommended paid labour hours. Your roster can exceed these targets."
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={save}>
        <ErrorBox error={error} />
        <div className="budget-editor">
          {DAYS.map((d, i) => (
            <label key={d}>
              <span>
                {d}
                <small>{dateAt(week, i)}</small>
              </span>
              <input
                type="number"
                min={0}
                max={300}
                step={0.5}
                required
                aria-label={`${d} recommended labour hours`}
                value={budgets[i]}
                onChange={(e) =>
                  setBudgets((b) =>
                    b.map((v, j) => (j === i ? Number(e.target.value) : v)),
                  )
                }
              />
              <span>hrs</span>
            </label>
          ))}
        </div>
        <div className="budget-total">
          <span>Weekly recommendation</span>
          <strong>{budgets.reduce((a, b) => a + b, 0)} hrs</strong>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            <Save size={15} />
            {saving ? "Saving…" : "Save targets"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export { ManagerRequests as Requests } from "./workforce-ui";
export function Settings() {
  return (
    <LoadGuard>
      <SettingsContent />
    </LoadGuard>
  );
}
function SettingsContent() {
  const { data, mutate, saving } = useApp(),
    [scenario, setScenario] = useState<Scenario | null>(null),
    [error, setError] = useState("");
  if (!data) return null;
  async function reset() {
    if (!scenario) return;
    try {
      await mutate({ type: "scenario", scenario });
      setScenario(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="A STRONG FOUNDATION"
        title="Room to grow."
        description="Your restaurant, the ground rules, and a little space to experiment."
      />
      <SkillRulesPanel />
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Your restaurant</h2>
              <p>Fictional pilot workspace</p>
            </div>
            <Sprout size={21} />
          </div>
          <dl className="details-list">
            <div>
              <dt>Restaurant</dt>
              <dd>{data.restaurant.name}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{data.restaurant.location}</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>Europe/Amsterdam</dd>
            </div>
            <div>
              <dt>Preparation & operating window</dt>
              <dd>10:00–23:00</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>Local PostgreSQL database</dd>
            </div>
            <div>
              <dt>Authentication</dt>
              <dd>Not active · Local demo only</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Clear rules. Better plans.</h2>
              <p>Validated prototype defaults</p>
            </div>
            <Clock3 size={20} />
          </div>
          <dl className="details-list">
            <div>
              <dt>Scheduling granularity</dt>
              <dd>30 minutes</dd>
            </div>
            <div>
              <dt>Minimum rest between shifts</dt>
              <dd>11 hours</dd>
            </div>
            <div>
              <dt>Maximum shift length</dt>
              <dd>9 hours</dd>
            </div>
            <div>
              <dt>Break for shifts over 5.5 hours</dt>
              <dd>At least 30 minutes, unpaid</dd>
            </div>
            <div>
              <dt>Weekly hour limits</dt>
              <dd>Employee-specific</dd>
            </div>
          </dl>
          <p className="settings-note">
            These are synthetic adult-worker rules, not a legal compliance
            certification. Age-specific rules, applicable CAO, entitlements, and
            DST handling require verification before a pilot.
          </p>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Try a different kind of week</h2>
            <p>
              Three deterministic fictional fixtures. Loading a fixture resets
              all demo edits.
            </p>
          </div>
          <FlaskConical size={20} />
        </div>
        <div className="scenario-grid">
          {(
            [
              {
                id: "normal",
                name: "A regular rhythm",
                desc: "Varied availability, lunch peaks, and a few approved absences.",
              },
              {
                id: "high-demand",
                name: "A busier week",
                desc: "Higher staffing targets and daily labour recommendations.",
              },
              {
                id: "shortage",
                name: "A tighter squeeze",
                desc: "Severely restricted Friday and Saturday availability.",
              },
            ] as const
          ).map((s) => (
            <div
              className={`scenario-card ${data.scenario === s.id ? "current" : ""}`}
              key={s.id}
            >
              <span className="eyebrow">
                {s.id.replace("-", " ").toUpperCase()}
              </span>
              <h3>{s.name}</h3>
              <p>{s.desc}</p>
              <button
                className="btn small"
                onClick={() => {
                  setScenario(s.id);
                  setError("");
                }}
              >
                <RotateCcw size={14} />
                {data.scenario === s.id ? "Reset this fixture" : "Load fixture"}
              </button>
              {data.scenario === s.id && <Badge>Active</Badge>}
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>The path ahead</h2>
            <p>A working foundation, built one milestone at a time.</p>
          </div>
          <Badge>Milestone 5</Badge>
        </div>
        <div className="roadmap-list">
          {[
            "Foundation · dashboard, team, availability, targets, draft roster",
            "Optimization · FastAPI, OR-Tools CP-SAT, independent validation",
            "Intelligent scheduling · alternatives, explanations, comparison",
            "Workforce management · employee portal, requests, approved swaps",
            "Local access · authentication, PostgreSQL, tenant isolation",
          ].map((s, i) => (
            <div key={s}>
              <span className={i < 5 ? "complete" : ""}>
                {i < 5 ? <Check size={15} /> : i + 1}
              </span>
              <p>{s}</p>
              <Badge tone={i < 5 ? "sage" : "neutral"}>
                {i < 5 ? "Implemented" : "Planned"}
              </Badge>
            </div>
          ))}
        </div>
      </section>
      <div className="info-box">
        <AlertTriangle size={19} />
        No Strobbo connection, real employee data, paid AI calls, or public
        deployment. The CP-SAT API is implemented locally; employee requests and
        approvals remain local to ShiftFlow.
      </div>
      {scenario && (
        <Modal
          title="Start fresh with this fixture?"
          description="This resets the roster, employees, availability, and targets for every week."
          onClose={() => setScenario(null)}
        >
          <div className="help-content">
            <ErrorBox error={error} />
            <p>
              Your local demo edits will be replaced by the{" "}
              <strong>{scenario.replace("-", " ")}</strong> fictional dataset.
              Export any draft roster you want to keep first. Request history is
              retained; active requests will be invalidated.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setScenario(null)}>
                Keep my changes
              </button>
              <button className="btn primary" disabled={saving} onClick={reset}>
                {saving ? "Loading…" : "Reset and load fixture"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
