import { NextResponse } from "next/server";
import { resolveSession, tenantCookie } from "@/lib/session";
import { getAuth } from "@/lib/auth";
import { localOnly } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!localOnly(request))
    return NextResponse.json(
      { error: "Local requests only." },
      { status: 403 },
    );
  try {
    const { session, actor, memberships } = await resolveSession(request);
    return NextResponse.json(
      {
        user: session
          ? {
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
            }
          : null,
        actor: actor
          ? {
              id: actor.id,
              name: actor.name,
              role: actor.role,
              tenantId: actor.tenantId,
              tenantName: actor.tenantName,
              email: actor.email,
            }
          : null,
        memberships: memberships.map((m) => ({
          id: m.id,
          tenantId: m.tenant_id,
          tenantName: m.tenant_name,
          role: m.role,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Local authentication or PostgreSQL is unavailable." },
      { status: 503 },
    );
  }
}
export async function DELETE(request: Request) {
  if (!localOnly(request))
    return NextResponse.json(
      { error: "Local requests only." },
      { status: 403 },
    );
  try {
    const url = new URL("/api/auth/sign-out", request.url);
    const headers = new Headers(request.headers);
    headers.set("Content-Type", "application/json");
    const result = await getAuth().handler(
      new Request(url, { method: "POST", headers, body: "{}" }),
    );
    const response = new NextResponse(await result.text(), {
      status: result.status,
      headers: result.headers,
    });
    response.cookies.delete(tenantCookie);
    return response;
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not sign out. Retry when the local database is available.",
      },
      { status: 503 },
    );
  }
}
