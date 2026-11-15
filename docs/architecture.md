# Current implementation — Milestone 5 local authenticated workspace

The application now uses Better Auth password sessions, PostgreSQL restaurant memberships and server-derived role/employee authorization. Business operations use async-local verified actor context, database row locks and forced tenant RLS; old JSON stores and demo sessions are not runtime fallbacks. Workspaces remain v2 domain aggregates stored in tenant-keyed JSONB, while identities, memberships, runs, import receipts, migration history and append-only audit/request events have relational tables. The independent Python engine requires an internal service key and never persists schedules. No Strobbo connection or public deployment exists.

Read [Milestone 5](milestone5.md) for the exact current interfaces, privileges, migration, backup/restore and limits. The sections below preserve the evolution and original design; references to single-process JSON/demo identities describe earlier milestones and are superseded by this section.

# Architecture and API contracts

## Environment inspection

The supplied workspace was empty: no package manifest, application, repository history, or AGENTS.md was present. Available runtimes were Node 24.19.0, npm 11.17.0, and Python 3.9.6. The frontend remains on Node; the approved Milestone 2 backend now runs on managed Python 3.12.16 with FastAPI, Pydantic and OR-Tools locked in backend/uv.lock. System Python remains unchanged.

Dependencies are locked in package-lock.json. Next.js App Router, React, TypeScript, Tailwind/PostCSS, Lucide, Zod, and tsx are the only direct dependencies. No paid API or hosted backend is needed. There is no git remote to push to.

## Implemented boundary

```text
Browser / React context
   → GET or POST /api/workspace (Next.js, Node runtime)
      → Zod input schema → pure applyMutation
         → independent shift validation and calculations
            → serialized local repository → atomic JSON rename
   ← authoritative complete Workspace + incremented revision
   → React recalculates dashboard, calendar, and labour views
```

UI state contains only the current workspace, selected week, filters, and dialog inputs. It does not directly write storage. Unsuccessful edits remain in the form with the server’s error. Refresh failures show a retry state. A stale revision returns 409 and reloads authoritative data instead of silently overwriting it.

Each accepted mutation increments `revision`, records a UTC audit timestamp, and writes a 0600 file. Writes are serialized within the single Node process and use a unique temporary file followed by rename. A failed write is not acknowledged as saved. File corruption yields a read error rather than an automatic reset. The file is not safe for multiple processes; eventual PostgreSQL transactions replace this repository.

Server components define route entry points. Client components own browser interaction. Server-only storage imports are confined to the route. No external fonts or image requests are required. The overview uses decorative CSS artwork; all analytical graphics are derived from the same data as the tables.

## Current HTTP contract

`GET /api/workspace` returns `200 Workspace`, with `Cache-Control: no-store`. A missing file yields a deterministic in-memory initial fixture; the first mutation writes it.

`POST /api/workspace` accepts one discriminated mutation and a required integer revision:

| type         | Required payload                                          | Effect                                                             |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------------ |
| employee     | employee: Employee                                        | Create or replace profile; revalidate saved assignments            |
| availability | employeeId, availability: seven Window/null values        | Replace recurring windows; revalidate saved assignments            |
| budgets      | week: Monday ISO date, budgets: seven nonnegative numbers | Update soft paid-hour recommendations                              |
| shift        | week, shift: Shift                                        | Create/replace, independently validate against all stored weeks    |
| delete-shift | week, id                                                  | Remove a known assignment                                          |
| scenario     | scenario: normal/high-demand/shortage                     | Replace all fictional workspace data; retain audit/request history and invalidate pending offers |

Success returns the entire `Workspace`. Errors return `{ "error": "Human-readable reason" }`: 400 malformed JSON, 401 missing demo session, 403 unauthorized role or external host/origin, 409 stale revision, 413 oversized body, 422 schema/domain errors, or 500 storage failure. Error bodies do not disclose server paths or stack traces. Requests are capped at 100,000 body characters (and declared bytes where available); a production proxy must enforce streaming byte limits before buffering.

Runtime schemas are in `src/lib/mutations.ts`; compile-time contracts are in `src/lib/types.ts`. Decimal hours have a 0.5h granularity. Start, end, and break times are integer local minutes, all on half-hour boundaries. IDs must be stable; fixture IDs are deterministic and new local IDs use UUIDs.

