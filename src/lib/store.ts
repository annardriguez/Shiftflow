import { migrateWorkspace } from "./migrate";
import { applyMutation, RevisionError, ValidationError } from "./mutations";
import { engine, engineWorkspace } from "./engine-client";
import { toAssignments, type Report } from "./planning-types";
import { tenantTransaction } from "./database";
import { actorContext, AccessError } from "./auth-context";
import type { MutationRequest, Workspace } from "./types";
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
export async function readWorkspace() {
  return tenantTransaction(async (c) => {
    const r = await c.query(
      "SELECT payload FROM app.workspaces WHERE tenant_id=$1",
      [actorContext().tenantId],
    );
    if (!r.rowCount)
      throw new AccessError("Restaurant workspace is unavailable.");
    return migrateWorkspace(r.rows[0].payload);
  });
}
export async function transactWorkspace(
  update: (current: Workspace) => Workspace | Promise<Workspace>,
): Promise<Workspace> {
  return tenantTransaction(async (c) => {
    const actor = actorContext(),
      row = await c.query(
        "SELECT payload FROM app.workspaces WHERE tenant_id=$1 FOR UPDATE",
        [actor.tenantId],
      );
    if (!row.rowCount)
      throw new AccessError("Restaurant workspace is unavailable.");
    const current = migrateWorkspace(row.rows[0].payload),
      next = await update(structuredClone(current));
    next.tenantId = actor.tenantId;
    if (next.revision !== current.revision + 1)
      throw new RevisionError("Workspace revision must advance exactly once.");
    const oldEvents = new Map(current.audit.map((e) => [e.id, e]));
    for (const [id, event] of oldEvents) {
      if (canonical(next.audit.find((e) => e.id === id)) !== canonical(event))
        throw new ValidationError(
          "Existing audit history cannot be removed or changed.",
        );
    }
    for (const old of current.requests ?? []) {
      const newer = next.requests?.find((r) => r.id === old.id);
      if (
        !newer ||
        canonical(newer.history.slice(0, old.history.length)) !==
          canonical(old.history)
      )
        throw new ValidationError(
          "Existing request history cannot be removed or changed.",
        );
    }
    for (const event of next.audit.filter((e) => !oldEvents.has(e.id)))
      event.actorId = actor.id;
    await c.query(
      "UPDATE app.workspaces SET revision=$1,payload=$2 WHERE tenant_id=$3",
      [next.revision, JSON.stringify(next), actor.tenantId],
    );
    for (const event of next.audit.filter((e) => !oldEvents.has(e.id)))
      await c.query(
        "INSERT INTO app.audit_events(tenant_id,id,at,actor_user_id,payload) VALUES($1,$2,$3,$4,$5)",
        [
          actor.tenantId,
          event.id,
          event.at,
          actor.userId,
          JSON.stringify({
            ...event,
            actorUserId: actor.userId,
            membershipId: actor.membershipId,
          }),
        ],
      );
    for (const request of next.requests ?? []) {
      const before =
        current.requests?.find((r) => r.id === request.id)?.history.length ?? 0;
      for (let i = before; i < request.history.length; i++)
        await c.query(
          "INSERT INTO app.request_events(tenant_id,request_id,event_index,payload) VALUES($1,$2,$3,$4)",
          [actor.tenantId, request.id, i, JSON.stringify(request.history[i])],
        );
    }
    return next;
  });
}

export function mutateWorkspace(input: MutationRequest) {
  if (actorContext().role !== "manager")
    throw new AccessError("Manager access is required.");
  return transactWorkspace(async (current) => {
    const next = applyMutation(
      current,
      input,
      new Date().toISOString(),
      actorContext().id,
    );
    if (input.type === "shift" || input.type === "delete-shift") {
      const roster = next.weeks.find((w) => w.start === input.week);
      if (
        roster &&
        (roster.provenance || roster.validationPolicy === "full-engine")
      ) {
        const snapshot = await engine("workspace-snapshot", {
          fictional_data: true,
          rules_verified_for_demo: true,
          workspace: engineWorkspace(next),
          week_start: input.week,
        });
        const report = await engine<Report>("validate", {
          snapshot,
          assignments: toAssignments(roster.shifts),
        });
        if (!report.valid)
          throw new ValidationError(
            report.issues
              .map((i) => `${i.day ?? ""} ${i.message}`)
              .join("; ")
              .slice(0, 4000),
          );
      }
    }
    return next;
  });
}
