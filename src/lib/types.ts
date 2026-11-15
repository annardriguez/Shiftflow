import type { WorkforceRequest, LocalNotification } from "./workforce-types";
export type Scenario = "normal" | "high-demand" | "shortage";
export type Role = "Team member" | "Shift leader";
export type ShiftKind = "Opening" | "Midday" | "Closing";
export interface Window {
  start: number;
  end: number;
}
export interface Competency {
  skillId: string;
  verifiedBy: string;
  verifiedAt: string;
}
export interface SkillDefinition {
  id: string;
  name: string;
}
export interface SkillRequirement {
  id: string;
  skillId: string;
  days: number[];
  start: number;
  end: number;
  minimum: number;
}
export interface SkillRules {
  catalog: SkillDefinition[];
  requirements: SkillRequirement[];
  requiredByKind: Record<ShiftKind, string[]>;
  supervisionCapacity: number;
}
export interface Employee {
  id: string;
  name: string;
  email: string;
  role: Role;
  color: string;
  preferredHours: number;
  maxHours: number;
  minRestHours: number;
  maxShiftHours: number;
  eligible: ShiftKind[];
  competencies: Competency[];
  supervisionSkillId: string | null;
  skillsReviewedAt: string | null;
  availability: (Window | null)[];
  absentDates: string[];
  availabilityOverrides?: { date: string; window: Window | null }[];
}
export interface Shift {
  id: string;
  employeeId: string;
  date: string;
  start: number;
  end: number;
  breakStart: number | null;
  breakMinutes: number;
  kind: ShiftKind;
  requiredSkillIds?: string[];
}
export interface Week {
  validationPolicy?: "full-engine";
  provenance?: {
    runId: string;
    strategy: string;
    savedAt: string;
    edited: boolean;
    snapshotId: string;
  };
  start: string;
  budgets: number[];
  shifts: Shift[];
}
export interface AuditEvent {
  id: string;
  at: string;
  message: string;
  actorId?: string;
  details?: Record<string, unknown>;
}
export interface Workspace {
  schemaVersion: 2;
  tenantId?: string;
  requests?: WorkforceRequest[];
  notifications?: LocalNotification[];
  revision: number;
  scenario: Scenario;
  restaurant: {
    id: string;
    name: string;
    location: string;
    timezone: string;
    open: number;
    close: number;
    skillRules: SkillRules;
  };
  employees: Employee[];
  weeks: Week[];
  audit: AuditEvent[];
}
export type Mutation =
  | {
      type: "competencies";
      employeeId: string;
      skillIds: string[];
      supervisionSkillId: string | null;
    }
  | { type: "skill-rules"; rules: SkillRules }
  | { type: "employee"; employee: Employee }
  | {
      type: "availability";
      employeeId: string;
      availability: (Window | null)[];
    }
  | { type: "budgets"; week: string; budgets: number[] }
  | { type: "shift"; week: string; shift: Shift }
  | { type: "delete-shift"; week: string; id: string }
  | { type: "scenario"; scenario: Scenario };
export type MutationRequest = Mutation & { revision: number };
export type Section =
  | "dashboard"
  | "schedule"
  | "team"
  | "availability"
  | "labour"
  | "requests"
  | "settings";
