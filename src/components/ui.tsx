"use client";
import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, X, LoaderCircle } from "lucide-react";
import { useApp } from "./provider";
import { dateAt, weekLabel } from "@/lib/schedule";
import type { Employee } from "@/lib/types";
export function Avatar({
  employee,
  small = false,
}: {
  employee: Pick<Employee, "name" | "color">;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${employee.color} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {employee.name
        .split(" ")
        .filter((_, i, a) => i === 0 || i === a.length - 1)
        .map((s) => s[0])
        .join("")}
    </span>
  );
}
export function Badge({
  children,
  tone = "sage",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function WeekPicker() {
  const { week, setWeek } = useApp();
  return (
    <div className="week-picker">
      <button
        aria-label="Previous week"
        onClick={() => setWeek(dateAt(week, -7))}
      >
        <ArrowLeft size={15} />
      </button>
      <span>{weekLabel(week)}</span>
      <button aria-label="Next week" onClick={() => setWeek(dateAt(week, 7))}>
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
export function LoadGuard({ children }: { children: React.ReactNode }) {
  const { data, error, reload } = useApp();
  if (error)
    return (
      <div className="empty-state">
        <h2>Let’s reconnect your workspace</h2>
        <p>{error}</p>
        <button className="btn primary" onClick={reload}>
          Try again
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="loading">
        <LoaderCircle className="spin" size={25} /> Getting your workspace
        ready…
      </div>
    );
  return children;
}
export function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2 id="modal-title">{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          className="icon-btn"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div className="error-box" role="alert">
      {error}
    </div>
  ) : null;
}
export function NumberValue({ value }: { value: number }) {
  return <>{Number.isInteger(value) ? value : value.toFixed(1)}</>;
}
