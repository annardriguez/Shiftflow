import { membershipNames } from "@/lib/database";
import { notificationFor } from "@/lib/workforce-types";
import { protectedRoute } from "@/lib/access";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { localOnly } from "@/lib/http";
import { requireActor, AccessError } from "@/lib/session";
import { readWorkspace } from "@/lib/store";
import {
  commandSchema,
  command,
  portal,
  replacements,
  assess,
} from "@/lib/workforce";
import { RevisionError, ValidationError } from "@/lib/mutations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function error(e: unknown) {
  return NextResponse.json(
    {
      error:
        e instanceof AccessError ||
        e instanceof RevisionError ||
        e instanceof ValidationError ||
        e instanceof ZodError
          ? e.message
          : "Could not complete the local workforce operation. No change was applied.",
    },
    {
      status:
        e instanceof AccessError
          ? e.status
          : e instanceof RevisionError
            ? 409
            : e instanceof ValidationError || e instanceof ZodError
              ? 422
              : 500,
    },
  );
}
async function handleGET(request: Request) {
  if (!localOnly(request))
    return NextResponse.json({ error: "Local demo only." }, { status: 403 });
  try {
    const actor = await requireActor(request),
      params = new URL(request.url).searchParams;
    let result;
    if (params.get("view") === "candidates") {
      const mode = params.get("mode") ?? "cover";
      if (!["cover", "swap"].includes(mode))
        throw new ValidationError("Unknown replacement mode.");
      result = await replacements(
        actor,
        params.get("week") ?? "",
        params.get("shiftId") ?? "",
        mode as "cover" | "swap",
      );
    } else if (params.get("view") === "assessment") {
      const id = params.get("id") ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(id))
        throw new ValidationError("Unknown request.");
      result = await assess(actor, id);
    } else if (actor.role === "employee") result = await portal(actor);
    else {
      const w = await readWorkspace();
      result = {
        revision: w.revision,
        requests: w.requests ?? [],
        notifications: (w.notifications ?? []).filter((n) =>
          notificationFor(n, actor),
        ),
        names: {
          ...(await membershipNames()),
          ...Object.fromEntries([
            ["demo-manager", "Jamie de Boer"],
            ["demo-manager-jamie", "Jamie de Boer"],
            ...w.employees.map((e) => [e.id, e.name]),
          ]),
        },
        externalSync: "not_connected",
      };
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return error(e);
  }
}
async function handlePOST(request: Request) {
  if (!localOnly(request))
    return NextResponse.json({ error: "Local demo only." }, { status: 403 });
  try {
    const actor = await requireActor(request);
    if (Number(request.headers.get("content-length") ?? 0) > 100000)
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
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
    }
    const w = await command(actor, commandSchema.parse(raw));
    return NextResponse.json({
      revision: w.revision,
      externalSync: "not_connected",
    });
  } catch (e) {
    return error(e);
  }
}

export const GET = protectedRoute("member", handleGET);
export const POST = protectedRoute("member", handlePOST);
