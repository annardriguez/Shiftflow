"use client";
import {
  ArrowRight,
  ArrowLeftRight,
  Check,
  X,
  Clock3,
  CalendarOff,
  CalendarClock,
  UserRoundCheck,
  Send,
  Ban,
  Hourglass,
  PenLine,
} from "lucide-react";
import { Avatar, CanClose, StatusPill } from "./ui";
import {
  requestTitle,
  shiftRequestSteps,
  statusMeta,
} from "@/lib/swap-insights";
import { absoluteTime, paid, relativeTime, shortDate, timeRange, hours } from "@/lib/format";
import { DAYS, time } from "@/lib/schedule";
import type { Shift, Window } from "@/lib/types";
import type {
  RequestStatus,
  WorkforceRequest,
} from "@/lib/workforce-types";

export type Names = Record<string, string>;
export const nameOf = (names: Names, id?: string) =>
  id ? (names[id] ?? "Former colleague") : "Unknown";

export function RequestStatusPill({ request }: { request: WorkforceRequest }) {
  const m = statusMeta(request);
  return <StatusPill tone={m.tone}>{m.label}</StatusPill>;
}

export function KindIcon({ kind, size = 15 }: { kind: WorkforceRequest["kind"]; size?: number }) {
  if (kind === "swap") return <ArrowLeftRight size={size} />;
  if (kind === "cover") return <UserRoundCheck size={size} />;
  if (kind === "time-off") return <CalendarOff size={size} />;
  return <CalendarClock size={size} />;
}

