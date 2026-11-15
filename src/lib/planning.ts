import { engine, engineWorkspace } from "./engine-client";
import { tenantTransaction } from "./database";
import { actorContext } from "./auth-context";
import { z } from "zod";
import { shiftSchema, RevisionError, ValidationError } from "./mutations";
import { readWorkspace, transactWorkspace } from "./store";
import {
  toAssignments,
  toShifts,
  type PlanningRun,
  type Report,
  type Alternative,
} from "./planning-types";
import type { Shift } from "./types";
export const planningSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate"),
    week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    revision: z.number().int().min(0),
    seconds: z.number().int().min(4).max(15),
  }),
  z.object({
    action: z.enum(["validate", "save"]),
    id: z.string().uuid(),
    strategy: z.enum(["budget-first", "balanced", "coverage-first"]),
    shifts: z.array(shiftSchema).max(210),
  }),
]);
interface StoredRun extends PlanningRun {
  snapshot: Record<string, unknown>;
  snapshotId: string;
}
function publicRun(r: StoredRun): PlanningRun {
  return {
    id: r.id,
    week: r.week,
    revision: r.revision,
    createdAt: r.createdAt,
    alternatives: r.alternatives,
  };
}
async function persist(run: StoredRun) {
  return tenantTransaction(async (c) => {
    await c.query(
      "INSERT INTO app.schedule_runs(tenant_id,id,payload,created_at) VALUES($1,$2,$3,$4)",
      [actorContext().tenantId, run.id, JSON.stringify(run), run.createdAt],
    );
  }, true);
}
async function loadRun(id: string): Promise<StoredRun> {
  return tenantTransaction(async (c) => {
    const r = await c.query(
      "SELECT payload FROM app.schedule_runs WHERE tenant_id=$1 AND id=$2",
      [actorContext().tenantId, z.string().uuid().parse(id)],
    );
    if (!r.rowCount)
      throw new ValidationError(
        "Run is not available in this restaurant. Generate a new comparison.",
      );
    return r.rows[0].payload;
  }, true);
}
export async function listRuns() {
  return tenantTransaction(
    async (c) =>
      (
        await c.query(
          "SELECT payload FROM app.schedule_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20",
          [actorContext().tenantId],
        )
      ).rows.map((r) => publicRun(r.payload)),
    true,
  );
}
export async function plan(input: z.infer<typeof planningSchema>) {
  if (input.action === "generate") {
    const workspace = await readWorkspace();
    if (workspace.revision !== input.revision)
      throw new RevisionError("Workspace changed. Reload before generating.");
    const snapshot = await engine<Record<string, unknown>>(
      "workspace-snapshot",
      {
        fictional_data: true,
        rules_verified_for_demo: true,
        workspace: engineWorkspace(workspace),
        week_start: input.week,
      },
    );
    const response = await engine<{
      run_id: string;
      created_at: string;
      input_snapshot_id: string;
      alternatives: Alternative[];
    }>("schedule-runs", {
      snapshot,
      strategies: ["budget-first", "balanced", "coverage-first"],
      options: { max_seconds_per_strategy: input.seconds },
    });
    const run: StoredRun = {
      id: response.run_id,
      week: input.week,
      revision: workspace.revision,
      createdAt: response.created_at,
      snapshot,
      snapshotId: response.input_snapshot_id,
      alternatives: response.alternatives,
    };
    await persist(run);
    return publicRun(run);
  }
  const run = await loadRun(input.id),
    alternative = run.alternatives.find((a) => a.strategy === input.strategy);
  if (
    !alternative ||
    !["FEASIBLE", "OPTIMAL"].includes(alternative.status) ||
    !alternative.validation?.valid
  )
    throw new ValidationError(
      "Choose an independently validated feasible alternative.",
    );
  const check = async (revision: number) => {
    if (revision !== run.revision)
      throw new RevisionError(
        "Workspace changed since this run. Generate again using the current availability, skills, budgets and adjacent weeks.",
      );
    return engine<Report>("validate", {
      snapshot: run.snapshot,
      assignments: toAssignments(input.shifts as Shift[]),
    });
  };
  if (input.action === "validate")
    return check((await readWorkspace()).revision);
  return transactWorkspace(async (current) => {
    const report = await check(current.revision);
    if (!report.valid)
      throw new ValidationError(
        report.issues
          .map((i) => `${i.day ?? ""} ${i.message}`)
          .join("; ")
          .slice(0, 4000),
      );
    const next = structuredClone(current),
      old = next.weeks.find((w) => w.start === run.week);
    const edited =
      JSON.stringify(toAssignments(input.shifts)) !==
      JSON.stringify(toAssignments(toShifts(alternative.assignments)));
    const provenance = {
      runId: run.id,
      strategy: input.strategy,
      savedAt: new Date().toISOString(),
      edited,
      snapshotId: run.snapshotId,
    };
    const week = {
      start: run.week,
      budgets: (run.snapshot.budgets as { paid_units: number }[]).map(
        (b) => b.paid_units / 2,
      ),
      shifts: input.shifts,
      provenance,
    };
    if (old) next.weeks[next.weeks.indexOf(old)] = week;
    else next.weeks.push(week);
    next.revision++;
    next.audit.unshift({
      id: crypto.randomUUID(),
      at: provenance.savedAt,
      actorId: actorContext().id,
      message: `Saved ${input.strategy} ${edited ? "edited " : ""}draft for ${run.week}; Strobbo not connected.`,
      details: {
        ...provenance,
        previousShifts: old?.shifts ?? [],
        newShifts: week.shifts,
      },
    });
    return next;
  });
}
