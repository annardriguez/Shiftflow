import { getWeek, paidHours, time } from "./schedule";
import type { Workspace } from "./types";
function csvCell(value: string | number) {
  const text =
    typeof value === "string" && /^[=+\-@\t\r]/.test(value)
      ? `'${value}`
      : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
export function rosterCsv(data: Workspace, start: string) {
  const week = getWeek(data, start);
  const rows: (string | number)[][] = [
    [
      "FICTIONAL DATA - Draft roster",
      data.restaurant.timezone,
      "Strobbo: not connected",
    ],
    [
      week.provenance
        ? `Engine strategy: ${week.provenance.strategy}; ${week.provenance.edited ? "edited since generation" : "original suggestion"}; run ${week.provenance.runId}`
        : week.validationPolicy
          ? "Workflow-validated local draft; see request audit for approved changes"
          : "Manual / unsaved preview",
      `Workspace revision: ${data.revision}`,
    ],
    [
      "Employee",
      "Date",
      "Start",
      "End",
      "Shift type",
      "Break start",
      "Unpaid break (min)",
      "Paid hours",
    ],
    ...[...week.shifts]
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
      .map((s) => [
        data.employees.find((e) => e.id === s.employeeId)?.name ?? "",
        s.date,
        time(s.start),
        time(s.end),
        s.kind,
        s.breakStart === null ? "" : time(s.breakStart),
        s.breakMinutes,
        paidHours(s),
      ]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
