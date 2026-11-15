import { protectedRoute } from "@/lib/access";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { localOnly } from "@/lib/http";
import { planningSchema, plan, listRuns } from "@/lib/planning";
import { RevisionError, ValidationError } from "@/lib/mutations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(request: Request) {
  if (!localOnly(request))
    return NextResponse.json(
      { error: "Local requests only." },
      { status: 403 },
    );
  try {
    return NextResponse.json(await listRuns(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not read local run history." },
      { status: 500 },
    );
  }
}
async function handlePOST(request: Request) {
  if (!localOnly(request))
    return NextResponse.json(
      { error: "Local requests only." },
      { status: 403 },
    );
  try {
    if (Number(request.headers.get("content-length") || 0) > 100000)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const text = await request.text();
    if (text.length > 100000)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
    }
    return NextResponse.json(await plan(planningSchema.parse(body)));
  } catch (e) {
    const status =
      e instanceof RevisionError
        ? 409
        : e instanceof ZodError || e instanceof ValidationError
          ? 422
          : 500;
    return NextResponse.json(
      {
        error:
          status === 500
            ? "Could not complete the local planning operation. Your saved roster is unchanged."
            : (e as Error).message,
      },
      { status },
    );
  }
}

export const GET = protectedRoute("manager", handleGET);
export const POST = protectedRoute("manager", handlePOST);
