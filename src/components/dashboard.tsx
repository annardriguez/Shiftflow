"use client";
import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarOff,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  Hourglass,
  PenLine,
  Plus,
  ShieldAlert,
  Sparkles,
  Users,
  Check,
  Activity,
} from "lucide-react";
import { useApp } from "./provider";
import { Avatar, CanClose, EmptyState, LoadGuard, NumberValue, PageTitle, WeekPicker } from "./ui";
import { ShiftDialog, humanIssue } from "./schedule-view";
import { exportRoster } from "@/lib/download";
import { dateAt, dayHours, DAYS, getWeek, metrics, paidHours, time } from "@/lib/schedule";
import { qualified, skillDiagnostics } from "@/lib/skills";
import { statusMeta } from "@/lib/swap-insights";
import {
  cleanAudit,
  dayOfMonth,
  firstName,
  hours,
  longDate,
  nowMinute,
  plural,
  relativeTime,
  shortDate,
  today,
} from "@/lib/format";
import type { Week } from "@/lib/types";

/** Daily scheduled vs target paid hours. Every bar is derived from the roster. */
export function LabourChart({ week }: { week: Week; compact?: boolean }) {
  const max = Math.max(...week.budgets, ...DAYS.map((_, d) => dayHours(week, d)), 10) * 1.1;
  return (
    <div className="labour-chart">
      <div className="chart-legend">
        <span>
          <i className="legend-swatch" /> Scheduled
        </span>
        <span>
          <i className="legend-swatch target" /> Target
        </span>
      </div>
      <div className="chart-bars" role="img" aria-label="Scheduled versus target paid hours per day">
        {DAYS.map((d, i) => (
          <div className="chart-day" key={d} title={`${d}: ${dayHours(week, i)}h scheduled, ${week.budgets[i]}h target`}>
            <i className="target" style={{ height: `${(week.budgets[i] / max) * 100}%` }} />
            <i style={{ height: `${(dayHours(week, i) / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="chart-labels">
        {DAYS.map((d, i) => (
          <span key={d}>
            {d}
            <br />
            <NumberValue value={dayHours(week, i)} />/{week.budgets[i]}h
          </span>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  return (
    <LoadGuard>
      <Overview />
    </LoadGuard>
  );
}

function greeting() {
  const h = Math.floor(nowMinute() / 60);
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Overview() {
  const { data, week, actor } = useApp();
  const t = today();
  const dates = DAYS.map((_, i) => dateAt(week, i));
  const [day, setDay] = useState(() => (dates.includes(t) ? t : dates[0]));
  const [dialog, setDialog] = useState<null | object>(null);
  if (!data || !actor) return null;
  const selectedDay = dates.includes(day) ? day : dates[0];
  const roster = getWeek(data, week),
    m = metrics(roster, data),
    budget = roster.budgets.reduce((a, b) => a + b, 0);
  const diag = skillDiagnostics(data, roster.shifts, dates);
  const requests = data.requests ?? [];
  const awaitingMe = requests.filter((r) => r.status === "pending-manager");
  const awaitingColleague = requests.filter((r) => r.status === "pending-colleague");
  const unreviewed = data.employees.filter((e) => !e.skillsReviewedAt);
  const issueDays = dates
    .map((d) => ({ d, n: diag.issues.filter((i) => i.date === d).length }))
    .filter((x) => x.n > 0);
  const gapDays = dates
    .map((d, i) => ({ d, n: m.gaps.filter((g) => g.day === i).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const names = Object.fromEntries(data.employees.map((e) => [e.id, e.name]));
  const first = (id: string) => firstName(names[id] ?? "Former colleague");
  const recent = requests.filter((r) => r.status === "applied").slice(0, 3);

  type Item = { key: string; tone: string; icon: React.ReactNode; title: string; sub: string; href: string };
  const items: Item[] = [
    ...awaitingMe.slice(0, 4).map((r) => ({
      key: r.id,
      tone: "accent",
      icon: <ArrowLeftRight size={15} />,
      title:
        "targetEmployeeId" in r
          ? `${first(r.requesterId)} → ${first(r.targetEmployeeId)}: ${r.kind === "swap" ? "swap" : "cover"} ready to approve`
          : `${first(r.requesterId)}: ${r.kind === "time-off" ? "time off" : "availability change"} to review`,
      sub: "shift" in r ? `${shortDate(r.shift.date)} · ${time(r.shift.start)}–${time(r.shift.end)} · colleague accepted` : statusMeta(r).next,
      href: "/requests",
    })),
    ...issueDays.slice(0, 3).map(({ d, n }) => ({
      key: "skill" + d,
      tone: "negative",
      icon: <ShieldAlert size={15} />,
      title: `${shortDate(d)}: ${plural(n, "skill gap")}`,
      sub: humanIssue(diag.issues.find((i) => i.date === d)!.message),
      href: "/schedule",
    })),
    ...(gapDays.length
      ? [
          {
            key: "gaps",
            tone: "caution",
            icon: <AlertTriangle size={15} />,
            title: `${plural(m.gaps.length, "half-hour")} below staffing target`,
            sub: `Most on ${gapDays
              .slice(0, 2)
              .map((g) => shortDate(g.d))
              .join(" and ")}`,
            href: "/labour",
          },
        ]
      : []),
    ...(unreviewed.length
      ? [
          {
            key: "unreviewed",
            tone: "caution",
            icon: <Users size={15} />,
            title: `${plural(unreviewed.length, "person", "people")} with unverified skills`,
            sub: "They can’t be suggested as replacements until you verify them",
            href: "/team",
          },
        ]
      : []),
    ...(awaitingColleague.length
      ? [
          {
            key: "colleague",
            tone: "",
            icon: <Hourglass size={15} />,
            title: `${plural(awaitingColleague.length, "swap request")} waiting on a colleague`,
            sub: "No action needed from you yet",
            href: "/requests",
          },
        ]
      : []),
  ];

  const dayShifts = roster.shifts
    .filter((s) => s.date === selectedDay)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const open = data.restaurant.open,
    close = data.restaurant.close,
    span = close - open;
  const pos = (min: number) => `${((min - open) / span) * 100}%`;
  const closers = dayShifts.filter((s) => {
    const e = data.employees.find((x) => x.id === s.employeeId);
    return s.end >= close && e && qualified(e, "close");
  });
  const restaurant = (actor.tenantName ?? "").split("·")[0].trim();

  return (
    <>
      <PageTitle
        title={`${greeting()}, ${firstName(actor.name)}`}
        description={`${restaurant} · ${longDate(t)}`}
      >
        <WeekPicker />
        <Link className="btn primary" href="/intelligence">Plan the week</Link>
      </PageTitle>
      <div className="stat-row overview-stats">
        <Link href="/requests" className="stat" style={{ color: "inherit" }}>
          <span className="stat-label">Swaps to approve</span>
          <span className="stat-value">{awaitingMe.length}</span>
          <span className={`stat-note ${awaitingMe.length ? "caution" : "positive"}`}>
            {awaitingMe.length ? "Colleague already accepted" : "Nothing waiting on you"}
          </span>
        </Link>
        <div className="stat">
          <span className="stat-label">Staffing coverage</span>
          <span className="stat-value">
            {m.coverage}
            <small>%</small>
          </span>
          <span className={`stat-note ${m.gaps.length ? "caution" : "positive"}`}>
            {m.gaps.length ? `${plural(m.gaps.length, "half-hour")} short` : "On target all week"}
          </span>
        </div>
      </div>
      <details className="secondary-section">
        <summary>{diag.issues.length ? `${diag.issues.length} skill or supervision findings · view details` : "Hours & skill coverage"}</summary>
        <div className="stat-row overview-stats">
        <div className="stat">
          <span className="stat-label">Skills & supervision</span>
          <span className="stat-value">
            {diag.issues.length || <CheckCircle2 size={22} color="var(--positive)" />}
          </span>
          <span className={`stat-note ${diag.issues.length ? "negative" : "positive"}`}>
            {diag.issues.length ? `Gaps on ${plural(issueDays.length, "day")}` : "Every shift covered"}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Paid hours</span>
          <span className="stat-value">
            <NumberValue value={m.hours} />
            <small>/ {budget}h</small>
          </span>
          <span className="stat-note">
            {m.hours > budget ? `${hours(m.hours - budget)} over target` : `${hours(budget - m.hours)} under target`}
          </span>
        </div>
        </div>
      </details>

      <section className="panel" aria-label="Week at a glance">
        <div className="week-strip">
          {dates.map((d, i) => {
            const h = dayHours(roster, i),
              b = roster.budgets[i] || 1,
              issues = diag.issues.filter((x) => x.date === d).length,
              gaps = m.gaps.filter((g) => g.day === i).length,
              count = roster.shifts.filter((s) => s.date === d).length;
            return (
              <button
                key={d}
                className={`week-strip-day ${d === t ? "today" : ""}`}
                onClick={() => setDay(d)}
                aria-pressed={d === selectedDay}
                style={{ textAlign: "left", boxShadow: d === selectedDay ? "inset 0 -2px 0 var(--accent)" : undefined }}
              >
                <span className="d">
                  {DAYS[i]} <b>{dayOfMonth(d)}</b>
                </span>
                <span className={`meter ${issues ? "negative" : gaps ? "caution" : "positive"}`}>
                  <i style={{ width: `${Math.min(100, (h / b) * 100)}%` }} />
                </span>
                <small>
                  {plural(count, "shift")} · <NumberValue value={h} />h
                </small>
                {issues ? (
                  <span className="flag">
                    <ShieldAlert size={11} /> Skills
                  </span>
                ) : gaps ? (
                  <span className="flag">
                    <AlertTriangle size={11} /> {gaps} short
                  </span>
                ) : count ? (
                  <span className="flag ok">
                    <Check size={11} /> Covered
                  </span>
                ) : (
                  <small>No shifts</small>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <div className="overview-grid">
        <div className="overview-col">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  Needs attention {items.length > 0 && <span className="count caution">{items.length}</span>}
                </h2>
                <p>What’s blocking a smooth week, most urgent first.</p>
              </div>
            </div>
            {items.length ? (
              <div className="attention-list">
                {items.map((it) => (
                  <Link key={it.key} href={it.href} className="attention-item">
                    <span className={`a-icon ${it.tone}`}>{it.icon}</span>
                    <span className="a-text">
                      <strong>{it.title}</strong>
                      <small>{it.sub}</small>
                    </span>
                    <ChevronRight size={16} />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="all-clear">
                <CheckCircle2 size={18} /> All clear. No requests waiting and every shift is covered.
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{selectedDay === t ? "Today’s staffing" : `Staffing · ${longDate(selectedDay)}`}</h2>
                <p>
                  {plural(dayShifts.length, "person", "people")} ·{" "}
                  {closers.length ? (
                    <>
                      closing with {closers.map((s) => first(s.employeeId)).join(", ")} <CanClose />
                    </>
                  ) : dayShifts.some((s) => s.end >= close) ? (
                    <span style={{ color: "var(--negative)" }}>no qualified closer scheduled</span>
                  ) : (
                    "no closing shift"
                  )}
                </p>
              </div>
              <Link className="text-link" href="/schedule">
                Full schedule <ChevronRight size={13} />
              </Link>
            </div>
            {dayShifts.length ? (
              <div className="lineup">
                <div className="lineup-scale">
                  <span />
                  <div className="ticks">
                    {[open, open + 180, open + 360, open + 540, close].map((min) => (
                      <span key={min} style={{ left: pos(min) }}>
                        {time(min)}
                      </span>
                    ))}
                  </div>
                </div>
                {dayShifts.map((s) => {
                  const e = data.employees.find((x) => x.id === s.employeeId);
                  return (
                    <div className="lineup-row" key={s.id}>
                      <div className="person-cell">
                        {e && <Avatar employee={e} size="xs" />}
                        <strong>
                          {e?.name.split(" ")[0]} {e && s.kind === "Closing" && qualified(e, "close") && <CanClose />}
                        </strong>
                      </div>
                      <button
                        className="lineup-track"
                        onClick={() => setDialog({ shift: s })}
                        aria-label={`${e?.name}, ${time(s.start)} to ${time(s.end)}`}
                        style={{ width: "100%" }}
                      >
                        <span className={`lineup-bar ${s.kind.toLowerCase()}`} style={{ left: pos(s.start), width: `calc(${pos(s.end)} - ${pos(s.start)})` }}>
                          <span>
                            {time(s.start)}–{time(s.end)}
                          </span>
                          {s.breakStart !== null && s.breakMinutes > 0 && (
                            <span
                              className="brk"
                              style={{
                                left: `${((s.breakStart - s.start) / (s.end - s.start)) * 100}%`,
                                width: `${(s.breakMinutes / (s.end - s.start)) * 100}%`,
                              }}
                              title="Unpaid break"
                            />
                          )}
                        </span>
                        {selectedDay === t && nowMinute() > open && nowMinute() < close && (
                          <span className="now-line" style={{ left: pos(nowMinute()) }} />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={<CalendarOff size={20} />} title="No shifts this day">
                Pick another day above, or add shifts in the schedule.
              </EmptyState>
            )}
            <div className="panel-foot">
              <span>
                <NumberValue value={dayShifts.reduce((n, s) => n + paidHours(s), 0)} />h paid of{" "}
                {roster.budgets[dates.indexOf(selectedDay)]}h target
              </span>
              <span>Striped = unpaid break</span>
            </div>
          </section>
        </div>

        <details className="secondary-section overview-extras">
          <summary>More tools & recent activity</summary>
          <div className="overview-col">
          <section className="panel">
            <div className="panel-heading">
              <h2>Quick actions</h2>
            </div>
            <div className="attention-list">
              <button className="attention-item" onClick={() => setDialog({})}>
                <span className="a-icon">
                  <Plus size={15} />
                </span>
                <span className="a-text">
                  <strong>Add a shift</strong>
                  <small>Checked against availability and rules</small>
                </span>
                <ChevronRight size={16} />
              </button>
              <Link className="attention-item" href="/intelligence">
                <span className="a-icon accent">
                  <Sparkles size={15} />
                </span>
                <span className="a-text">
                  <strong>Generate this week</strong>
                  <small>Compare three complete rosters</small>
                </span>
                <ChevronRight size={16} />
              </Link>
              <Link className="attention-item" href="/requests">
                <span className="a-icon">
                  <PenLine size={15} />
                </span>
                <span className="a-text">
                  <strong>Record an agreed swap</strong>
                  <small>When colleagues already agreed in person</small>
                </span>
                <ChevronRight size={16} />
              </Link>
              <button className="attention-item" onClick={() => exportRoster(data, week)}>
                <span className="a-icon">
                  <Download size={15} />
                </span>
                <span className="a-text">
                  <strong>Export roster</strong>
                  <small>CSV for your records or other systems</small>
                </span>
                <ChevronRight size={16} />
              </button>
            </div>
          </section>

          {recent.length > 0 && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Recently approved</h2>
                <Link className="text-link" href="/requests">
                  All <ChevronRight size={13} />
                </Link>
              </div>
              <div className="attention-list">
                {recent.map((r) => (
                  <Link key={r.id} href="/requests" className="attention-item">
                    <span className="a-icon positive">
                      <CheckCircle2 size={15} />
                    </span>
                    <span className="a-text">
                      <strong>
                        {"targetEmployeeId" in r
                          ? `${first(r.targetEmployeeId)} took over ${first(r.requesterId)}’s shift`
                          : `${first(r.requesterId)}: ${r.kind === "time-off" ? "time off" : "availability"} approved`}
                      </strong>
                      <small>
                        {"shift" in r ? `${shortDate(r.shift.date)} · ` : ""}
                        {r.approvedAt && relativeTime(r.approvedAt)}
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-heading">
              <h2>
                <Activity size={15} /> Recent changes
              </h2>
            </div>
            <div className="activity">
              {data.audit.slice(0, 6).map((a) => (
                <div className="activity-item" key={a.id}>
                  <span className={`ai-dot ${/applied|approved/i.test(a.message) ? "positive" : ""}`}>
                    {/applied|approved/i.test(a.message) ? <Check size={11} /> : <Clock3 size={11} />}
                  </span>
                  <div>
                    <p>{cleanAudit(a.message)}</p>
                    <small>
                      {names[a.actorId ?? ""] ? `${first(a.actorId!)} · ` : ""}
                      {relativeTime(a.at)}
                    </small>
                  </div>
                </div>
              ))}
              {!data.audit.length && <p className="form-hint" style={{ padding: 16 }}>No changes yet.</p>}
            </div>
          </section>
          </div>
        </details>
      </div>
      {dialog && <ShiftDialog {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
