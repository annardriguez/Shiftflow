import type { Employee, Scenario, Shift, Week, Workspace } from "./types";
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const BASE_WEEK = "2026-11-16";
export function dateAt(start: string, day: number) {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}
export function weekLabel(start: string) {
  const d = new Date(`${start}T12:00:00Z`),
    e = new Date(`${dateAt(start, 6)}T12:00:00Z`);
  return `${d.getUTCDate()} – ${e.getUTCDate()} ${e.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })} ${e.getUTCFullYear()}`;
}
export function time(n: number) {
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
}
export function paidHours(s: Shift) {
  return (s.end - s.start - s.breakMinutes) / 60;
}
export function dayIndex(date: string) {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}
export function emptyWeek(start: string, scenario: Scenario): Week {
  return {
    start,
    budgets:
      scenario === "high-demand"
        ? [40, 40, 42, 44, 52, 56, 48]
        : [32, 32, 34, 36, 44, 48, 40],
    shifts: [],
  };
}
export function getWeek(w: Workspace, start: string) {
  return w.weeks.find((x) => x.start === start) ?? emptyWeek(start, w.scenario);
}
export function dayHours(week: Week, day: number) {
  return week.shifts
    .filter((s) => s.date === dateAt(week.start, day))
    .reduce((n, s) => n + paidHours(s), 0);
}
export function employeeHours(week: Week, id: string) {
  return week.shifts
    .filter((s) => s.employeeId === id)
    .reduce((n, s) => n + paidHours(s), 0);
}
export function requirement(scenario: Scenario, day: number, minute: number) {
  if (minute < 660 || minute >= 1290) return 1;
  const peak =
    (minute >= 720 && minute < 840) || (minute >= 1020 && minute < 1200);
  return (
    (peak ? 3 : 2) +
    (day >= 4 && peak ? 1 : 0) +
    (scenario === "high-demand" ? 1 : 0)
  );
}
export function coverage(week: Week, scenario: Scenario) {
  return DAYS.flatMap((_, day) =>
    Array.from({ length: 26 }, (_, i) => {
      const minute = 600 + i * 30;
      const actual = week.shifts.filter(
        (s) =>
          s.date === dateAt(week.start, day) &&
          s.start <= minute &&
          s.end >= minute + 30 &&
          !(
            s.breakMinutes &&
            s.breakStart !== null &&
            s.breakStart < minute + 30 &&
            s.breakStart + s.breakMinutes > minute
          ),
      ).length;
      return {
        day,
        minute,
        actual,
        target: requirement(scenario, day, minute),
        shortage: Math.max(0, requirement(scenario, day, minute) - actual),
      };
    }),
  );
}
export function metrics(week: Week, w: Workspace) {
  const intervals = coverage(week, w.scenario),
    target = intervals.reduce((n, i) => n + i.target, 0);
  return {
    hours: week.shifts.reduce((n, s) => n + paidHours(s), 0),
    budget: week.budgets.reduce((a, b) => a + b, 0),
    coverage: Math.round(
      (100 * intervals.reduce((n, i) => n + Math.min(i.actual, i.target), 0)) /
        target,
    ),
    gaps: intervals.filter((i) => i.shortage > 0),
    employees: new Set(week.shifts.map((s) => s.employeeId)).size,
  };
}
/** Convert unambiguous daytime restaurant wall-clock minutes to UTC minutes.
 * Operating windows exclude the ambiguous/nonexistent 02:00 DST hour.
 */
export function localMinuteInstant(
  date: string,
  minute: number,
  zone = "Europe/Amsterdam",
) {
  const wall = new Date(`${date}T00:00:00Z`).getTime() + minute * 60000;
  let instant = wall;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    instant += wall - represented;
  }
  return instant / 60000;
}
export function validateShift(
  s: Shift,
  employees: Employee[],
  shifts: Shift[],
  operating = { open: 600, close: 1380 },
): string[] {
  const errors: string[] = [],
    e = employees.find((e) => e.id === s.employeeId);
  if (!e) return ["Employee does not exist."];
  if (s.start >= s.end) errors.push("End time must be after start time.");
  if (s.start < operating.open || s.end > operating.close)
    errors.push("Shifts must fit within preparation hours (10:00–23:00).");
  if ((s.end - s.start) / 60 > e.maxShiftHours)
    errors.push(`Maximum shift length is ${e.maxShiftHours} hours.`);
  if (
    s.breakMinutes > 0 &&
    (s.breakStart === null ||
      s.breakStart < s.start ||
      s.breakStart + s.breakMinutes > s.end)
  )
    errors.push("Place the unpaid break entirely inside the shift.");
  if (s.breakMinutes >= s.end - s.start)
    errors.push("Break must be shorter than the shift.");
  if (s.end - s.start > 330 && s.breakMinutes < 30)
    errors.push(
      "Demo rule: shifts longer than 5.5 hours require a 30-minute unpaid break.",
    );
  const a = availabilityOn(e, s.date);
  if (!a || s.start < a.start || s.end > a.end)
    errors.push("Shift is outside confirmed availability.");
  if (e.absentDates.includes(s.date))
    errors.push("Employee has an approved absence on this date.");
  if (!e.eligible.includes(s.kind))
    errors.push(`Employee is not eligible for ${s.kind.toLowerCase()} shifts.`);
  if (s.kind === "Opening" && s.start !== operating.open)
    errors.push("Opening shifts must start at 10:00.");
  if (s.kind === "Closing" && s.end !== operating.close)
    errors.push("Closing shifts must end at 23:00.");
  const aStart = localMinuteInstant(s.date, s.start),
    aEnd = localMinuteInstant(s.date, s.end);
  for (const other of shifts.filter(
    (o) => o.id !== s.id && o.employeeId === s.employeeId,
  )) {
    const bStart = localMinuteInstant(other.date, other.start),
      bEnd = localMinuteInstant(other.date, other.end);
    if (aStart < bEnd && bStart < aEnd)
      errors.push("Employee already has an overlapping shift.");
    else if (
      Math.max(aStart, bStart) - Math.min(aEnd, bEnd) <
      e.minRestHours * 60
    )
      errors.push(
        `At least ${e.minRestHours} hours of rest is required between shifts.`,
      );
  }
  const monday = dateAt(s.date, -dayIndex(s.date));
  const total = shifts
    .filter(
      (o) =>
        o.id !== s.id &&
        o.employeeId === s.employeeId &&
        o.date >= monday &&
        o.date <= dateAt(monday, 6),
    )
    .reduce((n, o) => n + paidHours(o), paidHours(s));
  if (total > e.maxHours)
    errors.push(`Weekly maximum of ${e.maxHours} paid hours exceeded.`);
  return [...new Set(errors)];
}

export function availabilityOn(e: Employee, date: string) {
  const override = e.availabilityOverrides?.find((o) => o.date === date);
  return override ? override.window : e.availability[dayIndex(date)];
}
