import { runtimeConfig } from "./runtime-config";
import { ValidationError } from "./mutations";
export async function engine<T>(endpoint: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:8000/v1/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-shiftflow-engine-key": runtimeConfig().engineToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(65000),
      cache: "no-store",
    });
  } catch {
    throw new ValidationError(
      "The local engine is unavailable or timed out. Start npm run engine:dev and try again. Your saved roster is unchanged.",
    );
  }
  const value = await response.json();
  if (!response.ok)
    throw new ValidationError(
      response.status === 429
        ? "The engine is busy. Try again after the current run finishes."
        : `Engine rejected this request: ${JSON.stringify(value.detail ?? value).slice(0, 1500)}`,
    );
  return value as T;
}

/** Send operational inputs only; request/audit history must not inflate solver payloads. */
export function engineWorkspace(w: import("./types").Workspace) {
  return {
    schemaVersion: w.schemaVersion,
    revision: w.revision,
    scenario: w.scenario,
    restaurant: w.restaurant,
    employees: w.employees,
    weeks: w.weeks.map(({ start, budgets, shifts }) => ({
      start,
      budgets,
      shifts,
    })),
  };
}
