"use client";
import { workspaceFetch, setClientTenant } from "@/lib/workspace-fetch";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { DemoActor } from "@/lib/workforce-types";
import type { Mutation, Workspace } from "@/lib/types";
import { BASE_WEEK } from "@/lib/schedule";
interface Context {
  actor: DemoActor | null;
  memberships: {
    id: string;
    tenantId: string;
    tenantName: string;
    role: string;
  }[];
  user: { id: string; name: string; email: string } | null;
  authLoaded: boolean;
  selectTenant: (id: string) => Promise<void>;
  signOut: () => Promise<void>;
  data: Workspace | null;
  error: string;
  saving: boolean;
  week: string;
  setWeek: (v: string) => void;
  mutate: (m: Mutation) => Promise<void>;
  notify: (s: string, tone?: "success" | "error") => void;
  reload: () => void;
}
const AppContext = createContext<Context | null>(null);
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [actor, setActor] = useState<DemoActor | null>(null),
    [memberships, setMemberships] = useState<
      { id: string; tenantId: string; tenantName: string; role: string }[]
    >([]),
    [user, setUser] = useState<{
      id: string;
      name: string;
      email: string;
    } | null>(null),
    [authLoaded, setAuthLoaded] = useState(false);
  const [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [week, setWeek] = useState(BASE_WEEK),
    [toast, setToastState] = useState<{
      message: string;
      tone: "success" | "error";
      id: number;
    } | null>(null);
  const setToast = useCallback(
    (message: string, tone: "success" | "error" = "success") =>
      setToastState(
        message ? { message, tone, id: Date.now() + Math.random() } : null,
      ),
    [],
  );
  const reload = useCallback(() => {
    fetch("/api/session")
      .then(async (r) => {
        const session = await r.json();
        if (!r.ok) throw new Error(session.error);
        setActor(session.actor);
        setMemberships(session.memberships);
        setUser(session.user);
        setClientTenant(
          session.actor?.tenantId ?? null,
          session.actor?.role ?? null,
        );
        setError("");
        if (!session.actor || session.actor.role === "employee") {
          setData(null);
          return;
        }
        const response = await workspaceFetch("/api/workspace");
        const workspace = await response.json();
        if (!response.ok) throw new Error(workspace.error);
        setData(workspace);
      })
      .catch((e) => setError(e.message))
      .finally(() => setAuthLoaded(true));
  }, []);
  async function selectTenant(tenantId: string) {
    const response = await fetch("/api/session/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    window.location.assign(
      value.role === "manager" ? "/" : "/employee",
    );
  }
  async function signOut() {
    const response = await fetch("/api/session", { method: "DELETE" });
    if (!response.ok) throw new Error("Could not sign out. Retry.");
    setClientTenant(null);
    window.location.assign("/sign-in");
  }
  useEffect(reload, [reload]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToastState(null), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function mutate(m: Mutation) {
    if (!data) throw new Error("Workspace is still loading.");
    setSaving(true);
    try {
      const r = await workspaceFetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...m, revision: data.revision }),
      });
      const body = await r.json();
      if (!r.ok) {
        if (r.status === 409) reload();
        throw new Error(body.error);
      }
      setData(body);
      setToast("Changes saved");
    } finally {
      setSaving(false);
    }
  }
  return (
    <AppContext.Provider
      value={{
        actor,
        user,
        memberships,
        authLoaded,
        selectTenant,
        signOut,
        data,
        error,
        saving,
        week,
        setWeek,
        mutate,
        notify: setToast,
        reload,
      }}
    >
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div
            key={toast.id}
            className={`toast ${toast.tone === "error" ? "error" : ""}`}
          >
            {toast.tone === "error" ? (
              <AlertCircle size={17} />
            ) : (
              <CheckCircle2 size={17} />
            )}
            {toast.message}
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppProvider required");
  return ctx;
}
