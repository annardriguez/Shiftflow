import { NextResponse } from "next/server";
import { localOnly } from "./http";
import { requireActor } from "./session";
import { withActor, AccessError, type Actor } from "./auth-context";
export function protectedRoute(
  role: "manager" | "member",
  handler: (request: Request, actor: Actor) => Promise<Response>,
) {
  return async (request: Request) => {
    if (!localOnly(request))
      return NextResponse.json(
        { error: "Only same-origin loopback requests are allowed." },
        { status: 403 },
      );
    try {
      if (request.method !== "GET") {
        const text = await request.clone().text();
        if (text.length > 100000)
          return NextResponse.json(
            { error: "Request too large." },
            { status: 413 },
          );
        try {
          const body = JSON.parse(text);
          if (
            body &&
            typeof body === "object" &&
            ["tenantId", "tenant_id", "userId", "actorId", "role"].some(
              (k) => k in body,
            )
          )
            throw new AccessError(
              "Identity, role and tenant scope are derived from your authenticated membership.",
            );
        } catch (e) {
          if (e instanceof AccessError) throw e;
        }
      }
      const actor = await requireActor(request);
      if (role === "manager" && actor.role !== "manager")
        throw new AccessError("Manager access is required.");
      const expected = request.headers.get("x-shiftflow-tenant");
      if (expected && expected !== actor.tenantId)
        return NextResponse.json(
          {
            error: "Restaurant selection changed. Reload before continuing.",
            code: "TENANT_CONTEXT_CHANGED",
          },
          { status: 409, headers: { "x-shiftflow-context-changed": "1" } },
        );
      if (request.method !== "GET" && !expected)
        throw new AccessError(
          "A matching restaurant context header is required.",
        );
      const response = await withActor(actor, () => handler(request, actor));
      response.headers.set("x-shiftflow-role", actor.role);
      response.headers.set("x-shiftflow-tenant", actor.tenantId);
      return response;
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof AccessError
              ? e.message
              : "The local database or authentication service is unavailable.",
        },
        { status: e instanceof AccessError ? e.status : 503 },
      );
    }
  };
}
