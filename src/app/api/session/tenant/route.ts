import { NextResponse } from "next/server";
import { sessionInfo, tenantCookie } from "@/lib/session";
import { localOnly, publicOrigin } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!localOnly(request))
    return NextResponse.json(
      { error: "Local requests only." },
      { status: 403 },
    );
  try {
    const text = await request.text();
    if (text.length > 1000)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const body = JSON.parse(text);
    if (Object.keys(body).some((k) => k !== "tenantId"))
      return NextResponse.json(
        { error: "Only tenantId may be selected." },
        { status: 422 },
      );
    const { session, memberships } = await sessionInfo(request);
    if (!session)
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const member = memberships.find((m) => m.tenant_id === body.tenantId);
    if (!member)
      return NextResponse.json(
        { error: "No active membership in that restaurant." },
        { status: 403 },
      );
    const response = NextResponse.json({
      tenantId: member.tenant_id,
      role: member.role,
    });
    response.cookies.set(tenantCookie, member.tenant_id, {
      httpOnly: true,
      sameSite: "strict",
      secure: !!publicOrigin(),
      path: "/",
      maxAge: 28800,
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: "Could not select restaurant." },
      { status: 400 },
    );
  }
}
