import type { Employee, Scenario, Shift, Workspace } from "./types";
import { BASE_WEEK, dateAt, emptyWeek, validateShift } from "./schedule";
import { defaultSkillRules, DEMO_MANAGER } from "./skills";
const people = [
  ["Nora de Vries", "Shift leader", "sage", 28, 40, "all"],
  ["Liam van Dijk", "Shift leader", "blue", 32, 40, "all"],
  ["Sofia Bakker", "Team member", "peach", 24, 32, "morning"],
  ["Daan Visser", "Team member", "lilac", 24, 32, "all"],
  ["Emma Jansen", "Team member", "rose", 16, 24, "student"],
  ["Noah Smit", "Team member", "sand", 20, 28, "evening"],
  ["Yara Meijer", "Team member", "blue", 24, 32, "all"],
  ["Lucas Bos", "Team member", "sage", 16, 24, "student"],
  ["Mila Dekker", "Team member", "peach", 12, 20, "weekend"],
  ["Finn Mulder", "Team member", "lilac", 24, 32, "all"],
  ["Zoë de Groot", "Team member", "rose", 16, 24, "student"],
  ["Sem Peters", "Team member", "sand", 20, 28, "evening"],
  ["Julia Hendriks", "Team member", "sage", 12, 20, "morning"],
  ["Adam Vos", "Team member", "blue", 16, 24, "weekend"],
  ["Tess van Leeuwen", "Team member", "peach", 20, 28, "all"],
] as const;
export function seed(scenario: Scenario = "normal"): Workspace {
  const employees: Employee[] = people.map(
    ([name, role, color, preferredHours, maxHours, pattern], i) => ({
      id: `emp-${i + 1}`,
      name,
      email: `${name.toLowerCase().split(" ")[0]}@example.test`,
      role,
      color,
      preferredHours,
      maxHours,
      competencies: [
        "service",
        ...([0, 1, 2, 3, 6, 9, 12].includes(i) ? ["open"] : []),
        ...([0, 1, 3, 5, 6, 9, 11].includes(i) ? ["close"] : []),
        ...([0, 1, 3, 6, 9].includes(i) ? ["train"] : []),
      ].map((skillId) => ({
        skillId,
        verifiedBy: DEMO_MANAGER,
        verifiedAt: "2026-11-15T11:00:00Z",
      })),
      supervisionSkillId: [4, 7, 8, 10, 13, 14].includes(i) ? "train" : null,
      skillsReviewedAt: "2026-11-15T11:00:00Z",
      minRestHours: 11,
      maxShiftHours: 9,
      eligible:
        pattern === "morning"
          ? ["Opening", "Midday"]
          : pattern === "student" || pattern === "evening"
            ? ["Midday", "Closing"]
            : ["Opening", "Midday", "Closing"],
      availability: Array.from({ length: 7 }, (_, d) => {
        if (scenario === "shortage" && (d === 4 || d === 5) && i > 3)
          return null;
        if (pattern === "weekend" && d < 5) return null;
        if (pattern === "student" && d < 5)
          return d === 1 || d === 3 ? null : { start: 1020, end: 1380 };
        return {
          start: pattern === "evening" ? 960 : 600,
          end: pattern === "morning" ? 1020 : 1380,
        };
      }),
      absentDates:
        i === 6
          ? [dateAt(BASE_WEEK, 3), dateAt(BASE_WEEK, 4)]
          : i === 14
            ? [dateAt(BASE_WEEK, 2)]
            : [],
    }),
  );
  const week = emptyWeek(BASE_WEEK, scenario);
  // Deliberately authored sample roster, never an optimizer result.
  const patterns: [number, number, number][] = [
    [0, 600, 990],
    [2, 600, 960],
    [3, 720, 1080],
    [5, 1020, 1380],
    [4, 1020, 1380],
    [1, 990, 1380],
    [6, 660, 1050],
  ];
  for (let day = 0; day < 7; day++) {
    for (let j = 0; j < (day >= 4 ? 8 : 6); j++) {
      const p = patterns[j % patterns.length];
      const index =
        j >= 6
          ? 7 + ((day + j) % 8)
          : (p[0] + (day % 3 === 2 ? 3 : 0)) % employees.length;
      const s: Shift = {
        id: `sample-${day}-${j}`,
        employeeId: employees[index].id,
        date: dateAt(BASE_WEEK, day),
        start: p[1],
        end: p[2],
        breakMinutes: p[2] - p[1] > 330 ? 30 : 0,
        breakStart: p[2] - p[1] > 330 ? p[1] + 180 : null,
        kind: p[1] === 600 ? "Opening" : p[2] === 1380 ? "Closing" : "Midday",
      };
      if (!validateShift(s, employees, week.shifts).length) week.shifts.push(s);
    }
  }
  return {
    schemaVersion: 2,
    revision: 0,
    scenario,
    restaurant: {
      id: "restaurant-demo",
      name: "Hawaiian Poké Bowl",
      location: "Utrecht, Netherlands",
      timezone: "Europe/Amsterdam",
      open: 600,
      close: 1380,
      skillRules: defaultSkillRules(),
    },
    employees,
    weeks: [week],
    audit: [
      {
        id: "initial",
        at: "2026-11-15T11:00:00Z",
        message:
          "Fictional workspace created. Sample roster is manually authored.",
      },
    ],
  };
}
