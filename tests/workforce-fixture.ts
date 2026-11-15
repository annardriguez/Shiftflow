import { seed } from "../src/lib/seed";
import { dateAt } from "../src/lib/schedule";
import type { Workspace } from "../src/lib/types";
/** Small, fully qualified fictional week with deliberate room for eligible replacements. */
export function workflowFixture(): Workspace {
  const w = seed();
  w.employees = w.employees
    .slice(0, 4)
    .map((e) => ({
      ...e,
      availability: Array.from({ length: 7 }, () => ({
        start: 600,
        end: 1380,
      })),
      availabilityOverrides: [],
      absentDates: [],
      eligible: ["Opening", "Midday", "Closing"],
      maxHours: 60,
      preferredHours: 24,
      minRestHours: 11,
      maxShiftHours: 9,
      supervisionSkillId: null,
      skillsReviewedAt: "2026-11-01T12:00:00Z",
      competencies: w.restaurant.skillRules.catalog.map((k) => ({
        skillId: k.id,
        verifiedBy: "demo-manager",
        verifiedAt: "2026-11-01T12:00:00Z",
      })),
    }));
  w.restaurant.skillRules.requiredByKind = {
    Opening: ["open"],
    Midday: [],
    Closing: ["close"],
  };
  w.restaurant.skillRules.requirements = [
    {
      id: "open-demo",
      skillId: "open",
      days: [0, 1, 2, 3, 4, 5, 6],
      start: 600,
      end: 660,
      minimum: 1,
    },
    {
      id: "close-demo",
      skillId: "close",
      days: [0, 1, 2, 3, 4, 5, 6],
      start: 1200,
      end: 1380,
      minimum: 1,
    },
  ];
  w.weeks = [
    {
      start: "2026-11-16",
      budgets: [12, 12, 12, 12, 12, 12, 12],
      shifts: Array.from({ length: 7 }, (_, i) => [
        {
          id: `open-${i}`,
          employeeId: w.employees[i % 2].id,
          date: dateAt("2026-11-16", i),
          start: 600,
          end: 960,
          kind: "Opening" as const,
          breakMinutes: 30,
          breakStart: 780,
        },
        {
          id: `close-${i}`,
          employeeId: w.employees[2 + (i % 2)].id,
          date: dateAt("2026-11-16", i),
          start: 1020,
          end: 1380,
          kind: "Closing" as const,
          breakMinutes: 30,
          breakStart: 1140,
        },
      ]).flat(),
    },
  ];
  w.requests = [];
  w.notifications = [];
  return w;
}
