"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ShieldAlert } from "lucide-react";
import { useApp } from "./provider";
import { CanClose, LoadGuard, NumberValue, PageTitle } from "./ui";
import { ShiftDialog } from "./schedule-view";
import { dayHours, DAYS, time } from "@/lib/schedule";
import { qualified, skillDiagnostics } from "@/lib/skills";
import { longDate, mondayOf, plural, shortDate, today } from "@/lib/format";
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

function Overview() {
  const { data, actor, setWeek } = useApp();
  const [dialog, setDialog] = useState<null | object>(null);
  if (!data || !actor) return null;
  const date = today();
  // Home always follows the restaurant's current day, independent of the
  // week a manager last browsed in Schedule or Intelligence.
  const shifts = data.weeks.flatMap((w) => w.shifts)
    .filter((s) => s.date === date)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const awaiting = (data.requests ?? []).filter(
    (r) => r.status === "pending-manager" && (r.kind === "swap" || r.kind === "cover"),
  );
  const names = Object.fromEntries(data.employees.map((e) => [e.id, e.name]));
  const findings = shifts.length ? skillDiagnostics(data, shifts, [date]).issues : [];
  return (
    <>
      <PageTitle title="Today" description={longDate(date)} />
      <section className="panel" aria-label="Today’s shifts">
        <div className="panel-heading"><h2>Today’s shifts</h2></div>
        {shifts.length ? (
          <div className="home-shifts">
            {shifts.map((s) => {
              const employee = data.employees.find((e) => e.id === s.employeeId);
              const closer = employee && s.end >= data.restaurant.close && qualified(employee, "close");
              return (
                <button className="home-shift" key={s.id} onClick={() => { setWeek(mondayOf(date)); setDialog({ shift: s }); }}>
                  <span><strong>{employee?.name ?? "Team member"}</strong><small>{s.kind}{closer && <> · Closer <CanClose /></>}{employee?.supervisionSkillId && " · Needs supervision"}</small></span>
                  <span className="home-shift-time">{time(s.start)}–{time(s.end)}</span>
                </button>
              );
            })}
          </div>
        ) : <p className="home-quiet">No shifts saved for today.</p>}
        {findings.length > 0 && <Link className="home-shift-warning" href="/schedule" onClick={() => setWeek(mondayOf(date))}><ShieldAlert size={15} /> {plural(findings.length, "skill or supervision check")} need attention today <ChevronRight size={14} /></Link>}
      </section>
      <section className="panel" aria-label="Swaps to approve">
        <div className="panel-heading"><h2>Swaps to approve{awaiting.length > 0 && <span className="count accent">{awaiting.length}</span>}</h2></div>
        {awaiting.length ? (
          <div className="attention-list">
            {awaiting.map((r) => "targetEmployeeId" in r && (
              <Link key={r.id} className="attention-item" href="/requests">
                <span className="a-text"><strong>{names[r.requesterId] ?? "Team member"} → {names[r.targetEmployeeId] ?? "Team member"}</strong><small>{shortDate(r.shift.date)} · {time(r.shift.start)}–{time(r.shift.end)} · {r.kind === "swap" ? "Swap" : "Shift cover"}</small></span>
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        ) : <p className="home-quiet">No swaps waiting for your approval.</p>}
      </section>
      {dialog && <ShiftDialog {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
