"use client";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  KeyRound,
  LogOut,
  Store,
  ArrowRight,
  LoaderCircle,
  FlaskConical,
} from "lucide-react";
import { useApp } from "./provider";
import { Avatar, Brand, Callout, ErrorBox, Modal } from "./ui";

async function authPost(path: string, body: unknown) {
  const response = await fetch("/api/auth/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.message ?? value.error ?? "Authentication failed.");
  return value;
}

function short(name: string) {
  return name.split("·")[0].trim();
}
function place(name: string) {
  return name.split("·")[1]?.trim() ?? "";
}

/** Decorative, data-free illustration of a roster for the sign-in page. */
function RosterArt() {
  const rows: [string, string, number, number, string][] = [
    ["Opening", "opening", 0, 46, "10:00–16:30"],
    ["Midday", "midday", 18, 46, "12:00–18:00"],
    ["Closing", "closing", 50, 50, "16:30–23:00"],
    ["Closing", "closing", 54, 46, "17:00–23:00"],
  ];
  return (
    <div className="art-roster" aria-hidden="true">
      <div className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <strong>Today’s line-up</strong>
          <span className="status-pill positive">Fully covered</span>
        </div>
        {rows.map(([label, kind, left, width, t], i) => (
          <div className="lineup-track" key={i} style={{ height: 30 }}>
            <span
              className={`lineup-bar ${kind}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              {t} · {label}
            </span>
          </div>
        ))}
      </div>
      <div
        className="panel"
        style={{
          padding: 14,
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginLeft: 48,
          boxShadow: "var(--shadow-md)",
        }}
      >
        <span className="avatar sage">SB</span>
        <div style={{ display: "grid", gap: 2, flex: 1 }}>
          <strong>Sofia can cover Friday’s close</strong>
          <small style={{ color: "var(--muted)" }}>
            Available · Can close · No conflicting shift
          </small>
        </div>
        <span className="status-pill caution">Awaiting approval</span>
      </div>
      <p
        style={{
          color: "var(--muted)",
          fontSize: 13,
          maxWidth: 380,
          marginTop: 12,
        }}
      >
        Smarter shifts. Simpler swaps. Every replacement is checked against
        availability, skills and working-time rules before anyone is asked.
      </p>
    </div>
  );
}

export function AuthGate() {
  const {
    authLoaded,
    user,
    memberships,
    selectTenant,
    error,
    reload,
    signOut,
  } = useApp();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure("");
    try {
      await authPost("sign-in/email", { email, password });
      setPassword("");
      window.location.assign("/");
    } catch (e) {
      setFailure((e as Error).message);
      setBusy(false);
    }
  }
  if (!authLoaded)
    return (
      <div className="loading" role="status">
        <LoaderCircle className="spin" size={20} /> Opening ShiftFlow…
      </div>
    );
  return (
    <div className="sign-in-shell">
      <div className="sign-in-side">
        <div className="sign-in-card">
          <Brand />
          <div style={{ display: "grid", gap: 6 }}>
            <h1>{user ? "Choose a restaurant" : "Sign in to ShiftFlow"}</h1>
            <p style={{ color: "var(--muted)" }}>
              {user
                ? `Signed in as ${user.email}. Your access is set per restaurant.`
                : "Your roster, swaps and requests in one place."}
            </p>
          </div>
          <ErrorBox error={failure || error} />
          {user ? (
            <>
              <div className="membership-list">
                {memberships.map((m) => (
                  <button
                    key={m.id}
                    className="membership"
                    onClick={() =>
                      selectTenant(m.tenantId).catch((e) =>
                        setFailure(e.message),
                      )
                    }
                  >
                    <span className="ws-mark">{short(m.tenantName)[0]}</span>
                    <span>
                      <strong>{short(m.tenantName)}</strong>
                      <small>
                        {place(m.tenantName) && `${place(m.tenantName)} · `}
                        {m.role}
                      </small>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
              {!memberships.length && (
                <Callout tone="caution" title="No restaurant access yet">
                  Ask your administrator to add you to a restaurant.
                </Callout>
              )}
              <button
                className="btn ghost"
                onClick={() => signOut().catch((e) => setFailure(e.message))}
              >
                <LogOut size={15} /> Sign out
              </button>
            </>
          ) : (
            <form className="editor-form" onSubmit={submit}>
              <label>
                Work email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={200}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button
                className="btn primary large full-width"
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? (
                  <>
                    <LoaderCircle className="spin" size={16} /> Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </button>
            </form>
          )}
          <div className="data-note">
            <FlaskConical size={14} />
            <span>
              <strong>Demo environment.</strong> Restaurants, people and
              shifts are fictional. Accounts are created by an administrator;
              there is no public sign-up.
            </span>
          </div>
          {error && (
            <button className="btn" onClick={reload}>
              Retry connection
            </button>
          )}
        </div>
      </div>
      <div className="sign-in-art">
        <RosterArt />
      </div>
    </div>
  );
}

/** Topbar identity menu: restaurant switching, password and sign-out. */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { actor, user, memberships, selectTenant, signOut } = useApp();
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [password, setPassword] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!actor) return null;
  return (
    <div className="user-menu" ref={ref}>
      <button
        className="user-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Avatar employee={{ name: actor.name, color: "navy" }} small />
        {!compact && (
          <span className="who">
            <strong>{actor.name}</strong>
            <small>{actor.role === "manager" ? "Manager" : "Team member"}</small>
          </span>
        )}
        <ChevronDown size={14} color="var(--muted)" />
      </button>
      {open && (
        <div className="popover" role="menu">
          <div className="popover-section">
            <strong>{actor.name}</strong>
            <small style={{ display: "block", color: "var(--muted)" }}>
              {user?.email}
            </small>
          </div>
          <div className="popover-section" style={{ padding: 4 }}>
            <div className="nav-label" style={{ padding: "6px 10px 4px" }}>
              Restaurant
            </div>
            {memberships.map((m) => (
              <button
                key={m.id}
                role="menuitemradio"
                aria-checked={m.tenantId === actor.tenantId}
                className={`menu-item ${m.tenantId === actor.tenantId ? "selected" : ""}`}
                onClick={() =>
                  m.tenantId === actor.tenantId
                    ? setOpen(false)
                    : selectTenant(m.tenantId).catch((e) =>
                        setError(e.message),
                      )
                }
              >
                <Store size={15} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  {short(m.tenantName)}
                  <small
                    style={{
                      display: "block",
                      color: "var(--muted)",
                      textTransform: "capitalize",
                    }}
                  >
                    {m.role}
                  </small>
                </span>
                {m.tenantId === actor.tenantId && (
                  <Check size={15} className="check" />
                )}
              </button>
            ))}
          </div>
          <div className="popover-section" style={{ padding: 4 }}>
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setPassword(true);
                setOpen(false);
              }}
            >
              <KeyRound size={15} /> Change password
            </button>
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => signOut().catch((e) => setError(e.message))}
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>
          {error && (
            <div className="popover-section">
              <ErrorBox error={error} />
            </div>
          )}
        </div>
      )}
      {password && <PasswordDialog onClose={() => setPassword(false)} />}
    </div>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Change password"
      description="Changing your password signs you out on other devices."
      onClose={onClose}
    >
      {done ? (
        <div className="modal-body" style={{ padding: 0, display: "grid", gap: 14 }}>
          <Callout tone="positive" title="Password changed">
            You’ve been signed out everywhere else.
          </Callout>
          <div className="modal-actions">
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form
          className="editor-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await authPost("change-password", {
                currentPassword: current,
                newPassword: next,
                revokeOtherSessions: true,
              });
              setCurrent("");
              setNext("");
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <ErrorBox error={error} />
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <span className="form-hint">At least 12 characters.</span>
          </label>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
