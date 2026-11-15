import { dateAt, dayIndex, time } from "./schedule";
import type { Shift } from "./types";

const ZONE = "Europe/Amsterdam";

function d(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

/** "Mon 16 Nov" */
export function shortDate(date: string) {
  return d(date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
/** "Monday 16 November" */
export function longDate(date: string) {
  return d(date).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
export function weekdayShort(date: string) {
  return d(date).toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });
}
export function dayOfMonth(date: string) {
  return d(date).getUTCDate();
}
/** Today's date in the restaurant's time zone, as YYYY-MM-DD. */
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
/** Minutes since local midnight in the restaurant's time zone. */
export function nowMinute() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return get("hour") * 60 + get("minute");
}
export function mondayOf(date: string) {
  return dateAt(date, -dayIndex(date));
}
/** "Today", "Tomorrow", or "Mon 16 Nov". */
export function relativeDay(date: string) {
  const t = today();
  if (date === t) return "Today";
  if (date === dateAt(t, 1)) return "Tomorrow";
  if (date === dateAt(t, -1)) return "Yesterday";
  return shortDate(date);
}
export function timeRange(s: Pick<Shift, "start" | "end">) {
  return `${time(s.start)}–${time(s.end)}`;
}
export function hours(n: number) {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}h`;
}
export function paid(s: Pick<Shift, "start" | "end" | "breakMinutes">) {
  return (s.end - s.start - s.breakMinutes) / 60;
}
/** "3 min ago", "2 h ago", "Mon 16 Nov, 14:05" */
export function relativeTime(iso: string) {
  const then = new Date(iso).getTime(),
    diff = Date.now() - then;
  if (Number.isNaN(then)) return "";
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ZONE,
  });
}
export function absoluteTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ZONE,
  });
}
export function initials(name: string) {
  return name
    .split(" ")
    .filter((_, i, a) => i === 0 || i === a.length - 1)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
}
export function firstName(name: string) {
  return name.split(" ")[0];
}
export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Readable version of a stored audit message (stored text is unchanged). */
export function cleanAudit(message: string) {
  const kind = (k: string) =>
    k === "cover"
      ? "Cover request"
      : k === "swap"
        ? "Swap"
        : k === "time-off"
          ? "Time-off request"
          : "Availability change";
  const status: Record<string, string> = {
    "pending-manager": "accepted, awaiting approval",
    applied: "approved and applied",
    declined: "declined",
    rejected: "rejected",
    cancelled: "cancelled",
    invalidated: "expired",
  };
  return message
    .replace(/^Approved and applied (cover|swap|time-off|availability) in ShiftFlow; Strobbo not connected\.$/, (_, k) => `${kind(k)} approved and applied to the roster`)
    .replace(/^(cover|swap|time-off|availability) request ([a-z-]+)\.$/, (_, k, s) => `${kind(k)} ${status[s] ?? s}`)
    .replace(/^(Created|Submitted) (cover|swap|time-off|availability) request\.$/, (_, v, k) => `${kind(k)} ${v === "Created" ? "sent" : "submitted"}`)
    .replace(/: competencies reviewed by local demo manager\. Any resulting roster gaps require review\./, ": skills verified")
    .replace(/^Saved ([a-z-]+) (edited )?draft for (\d{4}-\d{2}-\d{2}); Strobbo not connected\.$/, (_, s, e, d) => `Saved ${e ? "edited " : ""}generated roster (${s.replaceAll("-", " ")}) for week of ${shortDate(d)}`)
    .replace(/(\d{4}-\d{2}-\d{2})/g, (d) => shortDate(d))
    .replace(/; Strobbo not connected\.?/, "")
    .replace(/fictional fixture\. Previous demo edits were reset\./, "demo data set. Earlier edits were reset.")
    .replace(/\.$/, "");
}