## Service architecture — Python engine implemented, authentication/database planned

```text
Next.js manager + mobile employee portal
   → authenticated backend-for-frontend
      → FastAPI + Pydantic API contracts
         → application services / authorization / transactions
            → PostgreSQL repository
            → independent validation service
            → optimizer adapter → OR-Tools CP-SAT
```

The optimizer takes an immutable, versioned input snapshot. It has no HTTP, auth, database, or UI dependencies. Deterministic fixture inputs and a single solver worker enable reproducibility in tests. The validation service recomputes constraints and metrics from assignments, independently of solver expressions. Only verified output can become a saved draft; publishing is a separate versioned operation.

The implemented local FastAPI endpoints and synchronous run semantics are described in [Milestone 2](milestone2.md) and [backend/README](../backend/README.md). The following authenticated transactional endpoints remain a future target:

- `POST /v1/restaurants/{id}/schedule-runs`: week, inputVersion, three requested strategies, validated config and limits. Return run ID and execution state. Reject cross-tenant IDs.
- `GET /v1/restaurants/{id}/schedule-runs/{runId}`: actual solver status, candidate sets, metrics, diagnostics, runtime, seed, best bound and objective gap. Alternatives are separate solve results from one immutable snapshot.
- `PATCH /v1/restaurants/{id}/drafts/{version}/assignments/{id}`: validated edit with If-Match revision. PostgreSQL transaction validates and applies change and audit entry together.
- `POST /v1/restaurants/{id}/drafts/{version}/publish`: reviewed version and optimistic concurrency guard; employee notification events go through a transactional outbox.
- `POST /v1/restaurants/{id}/swap-requests/{id}/transition`: authorized state transition, idempotency key and version; acceptance and approval cannot be inferred from external conversations.

Generate TypeScript types from FastAPI’s OpenAPI schema instead of maintaining parallel handwritten API models. The current Workspace representation remains an adapter for UI development, not a future relational schema.

## Deployment boundary

Milestone 1 is intentionally localhost-only. Milestone 5 introduces authenticated sessions, manager/employee permissions, tenant-scoped composite foreign keys, database row policies where applicable, request limits, immutable audit history, privacy controls, monitoring, and restoration tests. No production deployment should be inferred from a successful local build.

## Skill-aware foundation update

The skill-aware workspace foundation was Milestone 1; the Python engine is now approved and implemented as Milestone 2. Add manager-workspace competency editing, configurable restaurant skill rules, draft skill diagnostics, and a **read-only Find Shift Cover assessment**. The Python service now runs genuine CP-SAT solves. Employee requests and swap approval/application are implemented locally in Milestone 4; authenticated certification and external synchronization remain later milestones.

Competencies are objective task qualifications, separate from role and shift-type eligibility. A trusted application actor supplies verification timestamps and verifier identity; employee/profile payloads cannot supply certification provenance. In the current localhost-only demo that actor is the fixed fictional manager. This is not authenticated authorization. Before real use, derive actors from authenticated server sessions and require restaurant-manager membership for grants/revocations/rule changes; employee routes must reject certification writes.

Schema version 2 adds verified competencies, a reviewed skill profile, supervision needs, restaurant-level skill catalog/interval requirements/assignment duties/supervision capacity, and optional assignment-specific required skills. Upgrade version 1 data without changing availability, hours or rosters: all legacy qualifications are **unreviewed**, not inferred from roles or the old `eligible` field. Migration warnings remain visible until review. Unknown qualifications fail closed in cover checks.

New manager-only-in-production contracts:

- `POST /api/workspace` type `competencies`: employeeId, skillIds, supervisionSkillId, revision. Server supplies verification metadata and audits before/after skill IDs and supervision need. Revocation is always recordable, even if it exposes an unsafe draft; truth must not be held hostage by the roster.
- `POST /api/workspace` type `skill-rules`: complete validated restaurant skill rules, revision. Stable skill IDs cannot be silently removed while referenced. Rule changes expose gaps rather than conceal them.
- `GET /api/shift-cover?week=YYYY-MM-DD&shiftId=...`: authoritative stored shift and workspace revision, complete candidate assessments, structured hard reasons, soft ranking indicators, affected skill diagnostics. Does not accept client-provided qualifications, availability, or roster. No save or apply action.

