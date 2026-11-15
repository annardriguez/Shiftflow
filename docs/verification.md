# Current verification — Milestone 5

The current checks include 57 TypeScript domain cases, 47 Python cases, and PostgreSQL-backed production-server suites for foundation APIs, generation/save, workforce workflows and authentication/tenant isolation. The security suite exercises password/cookie/session handling, role and membership changes, tenant/header/body/run/request attacks, database RLS/privilege boundaries, immutable history, two Node processes, and backup/restore. Every HTTP suite uses a separate temporary database. Browser checks verify real manager/employee password sign-in, authorized restaurant switching, logout and a 390px employee portal without horizontal overflow.

A physical PostgreSQL restart preserves the exact workspace and valid session; an outage fails closed, serves no JSON fallback, and the web process recovers without restart. See artifacts/milestone5-verification.json and [Milestone 5](milestone5.md). Earlier verification notes below are historical milestone evidence and do not supersede current implemented functionality.

# Milestone 1 verification

Verified locally on 15 November 2026. No external deployment was performed.

## Story

A manager edits a fictional profile, verified skill/supervision profile, restaurant skill rules, availability window, labour target, or draft shift. Find Shift Cover performs a read-only post-replacement assessment using authoritative saved data. The browser sends a versioned request to the local Next.js API, which validates it, updates local storage atomically, and returns authoritative data for the dashboard, calendar and labour views.

## Results

| Check                  | Result                      | Evidence                                                                                                                                                                        |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript             | Passed                      | `npm run typecheck`, no diagnostics                                                                                                                                             |
| Domain tests           | 54 passed                   | `npm test`; availability, absence, eligibility, overlaps, rest, DST, break accounting, soft budgets, coverage, edits, revision control, CSV, fixtures                           |
| Production compilation | Passed                      | `npm run build`; all manager routes prerendered, workspace API dynamic                                                                                                          |
| HTTP integration       | 16 subtests passed          | `npm run test:api` reports 17 passing nodes including the parent test; starts/stops its own production server and deletes only its own temporary fixture directory              |
| Desktop review         | Passed representative flows | Overview and schedule reviewed at 1440px viewport width; saved screenshot in artifacts/shiftflow-desktop.png                                                                    |
| Mobile review          | Passed representative flows | Overview reviewed at narrow default width; navigation, profile and availability dialogs checked at 390px; document scroll width equalled viewport width (390px) on Availability |
| Browser → API          | Passed                      | Changed Monday target from 32 to 35; save closed modal and updated weekly target to 269 and deviation to −58                                                                    |
| API → storage → reload | Passed                      | Reloaded page and target editor still showed 35; restored Monday target to 32 afterward                                                                                         |
| Invalid edit feedback  | Passed                      | Tried assigning weekend-only Mila to Monday; form remained open with “Shift is outside confirmed availability.”                                                                 |
| Roster view state      | Passed                      | List control became aria-pressed=true and rendered the list view                                                                                                                |

The API suite independently verifies page responses, initial contract, same-origin saves and file contents, persistence across a server process restart, stale-revision rejection, cross-origin rejection, malformed JSON/schema errors, employee creation, recurring availability updates, valid shifts, conflicting availability and overlapping-shift rejection, concurrent writes, deletion, and scenario reset/audit records.

All three fictional fixture rosters are independently checked against individual assignment rules in domain tests. They intentionally contain skill/supervision gaps; those are diagnosed, not certified as complete hard-valid rosters. Empty rosters expose every unmet target interval. Tests verify that unpaid break intervals remove a worker from coverage and paid hours. Spring and autumn Amsterdam DST rest calculations have separate regression cases. CSV tests cover actual paid values, quote escaping, formula-prefix neutralization, and preservation of input ordering.

## Skill-aware extension verification

The 54 domain tests comprise the existing 29 foundation cases and 25 qualification/supervision/replacement cases. New cases cover a missing closer, replacement of the only closer by an unqualified employee, assignment-specific personal duties, trainee supervision, replacement of the only supervisor despite another closer, qualified-worker handovers and gaps, breaks, valid qualified replacements, shared capacity across supervision skill groups, matching that avoids greedy pairing failures, trainees not supervising themselves/others, preference-versus-hard-rule separation, draft edit protection, truthful revocation, unforgeable profile metadata, validated configuration/custom tasks, and fail-closed migration.

The 16 HTTP scenarios include four new integration cases: server-authoritative read-only cover assessment with revision/no external sync, rejection of forged skill provenance through generic profile edits, fresh assessment after competency revocation with audit actor/time, and persisted v1 migration across a server restart. Server-created verification metadata uses the fictional demo manager; no test claims actual role-based authorization.

Browser evidence (separate fictional preview directory; existing local workspace untouched):

- Removed Nora's closing competency, saved, reloaded and verified the change, then restored it. Verification records carried the demo actor and server timestamps.
- Changed supervisor capacity from 2 to 3, saved, reloaded and observed 3, then restored 2.
- Opened Nora's Monday shift and its per-interval skill view. Find Shift Cover returned **3 eligible** people (Julia, Yara, Finn) and **11 ineligible** people, with availability, overlap, rest and supervision reasons. No assignment was changed by the preview.
- Verified skill/rule/cover dialogs at 390px width. Page width was 390px and dialog scroll width equalled its client width (356px), so those forms had no horizontal overflow.
- No browser-console errors were reported in the reviewed skill flows. Screenshot artifacts: `artifacts/shiftflow-cover.png` and `artifacts/shiftflow-cover-mobile.png`.

