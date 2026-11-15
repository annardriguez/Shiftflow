# Current data model — Milestone 5

Workspace v2 is preserved as a tenant-keyed PostgreSQL JSONB aggregate with optimistic revision and server-stamped tenantId. No online operation reads the legacy JSON file. The PostgreSQL tables are defined in db/migrations/001_tenants.sql; the pinned auth schema is reviewable in db/auth-schema.sql. See [Milestone 5](milestone5.md) for the implemented model and the explicit trusted-server versus RLS boundary. Earlier sections below retain domain/entity design context; richer normalized production entities remain future design rather than a claim that all domain arrays became SQL tables.

| Current table | Invariants |
| --- | --- |
| auth.user/account/session/rateLimit | Better Auth credentials and sessions; separate auth runtime role; no tenant role accepted from clients |
| app.tenants | Stable UUID; fictional-data flag |
| app.memberships | User FK, tenant FK, manager/employee role, employee linkage, active status; unique user and employee mapping per tenant |
| app.workspaces | Tenant primary key, versioned v2 payload; revision must advance exactly once per update |
| app.schedule_runs | Composite tenant/run primary key, server-owned snapshot/results; manager-restricted tenant policy |
| app.audit_events | Tenant/event key, timestamp, authenticated user attribution for new application events; append-only |
| app.request_events | Tenant/request/event-index key; persistent transition entries; append-only |
| app.imports/schema_migrations | Original import digest and migration version/checksum |

Historical actor labels imported from earlier milestones remain historical. New competency reviews and approvals use the authenticated membership/user context. Employee contact data and employment/skill roles do not modify login identities or authorization memberships. Notifications stay transactionally inside the workspace aggregate and are projected only to recipients/managers.

# Data model

## Implemented local representation

`Workspace` has `schemaVersion`, optimistic `revision`, scenario, restaurant, employees, weeks, and persistent change events. `Employee` includes a stable ID, fictional name/email, role, colour, preferred hours, maximum hours, minimum rest, maximum shift length, shift eligibility, seven recurring availability windows, and approved absence dates. `Week` has a Monday start, seven soft labour-hour targets, and saved draft assignments. `Shift` stores date, employee ID, clock-time start/end, type, and the start and duration of one unpaid break. `AuditEvent` has ID, UTC timestamp, and change description. This local aggregate intentionally simplifies normalized relationships.

The restaurant has an ID, display name, location, IANA timezone, preparation start, and close. Only one local restaurant and adult fictional workers are supported. Roster dates and recurring availability are interpreted in Europe/Amsterdam. Cross-day shifts and multiple breaks per shift are not supported in this milestone.

## Normalized PostgreSQL target — design only

Every entity below has a UUID primary key, `created_at` and `updated_at` as UTC timestamptz, and `restaurant_id` unless it is the restaurant itself. Tenant-owned relationships must use composite foreign keys `(restaurant_id, referenced_id)` into tenant-qualified unique keys. Database policies and server authorization must both prevent access by changing IDs. Uniqueness and indexes include restaurant ID.

