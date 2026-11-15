"use client";
import { useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  X,
  AlertTriangle,
  RefreshCw,
  Info,
  CheckCircle2,
  XCircle,
  KeyRound,
} from "lucide-react";
import { useApp } from "./provider";
import { dateAt, weekLabel } from "@/lib/schedule";
import { initials, mondayOf, today } from "@/lib/format";
import type { Employee } from "@/lib/types";
import type { Tone } from "@/lib/swap-insights";

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 16 16">
        <path
          d="M3 11.5 6.5 4M7.2 12.5 10.7 5M11.4 11.5 13.4 7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <BrandMark />
      ShiftFlow
    </span>
  );
}

const TINTS = ["blue", "lilac", "peach", "rose", "sage", "sand"];
function tintFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}
export function Avatar({
  employee,
  small = false,
  size,
}: {
  employee: Pick<Employee, "name"> & { color?: string };
  small?: boolean;
  size?: "xs" | "small" | "large";
}) {
  return (
    <span
      className={`avatar ${employee.color ?? tintFor(employee.name)} ${size ?? (small ? "small" : "")}`}
      aria-hidden="true"
    >
      {initials(employee.name)}
    </span>
  );
}

/** Small, consistent "Can close" key indicator. */
export function CanClose({ title = "Can close" }: { title?: string }) {
  return (
    <span className="can-close" title={title} aria-label={title} role="img">
      <KeyRound size={10} strokeWidth={2.4} />
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function StatusPill({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function WeekPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (week: string) => void;
}) {
  const app = useApp();
  const week = value ?? app.week,
    setWeek = onChange ?? app.setWeek,
    current = mondayOf(today());
  return (
    <div className="week-picker" role="group" aria-label="Week">
      <button aria-label="Previous week" onClick={() => setWeek(dateAt(week, -7))}>
        <ChevronLeft size={16} />
      </button>
      <span aria-live="polite">{weekLabel(week)}</span>
      <button aria-label="Next week" onClick={() => setWeek(dateAt(week, 7))}>
        <ChevronRight size={16} />
      </button>
      {week !== current && (
        <button className="today-btn" onClick={() => setWeek(current)}>
          This week
        </button>
      )}
    </div>
  );
}

export function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}

export function LoadGuard({ children }: { children: React.ReactNode }) {
  const { data, error, reload } = useApp();
  if (error)
    return (
      <EmptyState
        icon={<AlertTriangle size={20} />}
        title="We couldn’t load your workspace"
        action={
          <button className="btn primary" onClick={reload}>
            <RefreshCw size={15} /> Try again
          </button>
        }
      >
        {error}
      </EmptyState>
    );
  if (!data)
    return (
      <div className="panel">
        <Skeleton rows={5} />
      </div>
    );
  return children;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
  icon,
}: {
  tone?: "neutral" | "accent" | "positive" | "caution" | "negative";
  title?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const Icon =
    tone === "positive"
      ? CheckCircle2
      : tone === "negative"
        ? XCircle
        : tone === "caution"
          ? AlertTriangle
          : Info;
  return (
    <div
      className={`callout ${tone}`}
      role={tone === "negative" ? "alert" : undefined}
    >
      {icon ?? <Icon size={16} />}
      <div className="callout-body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function Modal({
  title,
  description,
  children,
  onClose,
  variant = "dialog",
  wide = false,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  variant?: "dialog" | "drawer";
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${variant === "drawer" ? "drawer" : ""} ${wide ? "wide" : ""}`}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2 id="modal-title">{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          className="icon-btn"
          aria-label="Close"
          onClick={() => close.current()}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <Callout tone="negative" title="That didn’t go through">
      {error}
    </Callout>
  ) : null;
}
export function NumberValue({ value }: { value: number }) {
  return <>{Number.isInteger(value) ? value : value.toFixed(1)}</>;
}
