"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  Clock3,
  Users,
  ShieldCheck,
  Plus,
  SlidersHorizontal,
  Sparkles,
  AlertTriangle,
  Sun,
  Check,
  Coffee,
} from "lucide-react";
import { useState } from "react";
import { useApp } from "./provider";
import { Avatar, Badge, LoadGuard, NumberValue, WeekPicker } from "./ui";
import {
  dateAt,
  dayHours,
  DAYS,
  getWeek,
  metrics,
  paidHours,
  time,
} from "@/lib/schedule";
import type { Week } from "@/lib/types";
import { SkillBadges } from "./skills";
import { skillDiagnostics } from "@/lib/skills";
import { ShiftDialog } from "./schedule-view";
export function LabourChart({
  week,
  compact = false,
}: {
  week: Week;
  compact?: boolean;
}) {
  const max =
    Math.max(...week.budgets, ...DAYS.map((_, d) => dayHours(week, d)), 10) *
    1.2;
  return (
    <div className={`labour-chart ${compact ? "compact" : ""}`}>
      <div className="chart-plot">
        <div className="chart-y">
          {[4, 3, 2, 1, 0].map((n) => (
            <span key={n}>{Math.round((max * n) / 4)}h</span>
          ))}
        </div>
        <div className="chart-area">
          <div className="grid-lines">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} />
            ))}
          </div>
          <div className="chart-bars">
            {DAYS.map((d, i) => (
              <div className={`chart-day ${i === 0 ? "first" : ""}`} key={d}>
                <div
                  className="bars"
                  title={`${d}: ${dayHours(week, i)}h scheduled, ${week.budgets[i]}h recommended`}
                >
                  <div
                    className="bar target-bar"
                    style={{ height: `${(week.budgets[i] / max) * 100}%` }}
                  />
                  <div
                    className="bar actual-bar"
                    style={{ height: `${(dayHours(week, i) / max) * 100}%` }}
                  />
                </div>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
export function Dashboard() {
  return (
    <LoadGuard>
      <DashboardContent />
    </LoadGuard>
  );
}
function DashboardContent() {
  const { data, week } = useApp();
  const [add, setAdd] = useState(false);
  if (!data) return null;
  const roster = getWeek(data, week),
    m = metrics(roster, data),
    today = roster.shifts
      .filter((s) => s.date === week)
      .sort((a, b) => a.start - b.start),
    dailyGaps = m.gaps.filter((g) => g.day === 0),
    absence = data.employees.filter((e) =>
      e.absentDates.some((d) => d >= week && d <= dateAt(week, 6)),
    );
  const skillIssues = skillDiagnostics(
    data,
    roster.shifts,
    DAYS.map((_, i) => dateAt(week, i)),
  ).issues;
  const unreviewed = data.employees.filter((e) => !e.skillsReviewedAt).length;
  const cards = [
    {
      label: "Scheduled hours",
      value: m.hours,
      unit: "hrs",
      icon: Clock3,
      color: "peach",
      bottom: `${roster.shifts.length} shifts across the week`,
      note: "Weekly total",
    },
    {
      label: "Labour hour target",
      value: m.budget,
      unit: "hrs",
      icon: BarIcon,
      color: "blue",
      bottom: `${Math.abs(m.hours - m.budget).toFixed(1)} hrs ${m.hours <= m.budget ? "below" : "above"} recommendation`,
      note: "Soft target",
    },
    {
      label: "Staffing coverage",
      value: m.coverage,
      unit: "%",
      icon: ShieldCheck,
      color: "sage",
      bottom: `${m.gaps.length} intervals need a closer look`,
      note: "30-min intervals",
    },
    {
      label: "Team on the roster",
      value: m.employees,
      unit: `/ ${data.employees.length}`,
      icon: Users,
      color: "lilac",
      bottom: "Based on this week’s assignments",
      note: "Team members",
    },
  ];
  return (
    <>
      <div className="dashboard-title">
        <div>
          <div className="eyebrow">A FRESH WEEK, A CLEAR PICTURE</div>
          <h1>
            Your team. In flow<span className="orange-text">.</span>
          </h1>
          <p>Good things happen when everyone’s in the right place.</p>
        </div>
        <WeekPicker />
      </div>
      {unreviewed > 0 && (
        <div className="skill-roster-alert">
          <AlertTriangle size={18} />
          <div>
            <strong>{unreviewed} skill profiles need manager review</strong>
            <p>
              Your existing data is preserved. Qualifications were not inferred
              during the upgrade.
            </p>
            <Link className="text-link" href="/team">
              Review team skills <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      )}
      {skillIssues.length > 0 && (
        <div className="skill-roster-alert">
          <ShieldCheck size={18} />
          <div>
            <strong>Check the skills behind your schedule</strong>
            <p>
              {skillIssues.length} mandatory skill / supervision findings.{" "}
              {skillIssues[0].message}
            </p>
            <Link href="/schedule" className="text-link">
              Review shifts & find cover <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      )}
      <section className="welcome-banner">
        <div className="welcome-copy">
          <span className="banner-kicker">
            <span className="sun-symbol">
              <Sun size={16} />
            </span>{" "}
            LET’S MAKE IT A GOOD WEEK
          </span>
          <h2>
            A little planning.
            <br />A whole lot of possibility.
          </h2>
          <p>
            Your people, their availability, and the week ahead.
            <br className="desktop-br" /> Bring it all together in one
            thoughtful schedule.
          </p>
          <Link className="btn primary" href="/schedule">
            <CalendarDays size={16} />
            Plan this week
            <ArrowRight size={16} />
          </Link>
          <span className="banner-footnote">
            Your draft is ready when you are.
          </span>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <span className="art-spark spark-one">✳</span>
          <span className="art-spark spark-two">✦</span>
          <div className="art-calendar">
            <div className="calendar-top">
              <span />
              <span />
              <span />
              <b>THE WEEK AHEAD</b>
              <i />
            </div>
            <div className="art-grid">
              {Array.from({ length: 20 }, (_, i) => (
                <span
                  className={
                    [2, 8, 11, 15].includes(i)
                      ? "filled"
                      : i === 13
                        ? "orange"
                        : i === 6
                          ? "checked"
                          : ""
                  }
                  key={i}
                >
                  {i === 6 ? <Check size={22} /> : ""}
                </span>
              ))}
            </div>
            <div className="art-cal-foot">
              <span />
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="art-floating">
            <span className="float-check">
              <Check size={17} />
            </span>
            <div>
              Good people.<strong>Great flow.</strong>
            </div>
            <span className="mini-avatars">
              <i>ND</i>
              <i>LV</i>
              <i>SB</i>
            </span>
          </div>
        </div>
      </section>
      <div className="metrics-grid">
        {cards.map(
          ({ label, value, unit, icon: Icon, color, bottom, note }) => (
            <section className="metric-card" key={label}>
              <div className="metric-label">
                {label}
                <span className={`metric-icon ${color}`}>
                  <Icon size={17} />
                </span>
              </div>
              <div className="metric-number">
                <NumberValue value={value} />
                <span>{unit}</span>
              </div>
              <div className="metric-bottom">
                <span>{bottom}</span>
              </div>
              <div className="metric-note">{note}</div>
            </section>
          ),
        )}
      </div>
      <div className="dashboard-middle">
        <section className="panel labour-panel">
          <div className="panel-heading">
            <div>
              <h2>The right hours, in the right places</h2>
              <p>Scheduled labour compared with your daily recommendations.</p>
            </div>
            <Link
              href="/labour"
              className="icon-btn"
              aria-label="Open labour insights"
            >
              <ArrowUpRight size={19} />
            </Link>
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
            <span className="chart-unit">PAID LABOUR HOURS</span>
          </div>
          <LabourChart week={roster} />
          <div className="panel-foot">
            <span>
              <span className="status-dot" />
              Targets guide the plan. Your team comes first.
            </span>
            <Link href="/labour">
              Adjust targets <ArrowRight size={13} />
            </Link>
          </div>
        </section>
        <section className="panel attention-panel">
          <div className="panel-heading">
            <div>
              <h2>A little attention</h2>
              <p>Small actions for a smoother week.</p>
            </div>
            <span className="count-badge">
              {(m.gaps.length ? 1 : 0) + (absence.length ? 1 : 0) + 1}
            </span>
          </div>
          <div className="attention-list">
            {m.gaps.length > 0 && (
              <Link href="/labour" className="attention-item">
                <span className="attention-icon peach">
                  <AlertTriangle size={18} />
                </span>
                <div>
                  <span className="attention-category orange-text">
                    COVERAGE
                  </span>
                  <h3>A few gaps in the week</h3>
                  <p>{m.gaps.length} half-hour intervals below target.</p>
                  <span className="inline-link">
                    Review coverage <ArrowRight size={12} />
                  </span>
                </div>
              </Link>
            )}
            {absence.length > 0 && (
              <Link href="/availability" className="attention-item">
                <span className="attention-icon lilac">
                  <Coffee size={18} />
                </span>
                <div>
                  <span className="attention-category purple-text">
                    UPCOMING ABSENCES
                  </span>
                  <h3>{absence.length} team members have time away</h3>
                  <p>Keep their approved dates in mind.</p>
                  <span className="inline-link">
                    View availability <ArrowRight size={12} />
                  </span>
                </div>
              </Link>
            )}
            <Link href="/schedule" className="attention-item">
              <span className="attention-icon blue">
                <CalendarDays size={18} />
              </span>
              <div>
                <span className="attention-category blue-text">
                  YOUR SCHEDULE
                </span>
                <h3>This week is still a draft</h3>
                <p>Take a look before your next team check-in.</p>
                <span className="inline-link">
                  Open schedule <ArrowRight size={12} />
                </span>
              </div>
            </Link>
          </div>
        </section>
      </div>
      <section className="panel today-panel">
        <div className="panel-heading">
          <div className="today-heading">
            <h2>
              Monday’s line-up{" "}
              <span className="subtle-count">{today.length}</span>
            </h2>
            <p>
              {new Date(`${week}T12:00:00Z`).toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              })}{" "}
              <span className="small-divider">·</span> Sample week
            </p>
          </div>
          <div className="panel-heading-actions">
            <button className="btn small" onClick={() => setAdd(true)}>
              <Plus size={15} />
              Add shift
            </button>
            <Link className="text-link" href="/schedule">
              Full schedule <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
        <div className="table-scroll">
          <table className="team-table">
            <thead>
              <tr>
                <th>TEAM MEMBER</th>
                <th>SHIFT</th>
                <th>PAID HOURS</th>
                <th>AVAILABILITY</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {today.slice(0, 5).map((s) => {
                const e = data.employees.find((e) => e.id === s.employeeId)!;
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="person-cell">
                        <Avatar employee={e} />
                        <div>
                          <strong>{e.name}</strong>
                          <SkillBadges employee={e} compact />
                          <small>{e.role}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="shift-time">
                        <span className={`shift-dot ${s.kind.toLowerCase()}`} />
                        {time(s.start)} – {time(s.end)}
                        <span className="shift-kind">{s.kind}</span>
                      </div>
                    </td>
                    <td>
                      <NumberValue value={paidHours(s)} /> hrs
                    </td>
                    <td>
                      <span className="available-tag">
                        <Check size={13} />
                        Confirmed
                      </span>
                    </td>
                    <td>
                      <Link
                        className="icon-btn"
                        href="/schedule"
                        aria-label={`View ${e.name}'s shift`}
                      >
                        <ArrowUpRight size={17} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {today.length === 0 && (
            <div className="empty-state">
              <CalendarDays size={27} />
              <h3>A fresh start for Monday</h3>
              <p>Add your first shift to start planning this week.</p>
              <button className="btn" onClick={() => setAdd(true)}>
                Add shift
              </button>
            </div>
          )}
        </div>
        <div className="panel-foot">
          <span>
            <span
              className={`status-dot ${dailyGaps.length ? "warning" : ""}`}
            />
            {dailyGaps.length
              ? `${dailyGaps.length} Monday intervals need more coverage`
              : "Monday’s target coverage is met"}
          </span>
          <span>Breaks excluded from paid hours</span>
        </div>
      </section>
      <div className="coming-next">
        <span className="next-icon">
          <Sparkles size={19} />
        </span>
        <div>
          <strong>A smarter week starts in Schedule.</strong>
          <p>
            Mathematical scheduling. Three strategies. A little more peace of
            mind.
          </p>
        </div>
        <Badge tone="neutral">Generate, compare and save in Schedule</Badge>
      </div>
      {add && <ShiftDialog onClose={() => setAdd(false)} />}
    </>
  );
}
function BarIcon({ size = 17 }: { size?: number }) {
  return <SlidersHorizontal size={size} />;
}
