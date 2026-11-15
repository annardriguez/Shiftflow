import type { Workspace } from "./types";
import { defaultSkillRules } from "./skills";
/** Preserve legacy edits. Never infer verified qualifications from roles/eligibility. */
export function migrateWorkspace(
  input: unknown,
  now = new Date().toISOString(),
): Workspace {
  if (!input || typeof input !== "object") throw new Error("Invalid workspace");
  const legacy = input as Workspace & { schemaVersion: number };
  if (Number(legacy.schemaVersion) === 2) return legacy;
  if (Number(legacy.schemaVersion) !== 1)
    throw new Error("Unsupported workspace version");
  return {
    ...legacy,
    schemaVersion: 2,
    restaurant: { ...legacy.restaurant, skillRules: defaultSkillRules() },
    employees: legacy.employees.map((e) => ({
      ...e,
      competencies: [],
      supervisionSkillId: null,
      skillsReviewedAt: null,
    })),
    audit: [
      {
        id: "skill-migration-v2",
        at: now,
        actorId: "system",
        details: { from: 1, to: 2 },
        message:
          "Upgraded to skill-aware schema. Existing data preserved; legacy qualifications require manager review.",
      },
      ...legacy.audit,
    ],
  };
}