| Entity                | Principal fields and relationships                                                                                  | Key validation                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Restaurant            | name, timezone, operating rule version                                                                              | Valid IANA zone; operating hours versioned by weekday/date                                           |
| Membership            | restaurant_id, auth_user_id, employee_id nullable, role                                                             | Unique user/restaurant; authorized role changes only                                                 |
| Employee              | external_reference nullable, display_name, active_from/to                                                           | No sensitive personal attributes in solver inputs                                                    |
| EmploymentRule        | employee_id, effective dates, min/max paid units, shift/rest limits, entitlement reference, rule verification state | Effective ranges cannot overlap; unknown entitlements cannot silently become zero                    |
| EmployeeEligibility   | employee_id, shift_type_id, valid_from/to                                                                           | Effective and tenant scoped                                                                          |
| RecurringAvailability | employee_id, weekday, local start/end, effective dates, confirmation state                                          | Confirmed windows; start < end; support multiple disjoint windows                                    |
| AvailabilityException | employee_id, local_date, availability state, windows, source_request_id                                             | Explicit exception overrides recurrence; normalized child windows                                    |
| EmployeePreference    | employee_id, effective dates, preferred min/max units, day/time preferences                                         | Preferences are soft; preference range within validated employment bounds                            |
| TimePreferenceWindow  | preference_id, weekday, local start/end, utility coefficient                                                        | No undefined coercion of unavailable time into a preference                                          |
| ShiftType             | name, opening/closing/midday, eligibility requirement                                                               | Opening/closing requirements have actual operational semantics                                       |
| ShiftTemplate         | shift_type_id, weekday applicability, clock window, break policy                                                    | Fit preparation hours and configured break rules                                                     |
| CandidateShift        | input_snapshot_id, template_id, local date, start/end UTC instants, paid units                                      | Immutable for each solve; explicit break variants                                                    |
| CandidateBreak        | candidate_shift_id, UTC start/end, paid flag                                                                        | Non-overlap and containment; absent from coverage when on break                                      |
| ScheduleVersion       | week_start, parent_version_id, input_snapshot_id, draft/published/superseded, revision, published_at/by             | One current published version per restaurant/week; immutable published records                       |
| Assignment            | schedule_version_id, employee_id, candidate_shift_id nullable, UTC start/end, type_id                               | No overlapping employee assignments, including adjacent weeks; manual shifts valid without candidate |
| AssignmentBreak       | assignment_id, UTC start/end, paid flag                                                                             | Clock duration distinct from paid minutes and operational presence                                   |
| LabourBudget          | local_date, recommended_paid_units, source, source_version                                                          | Soft target, nonnegative; provenance may be manual/unknown                                           |
| StaffingRequirement   | local_date, interval start/end, target count, mandatory minimum, required eligibility                               | Soft desired count separate from hard operational minimum; nonnegative                               |
| TimeOffRequest        | employee_id, start/end, status, decision_by/at, version                                                             | Approved state creates an overriding absence transactionally                                         |
| ShiftSwapRequest      | requester_id, offered_assignment_id, replacement_employee_id, reciprocal_assignment_id nullable, state, version     | Explicit acceptance and manager approval; both schedules validated atomically                        |
| SwapTransition        | request_id, from/to state, actor, timestamp, reason                                                                 | Append-only allowed transition graph                                                                 |
| SolverRun             | snapshot_id, strategy, rule/weight versions, status, objective, bound, metadata                                     | Validated snapshot; result integrity before persistence                                              |
| InputSnapshot         | immutable serialized input, hash, rule_version, historical cutoff                                                   | Reproducible source; no live edits during a run                                                      |
| Notification          | employee_id, event_id, read_at, delivery state                                                                      | Outbox for delivery, retries and deduplication                                                       |
| AuditEvent            | actor_id, action, entity_type/id, before/after reference, correlation_id                                            | Immutable, access-controlled and retention-limited; transactional with mutation                      |

Store operative instants in UTC and retain the restaurant timezone plus relevant local date. Recurring windows remain wall-clock times; resolve DST at candidate creation. Integer half-hour units are appropriate for CP-SAT, but PostgreSQL should retain exact paid minutes and actual timestamps for future changes in time granularity. Preferred ranges, historical burden, rule version, and budget provenance must survive future schema migration.

## Swap state graph — milestone 4

Requested → Awaiting acceptance → Awaiting manager approval → Approved → Applied. Rejected or Cancelled are terminal alternatives where permitted. Approved → Applied rechecks availability, both employees’ rest and hours, overlap, absence, eligibility, and mandatory coverage in a single transaction. A stale roster returns a conflict; approval alone cannot imply application. A quick manager-recorded agreement retains its source and actor. No state indicates “updated in Strobbo” without a confirmed authorized integration receipt.

## Privacy and retention

Use fictional data until authentication, authorization, tenant separation, retention/deletion policies, data minimization, audit access, encrypted transport, backups, and incident handling are implemented and reviewed. Employee consent and lawful basis are decisions for the organization and appropriate advisers. The current local audit event list is a debugging aid and can be overwritten by a local user; it is not immutable evidence.

## Competencies and supervision extension

Add these normalized entities to the target schema (design only):

