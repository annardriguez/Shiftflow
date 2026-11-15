let tenant: string | null = null,
  role: string | null = null;
export function setClientTenant(
  value: string | null,
  currentRole: string | null = null,
) {
  tenant = value;
  role = currentRole;
}
export async function workspaceFetch(input: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (tenant) headers.set("x-shiftflow-tenant", tenant);
  const response = await fetch(input, { ...init, headers });
  const changed =
    response.headers.get("x-shiftflow-context-changed") === "1" ||
    !!(
      role &&
      response.headers.get("x-shiftflow-role") &&
      response.headers.get("x-shiftflow-role") !== role
    );
  if (
    typeof window !== "undefined" &&
    (changed || response.status === 401 || response.status === 403)
  ) {
    window.location.replace("/sign-in");
    throw new Error(
      "Your access or restaurant context changed. Reloading the signed-in workspace.",
    );
  }
  return response;
}