The mobile review revealed text-field sizing incorrectly applying to competency checkboxes. Scoped checkbox sizing was fixed and verified. The short desktop sidebar could put Settings below the visible region; added independent vertical sidebar scrolling and verified mobile navigation to Settings afterward.

## Issues found and resolved

- The initial npm manifest used CommonJS. The installed Next.js version rejected ESM source under that explicit format. Switched the package to ESM; subsequent production builds passed.
- Next.js’s internal request URL host differed from the browser loopback host, causing valid same-origin POSTs to be rejected. The route now compares Origin to the actual request Host and validates loopback hostname/protocol. Browser save/reload and cross-origin HTTP regression tests pass.
- The first rest test accidentally reused an assignment ID and therefore described an edit instead of two separate shifts. Gave the boundary assignment a distinct ID and added explicit DST regression tests.
- Improved compact secondary-text contrast and hid the closed mobile sidebar from keyboard/accessibility navigation.

## Review limits

Browser checks are representative manual automation, not an exhaustive browser matrix or formal WCAG audit. Mobile calendars and coverage matrices intentionally scroll inside their panels. Keyboard focus/escape behavior uses native modal dialogs, semantic labels and buttons; a dedicated accessibility audit remains a pilot gate.

No solver, fairness score, optimization strategy, swap approval/application, request approvals, employee authentication, or publishing was tested because those functions are intentionally not implemented. Current UI metrics are descriptive and based only on fictional assignments. Legal sufficiency, production concurrency, multi-process storage, tenant isolation, retention compliance, real integrations and deployment security are not established by these tests.

The preview server and integration server were stopped after verification. Launch the app with `npm run dev` as described in README.md.

## Milestone 2 verification — final local copy

The verified copy is `/Users/annarodriguez/.codex/local-projects/shiftflow`, outside iCloud. macOS offloaded the original Desktop files and the user confirmed downloads were failing. Source generated during this chat was reconstructed locally; the original saved draft was not copied or changed. See [local recovery](local-recovery.md).

- 43 backend pytest cases pass, including actual CP-SAT solves and HTTP integration. Tests exercise invariant skills under all strategies, trainee/supervisor capacity across skill groups, matching/handovers/breaks, effective qualification expiry, absence/availability, individual/week/rolling/rest constraints, locked assignments, time preferences, soft budgets, deterministic small fixtures, normalization and independent objective recomputation, UNKNOWN versus INFEASIBLE, invalid-output withholding, resource limits, genuine warm-start fallback, request limits/origin/concurrency, retained-result lookup and the workspace adapter.
- Existing TypeScript checks and all 54 domain tests pass. Next.js production build and all 16 existing local HTTP integration scenarios pass (17 test nodes with the parent). Those tests use isolated data directories.
- The real verification script solved normal, high-demand and severe-shortage fictional inputs with all three strategies at a six-second per-strategy solver limit. All nine returned independently hard-valid FEASIBLE rosters. All three revoked-closer solves returned INFEASIBLE and no assignments. Full machine-readable evidence is in `artifacts/engine-verification.json`.
- Full-size alternatives may coincide at short limits; no distinct scenarios or optimality claims are fabricated. In the observed shortage run, assigned hours and desired coverage differed across strategies. The coverage-first incumbent need not dominate another strategy when neither solve has proved optimality. All remaining desired-coverage intervals are explicit.
- The live Uvicorn API is checked separately over loopback TCP: health → fixture input → actual solve → independent validation → retained run lookup. Evidence is saved in `artifacts/engine-http-smoke.json`. The current frontend still edits a manually authored roster; integrated generated-roster comparison/save is Milestone 3.

Pinned runtime: Python 3.12.16, OR-Tools 9.15.6755, FastAPI 0.163.1, Pydantic 2.14.3, Uvicorn 0.54.0. Exact transitive dependencies are locked in backend/uv.lock; OpenAPI is generated into backend/openapi.json. No Strobbo connection, real employee data, paid AI call or deployment was used.


## Milestone 3 integrated checks

The production Next API is tested against the real local engine with isolated temporary data via npm run test:planning. Includes preview validation, invalid-save rollback, valid edits, concurrent saves, provenance, stale rejection and restart persistence. Browser generation/edit/save/CSV download was verified. Detailed procedure: [Milestone 3](milestone3.md).


## Milestone 4 workforce verification

Real-engine production-server checks cover employee scoping, manager-only actions, targeted acceptance, stale versions and sources, concurrent approval/manager writes, adjacent-week rest changes, revoked qualifications, trainee needs, both swap directions, cancellation/rejection, notification privacy, dated availability, time-off conflicts and restart persistence. Browser cover/swap/approval/history flows and 390px portal/dialog layouts passed. See [workflow verification](milestone4.md) and artifacts/milestone4-verification.json.