An assessment replaces the assignment in a copy of the roster, never merely adds a candidate beside the original worker. Check the candidate's entire clock-window availability, all stored assignments for overlap/rest/hour limits, assignment-required qualifications, and the resulting team skill/supervision coverage throughout the affected shift window. Include existing operational gaps in that window as blocking reasons. Other shifts on the affected day are checked for individual constraints; adjacent dates remain in rest checks. Soft staffing targets and preferred hours do not decide eligibility. Decisions are explicitly scoped to configured prototype rules, not complete legal compliance.

Manual draft edits reject newly created/worsened skill or supervision deficits; pre-existing gaps remain visible so incomplete drafts can be repaired incrementally. Qualification revocations and rule changes may reveal deficits and are audited. A cover candidate is eligible only when **all** affected mandatory checks pass, even if a deficit already existed. This distinction is intentional and must be visible in the UI.

Future swap application must fetch fresh assignments, qualification/rule versions and membership inside a transaction; independently re-run the same validators on the complete proposed replacement/bilateral swap; enforce immutable approved version and expected revision; then update assignments, request state, approver ID/time, audit and notification outbox atomically. Never reuse an earlier eligibility flag as authority. Store external sync state separately (`not_connected`, `pending`, `confirmed`, `failed`) with provider receipt/version; a ShiftFlow application is never evidence of Strobbo synchronization.

## Implemented Python service boundary

FastAPI takes validated immutable fictional snapshots, or adapts supplied v2 workspace JSON without accessing its files. It exposes schedule-runs, retained-result lookup, independent validate, fictional fixture and workspace-snapshot/workspace-solve endpoints. The engine has no HTTP/storage dependency. The HTTP service limits body size, accepted loopback hosts/origins, solve concurrency and retained results. POST solve is synchronous and bounded, not a durable background queue. A 200 response is not a validity certificate; statuses and independent validation must be checked. The OpenAPI contract is generated into backend/openapi.json.

The recovered local working copy is outside iCloud because the original Desktop folder could not materialize some offloaded files. This changes the development location, not the restaurant data model. Neither service touches the original saved draft. Details: [local recovery](local-recovery.md).


## Implemented Milestone 3 gateway

The local Next planning gateway captures server-owned snapshots, persists run records, proxies to the fixed loopback FastAPI service and independently validates complete edited drafts. A revision-checked serialized transaction atomically saves the week plus provenance and audit. No client-provided validation flag authorizes a save. Engine-draft calendar edits and cover previews use full Python validation. See [workflow, boundaries and limitations](milestone3.md).


## Milestone 4 workforce boundary

The server derives the fictional actor from an opaque local demo-session cookie. Manager APIs and employee-scoped projections enforce roles and ownership; the demo account selector deliberately permits switching fictional identities and is not production authentication. Versioned requests, colleague consent and fresh whole-roster approval execute through the shared process-wide workspace transaction queue. Assignment changes, terminal request state, approver/time, prior/new evidence and local notifications commit with one atomic rename. Read [Milestone 4](milestone4.md) for the command contracts, transitions, failure semantics and remaining pilot gates.


## Current HTTP and repository boundary

`/api/auth/*` exposes only selected library sign-in/session/password operations. `/api/session` provides sanitized identity/current membership, and `/api/session/tenant` selects only an assigned restaurant. `/api/demo-session` returns 410. Every workspace/planning/workforce/cover handler is protected by a verified session and restaurant context; manager-only handlers deny employees. Actor/tenant claims in mutations cannot select authority. The browser sends its rendered restaurant context to reject stale cross-tab actions.

Repository transactions obtain fresh membership/session locks using a restricted database function, lock the tenant workspace, verify revision/history, validate proposed rosters and atomically write JSONB plus append-only normalized history. Pool-local tenant settings are transaction-scoped and cleared by commit/rollback. Runtime roles do not own tables or bypass RLS. Offline administration alone reads the private administrator configuration. A dedicated auth runtime role handles auth tables; the application runtime cannot read password/session token tables.

Generation history is in `app.schedule_runs`, scoped by tenant and manager policy. The old `.data/runs` directory is import-only. The canonical fictional engine restaurant identifier is not an authorization boundary; PostgreSQL tenant membership is. Local health is non-sensitive; engine data endpoints require the server key.
