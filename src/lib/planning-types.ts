import type { Shift } from "./types";
export interface Report {
  valid: boolean;
  issues: {
    code: string;
    message: string;
    day?: string;
    minute?: number;
    employee_id?: string;
  }[];
  supervision_pairings: {
    day: string;
    minute: number;
    trainee_id: string;
    supervisor_id: string;
  }[];
}
export interface Alternative {
  strategy: string;
  status: string;
  solver_status: string;
  assignments: Assignment[];
  validation: Report | null;
  metrics: null | {
    total_paid_hours: number;
    recommended_paid_hours: number;
    budget_deviation_hours: number;
    uncovered_person_hours: number;
    target_coverage_percent: number | null;
    fairness_score: number;
    baseline_assignment_changes: number;
    coverage: {
      day: string;
      minute: number;
      actual: number;
      target: number;
      mandatory: number;
      skills: { skill_id: string; required: number; actual: number }[];
    }[];
    uncovered_intervals: {
      day: string;
      minute: number;
      actual: number;
      target: number;
    }[];
  };
  diagnostics: Report["issues"];
  warnings: string[];
  metadata: {
    relative_gap: number | null;
    used_feasibility_incumbent: boolean;
  };
}
export interface Assignment {
  id: string;
  employee_id: string;
  day: string;
  start: number;
  end: number;
  break_start: number | null;
  break_minutes: number;
  kind: string;
  required_skills: string[];
}
export interface PlanningRun {
  id: string;
  week: string;
  revision: number;
  createdAt: string;
  alternatives: Alternative[];
}
export function toShifts(a: Assignment[]): Shift[] {
  return a.map((s) => ({
    id: s.id,
    employeeId: s.employee_id,
    date: s.day,
    start: s.start,
    end: s.end,
    breakStart: s.break_start,
    breakMinutes: s.break_minutes,
    kind: (s.kind[0].toUpperCase() + s.kind.slice(1)) as Shift["kind"],
    requiredSkillIds: s.required_skills,
  }));
}
export function toAssignments(shifts: Shift[]): Assignment[] {
  return shifts.map((s) => ({
    id: s.id,
    employee_id: s.employeeId,
    day: s.date,
    start: s.start,
    end: s.end,
    break_start: s.breakStart,
    break_minutes: s.breakMinutes,
    kind: s.kind,
    required_skills: s.requiredSkillIds ?? [],
  }));
}
