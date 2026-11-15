import { protectedRoute } from "@/lib/access";
import { NextResponse } from "next/server";
import { localOnly } from "@/lib/http";
import { readWorkspace } from "@/lib/store";
import { engine, engineWorkspace } from "@/lib/engine-client";
import { toAssignments, type Report } from "@/lib/planning-types";
import { findShiftCover } from "@/lib/skills";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(request: Request) {
  if (!localOnly(request))
    return NextResponse.json(
      { error: "This demo is local-only." },
      { status: 403 },
    );
  const params = new URL(request.url).searchParams,
    week = params.get("week"),
    shiftId = params.get("shiftId");
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week) || !shiftId)
    return NextResponse.json(
      { error: "Select a saved shift and week." },
      { status: 400 },
    );
  try {
    const w = await readWorkspace();
    if (
      !w.weeks.some(
        (x) => x.start === week && x.shifts.some((s) => s.id === shiftId),
      )
    )
      return NextResponse.json(
        { error: "Shift no longer exists in this week." },
        { status: 404 },
      );
    const assessment = findShiftCover(w, week, shiftId);
    const roster = w.weeks.find((x) => x.start === week)!;
    if (roster.provenance || roster.validationPolicy === "full-engine") {
      const snapshot = await engine("workspace-snapshot", {
        fictional_data: true,
        rules_verified_for_demo: true,
        workspace: engineWorkspace(w),
        week_start: week,
      });
      const original = roster.shifts.find((s) => s.id === shiftId)!;
      for (const candidate of assessment.candidates.filter((c) => c.eligible)) {
        const proposed = roster.shifts.map((s) =>
          s.id === shiftId
            ? { ...original, employeeId: candidate.employeeId }
            : s,
        );
        const report = await engine<Report>("validate", {
          snapshot,
          assignments: toAssignments(proposed),
        });
        if (!report.valid) {
          candidate.eligible = false;
          candidate.reasons.push(...report.issues.map((i) => i.message));
        }
      }
      assessment.candidates.sort(
        (a, b) =>
          Number(b.eligible) - Number(a.eligible) ||
          a.preferenceDistance - b.preferenceDistance,
      );
      assessment.scope += " · complete engine policy revalidated";
    }
    return NextResponse.json(assessment, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not assess cover. No eligibility decision is available; retry.",
      },
      { status: 500 },
    );
  }
}

export const GET = protectedRoute("manager", handleGET);
