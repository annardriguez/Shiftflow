"use client";
import { useCallback, useEffect, useState } from "react";
import { workspaceFetch } from "./workspace-fetch";
import type {
  LocalNotification,
  WorkforceRequest,
} from "./workforce-types";

export async function api<T = any>(url: string, body?: unknown): Promise<T> {
  const r = await workspaceFetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}

export interface ManagerFeed {
  revision: number;
  requests: WorkforceRequest[];
  notifications: LocalNotification[];
  names: Record<string, string>;
}

/** Manager request/notification feed. `version` lets callers force a refetch. */
export function useManagerFeed(enabled = true, version = 0) {
  const [feed, setFeed] = useState<ManagerFeed | null>(null),
    [error, setError] = useState("");
  const load = useCallback(() => {
    if (!enabled) return;
    api<ManagerFeed>("/api/workforce")
      .then((f) => {
        setFeed(f);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [enabled]);
  useEffect(() => {
    load();
  }, [load, version]);
  return { feed, error, setError, load };
}

/** Action label used in user-facing feedback. */
export const ACTION_DONE: Record<string, string> = {
  accept: "You accepted the shift. It’s now with your manager for approval.",
  decline: "You declined the request.",
  cancel: "Request cancelled.",
  approve: "Approved and applied to the roster.",
  reject: "Request rejected. The roster is unchanged.",
};