| Entity                   | Fields and invariants                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CompetencyDefinition     | restaurant_id, stable skill_id, name, task-specific description, active flag; configurable, never a subjective performance rating                                                                           |
| EmployeeCompetency       | employee_id, competency_id, valid_from/to, verified_by membership, verified_at, revoked_by/at and evidence reference; only authenticated authorized managers can grant/revoke; historical versions retained |
| EmployeeSkillReview      | employee_id, reviewed_by/at, rule version; distinguishes reviewed no-qualification from unknown legacy data                                                                                                 |
| SupervisionNeed          | employee_id, required supervisor competency_id, effective dates, context/shift applicability; trainee status is derived from an explicit need, never age or subjective rating                               |
| SkillCoverageRequirement | local date/weekday pattern, interval, competency_id, minimum distinct qualified workers, rule version; mandatory and independent of headcount demand                                                        |
| ShiftDutyRequirement     | assignment_id/template_id, competency_id; must be held by the assigned worker, regardless of other staff                                                                                                    |
| SupervisionPolicy        | restaurant_id, effective version, maximum concurrent trainees per supervisor, simultaneous-duty policy; supervision consumes shared capacity across all required competency groups                          |
| SupervisionPairing       | schedule_version_id, interval, trainee_id, supervisor_id; distinct on-duty people, qualified supervisor not themselves requiring supervision                                                                |

The local v2 aggregate stores a configurable catalog, recurring skill requirement windows, required-by-shift-kind skill IDs, and a shared integer supervisor capacity. Each employee stores manager-stamped competency records, skillsReviewedAt and one supervisionSkillId (null only means no need after review). Assignments may add requiredSkillIds. Per-skill expiry, multiple concurrent supervision needs, employee-specific supervision capacity, dated rule exceptions and durable pairing history remain later extensions.

Unknown legacy profiles are never certified during migration. Existing shift eligibility stays separate: being permitted to work a closing-time shift does not mean being able to close independently. Default sample rules require a qualified opener 10:00–11:00, qualified closer 21:30–23:00, and general-service coverage 11:00–21:30, every day. Each assignment requires general service; specific independent closing/opening duties can be added to an assignment. On-duty trainees may contribute skills they actually hold; they still require supervision. A supervisor must be independent and qualified for that trainee's required supervision task. Shared capacity prevents counting one supervisor twice across different trainee skill groups. Breaks remove workers from qualified coverage and supervision in each affected interval.

Local competency and rule changes append actor/time and structured before/after details to the persistent audit list. This is useful provenance for fictional data, not production authorization or immutable records. An unreviewed or unverifiable profile blocks eligibility. A skill grant is meaningful only with server-produced verification provenance.

## Milestone 2 runtime snapshots

The implemented Python service has an immutable canonical scheduling snapshot separate from the v2 manager storage aggregate. Pydantic contracts represent explicit employment limits/minima, dated availability/absences, effective qualifications (verification, expiry and revocation), task supervision needs, hard dated skill/headcount requirements, soft budgets/preferences, fictional or explicitly absent history, baseline locks and fixed adjacent-week assignments. Canonical paid time is integer half-hour units; local clock time uses integer minutes and rest is checked between timezone-aware UTC instants.

The v2 workspace adapter preserves source revision and converts only supplied source data plus an explicitly confirmed synthetic employment policy. It does not infer qualifications or historical work. Runtime result objects include validated assignments, coverage/skill counts and supervision pairings, objective components, descriptive diagnostics, source snapshot hash and solver phase metadata. Results are not stored as published schedule versions: the API retains only a bounded process-local cache, and the manager draft is unchanged. Normalized persistence/authorization entities above remain a later milestone.


## Milestone 3 additive local fields

Workspace v2 now accepts optional Week.provenance {runId, strategy, savedAt, edited, snapshotId}. Existing v2 data stays valid. Local run files separately retain immutable canonical inputs, digest, source revision and solver alternatives. Draft saves atomically store prior/new assignments in the audit. This is local draft provenance, not manager swap approval or an external-sync receipt. See [Milestone 3](milestone3.md).


## Milestone 4 implemented local additions

Optional Workspace.requests and notifications retain versioned requests, immutable-in-application transition entries, approval actor/time/revision and in-app read receipts. Employees gain optional dated availability overrides; weeks gain optional full-engine validation policy. These additive v2 fields preserve existing data. The request/approval model and exact state machine are specified in [Milestone 4](milestone4.md); the normalized production tables above remain future design.
