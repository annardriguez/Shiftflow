import { getAuth } from "@/lib/auth";
import { localOnly } from "@/lib/http";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const allowed = new Set([
  "sign-in/email",
  "sign-out",
  "get-session",
  "change-password",
  "revoke-session",
  "revoke-sessions",
  "list-sessions",
  "ok",
]);
async function handler(request: Request) {
  if (!localOnly(request))
    return NextResponse.json(
      { error: "Only same-origin loopback authentication is allowed." },
      { status: 403 },
    );
  const path = new URL(request.url).pathname.slice("/api/auth/".length);
  if (!allowed.has(path))
    return NextResponse.json(
      { error: "This authentication operation is not enabled." },
      { status: 404 },
    );
  try {
    const headers = new Headers(request.headers);
    headers.set("x-shiftflow-client-ip", "127.0.0.1");
    for (const h of ["x-forwarded-for", "x-real-ip", "forwarded"])
      headers.delete(h);
    let body: string | undefined;
    if (request.method === "POST") {
      if (Number(headers.get("content-length") || 0) > 12000)
        return NextResponse.json(
          { error: "Request too large." },
          { status: 413 },
        );
      body = await request.text();
      if (body.length > 12000)
        return NextResponse.json(
          { error: "Request too large." },
          { status: 413 },
        );
    }
    return await getAuth().handler(
      new Request(request.url, { method: request.method, headers, body }),
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Local authentication is unavailable. Check PostgreSQL and local service configuration.",
      },
      { status: 503 },
    );
  }
}
export const GET = handler;
export const POST = handler;
