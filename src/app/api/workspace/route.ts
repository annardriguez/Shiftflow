import { protectedRoute } from "@/lib/access";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { mutateWorkspace, readWorkspace } from "@/lib/store";
import { RevisionError, ValidationError } from "@/lib/mutations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { localOnly } from "@/lib/http";
async function handleGET(request: Request) {
  if (!localOnly(request))
    return NextResponse.json(
      { error: "This demo is local-only." },
      { status: 403 },
    );
  try {
    return NextResponse.json(await readWorkspace(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not read the restaurant workspace. Check local PostgreSQL.",
      },
      { status: 500 },
    );
  }
}
async function handlePOST(request: Request) {
  if (!localOnly(request))
    return NextResponse.json(
      { error: "This demo accepts same-origin local requests only." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length") || 0) > 100000)
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  try {
    const text = await request.text();
    if (text.length > 100000)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    let input;
    try {
      input = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
    }
    return NextResponse.json(await mutateWorkspace(input));
  } catch (e) {
    if (e instanceof ZodError)
      return NextResponse.json(
        {
          error: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        { status: 422 },
      );
    if (e instanceof RevisionError)
      return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof ValidationError)
      return NextResponse.json({ error: e.message }, { status: 422 });
    return NextResponse.json(
      { error: "Could not save. Check local PostgreSQL and retry." },
      { status: 500 },
    );
  }
}

export const GET = protectedRoute("manager", handleGET);
export const POST = protectedRoute("manager", handlePOST);
