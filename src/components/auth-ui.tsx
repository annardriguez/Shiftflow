"use client";
import { useState } from "react";
import { useApp } from "./provider";
import { ErrorBox, Modal } from "./ui";
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
    } finally {
      setBusy(false);
    }
  }
  if (!authLoaded)
    return (
      <div className="empty-state" role="status">
        Opening ShiftFlow…
      </div>
    );
  return (
    <div className="sign-in-shell">
      <div className="sign-in-card panel">
        <div className="brand">
          shiftflow<span>.</span>
        </div>
        <div className="eyebrow">LOCAL WORKSPACE · FICTIONAL DATA</div>
        <h1>{user ? "Choose your restaurant." : "Welcome back."}</h1>
        <p>
          {user
            ? "Access comes from your assigned restaurant membership."
            : "Sign in to see your roster and requests."}
        </p>
        <ErrorBox error={failure || error} />
        {user ? (
          <>
            <p>{user.email}</p>
            {memberships.map((m) => (
              <button
                key={m.id}
                className="btn full-width"
                onClick={() =>
                  selectTenant(m.tenantId).catch((e) => setFailure(e.message))
                }
              >
                {m.tenantName} · {m.role}
              </button>
            ))}
            {!memberships.length && (
              <p>
                No active restaurant membership is assigned. Contact the local
                administrator.
              </p>
            )}
            <button
              className="btn full-width"
              onClick={() => signOut().catch((e) => setFailure(e.message))}
            >
              Sign out
            </button>
          </>
        ) : (
          <form className="editor-form" onSubmit={submit}>
            <label>
              Email
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
            <button className="btn primary full-width" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
        <p className="form-hint">
          Accounts are provisioned locally. Use the supplied fictional account
          credentials. No public registration or external scheduling connection.
        </p>
        {error && (
          <button className="btn" onClick={reload}>
            Retry connection
          </button>
        )}
      </div>
    </div>
  );
}
export function AccountMenu() {
  const { actor, user, memberships, selectTenant, signOut } = useApp();
  const [error, setError] = useState(""),
    [password, setPassword] = useState(false);
  return (
    <div className="account-menu">
      <div className="account-identity">
        <strong>{actor?.name}</strong>
        <small>
          {actor?.role} · {user?.email}
        </small>
      </div>
      <label className="restaurant-select">
        Restaurant
        <select
          aria-label="Restaurant"
          value={actor?.tenantId ?? ""}
          disabled={memberships.length < 2}
          onChange={(e) =>
            selectTenant(e.target.value).catch((e) => setError(e.message))
          }
        >
          {memberships.map((m) => (
            <option key={m.id} value={m.tenantId}>
              {m.tenantName} · {m.role}
            </option>
          ))}
        </select>
      </label>
      <button className="text-link" onClick={() => setPassword(true)}>
        Password
      </button>
      <button
        className="btn"
        onClick={() => signOut().catch((e) => setError(e.message))}
      >
        Sign out
      </button>
      {error && <span role="alert">{error}</span>}
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
      description="A new password signs out your other sessions."
      onClose={onClose}
    >
      {done ? (
        <div className="info-box" role="status">
          Password changed. Your other sessions have been revoked.
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
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? "Changing…" : "Change password"}
          </button>
        </form>
      )}
    </Modal>
  );
}
