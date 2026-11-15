import type { Shift, Window, Employee, SkillDefinition } from "./types";
export interface DemoActor {
  id: string;
  role: "manager" | "employee";
  name: string;
  tenantId?: string;
  tenantName?: string;
  email?: string;
}
export type RequestStatus =
  | "pending-colleague"
  | "pending-manager"
  | "applied"
  | "declined"
  | "rejected"
  | "cancelled"
  | "invalidated";
export interface Transition {
  at: string;
  actorId: string;
  from: RequestStatus | null;
  to: RequestStatus;
  note: string;
}
interface BaseRequest {
  id: string;
  version: number;
  requesterId: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  note: string;
  history: Transition[];
  approvedBy?: string;
  approvedAt?: string;
  appliedRevision?: number;
  externalSync: "not_connected";
}
export interface ShiftRequest extends BaseRequest {
  kind: "cover" | "swap";
  targetEmployeeId: string;
  week: string;
  shift: Shift;
  counterWeek?: string;
  counterShift?: Shift;
  source: "employee" | "manager-recorded";
}
export interface TimeOffRequest extends BaseRequest {
  kind: "time-off";
  dates: string[];
}
export interface AvailabilityRequest extends BaseRequest {
  kind: "availability";
  availability: (Window | null)[];
  dateOverrides: { date: string; window: Window | null }[];
  preferredHours: number;
}
export type WorkforceRequest =
  | ShiftRequest
  | TimeOffRequest
  | AvailabilityRequest;
export interface LocalNotification {
  id: string;
  at: string;
  requestId: string;
  recipientIds: string[];
  message: string;
  readBy: string[];
  channel: "in-app-only";
}
/** One mandatory-check finding from the independent engine validator.
 * `preExisting` is true when the same finding is already present on the
 * current saved roster, i.e. it was not caused by the proposed change. */
export interface CandidateIssue {
  code: string;
  message: string;
  day?: string;
  minute?: number;
  employeeId?: string;
  preExisting: boolean;
}
export interface CoverOption {
  employeeId: string;
  name: string;
  eligible: boolean;
  reasons: string[];
  scheduledHours: number;
  preferredHours: number;
  canClose: boolean;
  canSupervise: boolean;
  /** Structured findings behind `reasons` (additive; may be absent on older servers). */
  issues?: CandidateIssue[];
  role?: string;
  skillsReviewed?: boolean;
  maxHours?: number;
}
export interface SwapOption {
  shift: Shift;
  week: string;
  employeeName: string;
  eligible: boolean;
  reasons: string[];
  issues?: CandidateIssue[];
  canClose?: boolean;
  skillsReviewed?: boolean;
}
/** Read-only preflight of a stored request against the current roster. */
export interface RequestAssessment {
  requestId: string;
  revision: number;
  valid: boolean;
  /** False when the referenced shift(s) changed since the request was made. */
  sourcesCurrent: boolean;
  issues: CandidateIssue[];
  weeks: string[];
}
export interface PortalData {
  actor: DemoActor;
  revision: number;
  employee: Employee;
  skillCatalog: SkillDefinition[];
  weeks: { start: string; shifts: Shift[] }[];
  requests: WorkforceRequest[];
  notifications: LocalNotification[];
  names: Record<string, string>;
  externalSync: "not_connected";
}

export const MANAGER_RECIPIENT = "role:manager";
export function notificationFor(n: LocalNotification, actor: DemoActor) {
  return (
    n.recipientIds.includes(actor.id) ||
    (actor.role === "manager" &&
      (n.recipientIds.includes(MANAGER_RECIPIENT) ||
        n.recipientIds.includes("demo-manager")))
  );
}