export function Stepper({ request }: { request: WorkforceRequest }) {
  const { steps, done, failed } = shiftRequestSteps(request);
  return (
    <div className="stepper" aria-label="Progress">
      {steps.map((s, i) => {
        const state =
          i < done ? "done" : i === done && !failed ? "current" : failed ? "failed" : "";
        return (
          <span key={s} style={{ display: "contents" }}>
            {i > 0 && <span className={`bar ${i < done ? "done" : ""}`} />}
            <span className={`step ${state}`}>
              <i aria-hidden="true">
                {i < done ? <Check size={11} strokeWidth={3} /> : failed && i === done ? <X size={10} strokeWidth={3} /> : i + 1}
              </i>
              {s}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function ShiftLine({ shift, compact = false }: { shift: Shift; compact?: boolean }) {
  return (
    <div className="cc-shift">
      <span className={`kind-bar ${shift.kind.toLowerCase()}`} />
      <div style={{ display: "grid", gap: 1 }}>
        <strong>
          {shortDate(shift.date)} · {timeRange(shift)}
        </strong>
        {!compact && (
          <small>
            {shift.kind} · {hours(paid(shift))} paid
            {shift.breakMinutes ? ` · ${shift.breakMinutes} min break` : ""}
            {shift.kind === "Closing" && " · closing duties"}
          </small>
        )}
      </div>
    </div>
  );
}

function Person({
  id,
  names,
  label,
  from = false,
  canClose,
}: {
  id: string;
  names: Names;
  label: string;
  from?: boolean;
  canClose?: boolean;
}) {
  return (
    <div className={`cc-person ${from ? "from" : ""}`}>
      <Avatar employee={{ name: nameOf(names, id) }} small />
      <div>
        <strong>
          {nameOf(names, id)} {canClose && <CanClose />}
        </strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

/** The concrete roster change a cover/swap would produce. */
export function ChangeCards({
  request: r,
  names,
  canClose,
}: {
  request: WorkforceRequest;
  names: Names;
  canClose?: (id: string) => boolean;
}) {
  if (!("targetEmployeeId" in r)) return null;
  const applied = r.status === "applied";
  return (
    <div>
      <div className="change-card">
        <ShiftLine shift={r.shift} />
        <div className="cc-move">
          <Person id={r.requesterId} names={names} label={applied ? "Previously" : "Currently"} from />
          <ArrowRight size={16} />
          <Person
            id={r.targetEmployeeId}
            names={names}
            label={applied ? "Now working" : "Would work"}
            canClose={r.shift.kind === "Closing" && canClose?.(r.targetEmployeeId)}
          />
        </div>
      </div>
      {r.kind === "swap" && r.counterShift && (
        <div className="change-card">
          <ShiftLine shift={r.counterShift} />
          <div className="cc-move">
            <Person id={r.targetEmployeeId} names={names} label={applied ? "Previously" : "Currently"} from />
            <ArrowRight size={16} />
            <Person
              id={r.requesterId}
              names={names}
              label={applied ? "Now working" : "Would work"}
              canClose={r.counterShift.kind === "Closing" && canClose?.(r.requesterId)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function windowText(w: Window | null) {
  return w ? `${time(w.start)}–${time(w.end)}` : "Unavailable";
}

/** Body for time-off and availability requests. */
export function PersonalChange({
  request: r,
  current,
}: {
  request: WorkforceRequest;
  current?: { availability: (Window | null)[]; preferredHours: number };
}) {
  if (r.kind === "time-off")
    return (
      <div className="detail-list">
        <div>
          <span className="k">Dates</span>
          <span className="v">
            {r.dates.length === 1
              ? shortDate(r.dates[0])
              : `${shortDate(r.dates[0])} – ${shortDate(r.dates[r.dates.length - 1])}`}
          </span>
        </div>
        <div>
          <span className="k">Days</span>
          <span className="v">{r.dates.length}</span>
        </div>
      </div>
    );
  if (r.kind !== "availability") return null;
  return (
    <div className="detail-list">
      {r.availability.map((w, i) => {
        const before = current?.availability[i];
        const changed = current && JSON.stringify(before ?? null) !== JSON.stringify(w);
        return (
          <div key={i}>
            <span className="k">{DAYS[i]}</span>
            <span className="v">
              {changed && (
                <span style={{ color: "var(--faint)", textDecoration: "line-through", marginRight: 8, fontWeight: 500 }}>
                  {windowText(before ?? null)}
                </span>
              )}
              <span style={changed ? { color: "var(--accent-ink)" } : undefined}>{windowText(w)}</span>
            </span>
          </div>
        );
      })}
      {r.dateOverrides.map((o) => (
        <div key={o.date}>
          <span className="k">{shortDate(o.date)} (one-off)</span>
          <span className="v">{windowText(o.window)}</span>
        </div>
      ))}
      <div>
        <span className="k">Preferred weekly hours</span>
        <span className="v">
          {current && current.preferredHours !== r.preferredHours && (
            <span style={{ color: "var(--faint)", textDecoration: "line-through", marginRight: 8, fontWeight: 500 }}>
              {current.preferredHours}h
            </span>
          )}
          {r.preferredHours}h
        </span>
      </div>
    </div>
  );
}

const TRANSITION: Record<RequestStatus, { text: (who: string) => string; tone: string; icon: React.ReactNode }> = {
  "pending-colleague": { text: (w) => `${w} sent the request`, tone: "accent", icon: <Send size={10} /> },
  "pending-manager": { text: (w) => `${w} accepted`, tone: "caution", icon: <Hourglass size={10} /> },
  applied: { text: (w) => `${w} approved and applied it`, tone: "positive", icon: <Check size={11} strokeWidth={3} /> },
  declined: { text: (w) => `${w} declined`, tone: "", icon: <X size={10} /> },
  rejected: { text: (w) => `${w} rejected it`, tone: "negative", icon: <X size={10} /> },
  cancelled: { text: (w) => `${w} cancelled it`, tone: "", icon: <Ban size={10} /> },
  invalidated: { text: () => "Expired because the shift changed", tone: "", icon: <Clock3 size={10} /> },
};

export function Timeline({ request: r, names }: { request: WorkforceRequest; names: Names }) {
  return (
    <ol className="timeline">
      {r.history.map((h, i) => {
        const meta = TRANSITION[h.to];
        const who = nameOf(names, h.actorId).split(" ")[0];
        const first = i === 0;
        const text =
          first && h.to === "pending-manager"
            ? "source" in r && r.source === "manager-recorded"
              ? `${who} recorded an agreed change`
              : `${who} submitted the request`
            : meta.text(who);
        return (
          <li key={i}>
            <span className={`t-dot ${meta.tone}`}>{first && "source" in r && r.source === "manager-recorded" ? <PenLine size={10} /> : meta.icon}</span>
            <div className="t-text">
              <span>{text}</span>
              {h.note && <q>{h.note}</q>}
              <small title={absoluteTime(h.at)}>{relativeTime(h.at)}</small>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** One-line summary used in lists. */
export function requestSummary(r: WorkforceRequest, names: Names) {
  const first = (id: string) => nameOf(names, id).split(" ")[0];
  if (r.kind === "cover") return `${first(r.requesterId)} → ${first(r.targetEmployeeId)}`;
  if (r.kind === "swap") return `${first(r.requesterId)} ⇄ ${first(r.targetEmployeeId)}`;
  return nameOf(names, r.requesterId);
}
export function requestWhen(r: WorkforceRequest) {
  if ("shift" in r) return `${shortDate(r.shift.date)} · ${timeRange(r.shift)}${r.kind === "swap" && r.counterShift ? ` ⇄ ${shortDate(r.counterShift.date)}` : ""}`;
  if (r.kind === "time-off")
    return r.dates.length === 1 ? shortDate(r.dates[0]) : `${shortDate(r.dates[0])} – ${shortDate(r.dates[r.dates.length - 1])}`;
  return `New weekly availability · ${r.preferredHours}h preferred`;
}
export { requestTitle };
