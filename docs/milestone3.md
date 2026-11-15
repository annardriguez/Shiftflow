# Milestone 3 — weekly roster workbench

Implemented in the local copy outside iCloud. Fictional data only; Strobbo is not connected. No publishing, employee request approval, authentication or external integration is included.

## Manager flow

1. Start `npm run engine:dev` in one terminal and `npm run dev` in another, from this project. Engine setup is already installed here; use `npm run engine:setup` after a fresh checkout.
2. Open Schedule, choose a Monday week, and review team skills, availability and saved labour targets (Labour insights).
3. Choose **Generate & compare**, then a search budget of 4, 8 or 15 seconds per strategy. Three real solves use the same immutable workspace snapshot. The HTTP operation is bounded; it is not a background job. Leaving the page does not cancel an engine solve already in progress.
4. Compare budget-first, balanced and coverage-first paid hours, signed deviation from the total labour target, demand coverage, unmet person-hours, fairness score and changes from the current saved roster. Expand interval skill/demand coverage and solver warnings. Feasible is not necessarily optimal; bounded strategies can return identical alternatives.
5. Select a feasible independently validated suggestion. Edit/add/remove preview shifts, including employee, day, kind, times and unpaid break. Edits invalidate the preview validation. Comparison metrics remain explicitly labelled as the original generated metrics; current preview paid hours update immediately.
6. **Validate preview** checks the entire edited roster with the independent Python validator. Failures include reasons; valid results include trainee/supervisor interval pairings. No preview edits affect the saved week.
7. **Save weekly draft** independently validates again, checks the snapshot revision inside the serialized transaction, and atomically replaces the complete week. A competing edit makes the run stale; regenerate against the latest inputs. No sequential partial shift saves occur.
8. Export a validated preview CSV, or export the saved draft from the normal calendar. CSV includes fictional/local-draft labels, timezone, run/strategy provenance and paid hours excluding unpaid breaks. Export does not publish or synchronize anything.

Recent comparisons persist across browser and UI server restarts. Only the latest 20 are listed; files remain available locally until removed by the operator. History is not an external service. The draft calendar remains usable without the engine for original manual fixtures; editing an engine-produced draft or assessing cover on it requires the engine so its additional mandatory rules are checked.

## Storage and interfaces

`GET /api/planning` lists public comparison records. `POST /api/planning` accepts a discriminated action: generate (`week`, expected `revision`, `seconds`), validate or save (`id`, `strategy`, `shifts`). Inputs are bounded/schema checked and same-origin loopback restricted. Clients cannot supply snapshots, solver status, approval actors or engine URLs.

Generation captures the authoritative server workspace and adapts it via `/v1/workspace-snapshot`, then calls `/v1/schedule-runs`. `.data/runs/<UUID>.json` holds the canonical snapshot, snapshot digest, source revision, timestamp and real alternatives. It is written atomically with private file permissions. Public history omits the canonical snapshot. Validation/save loads that stored snapshot; a forged or failed run cannot be applied. Unavailable engines and invalid/stale requests leave the workspace unchanged.

`Week.provenance` is an optional backward-compatible v2 addition: runId, strategy, savedAt, edited, snapshotId. Existing files need no migration. Save writes provenance, assignments, revision and audit in one atomic workspace replacement. The audit retains previous/new assignments and the demo-manager actor. Later workspace mutations mark provenance edited; later calendar shift changes on engine drafts undergo full independent validation against a fresh authoritative snapshot. Cover previews for engine drafts also revalidate all policy rules before labelling a candidate eligible.

The JSON store supports one Node process. A serialized in-process queue plus atomic rename prevents partial saves and lost updates within that process. Multi-process transactions, database persistence and authenticated actors remain Milestone 5 work. The fixed engine endpoint is `127.0.0.1:8000`; no CORS credentials or public URLs are used.

## Assumptions to validate with the manager

- Exact opening/preparation/closing intervals and qualification minima, including breaks and handovers.
- Which tasks require personal qualifications versus collective interval coverage; who can verify/revoke skills.
- Trainee task-specific needs and shared concurrent supervision capacity; independent supervisors cannot themselves require supervision.
- Contractual minimum weekly hours (demo defaults to zero), maximum 5 days/week, 6 consecutive days, rolling seven-day maxima, 3-hour minimum shift, 30-minute breaks after 5.5 hours and continuous-work limits. These are fictional policy defaults, not a legal certification.
- Whether demand coverage is desired or mandatory: demo headcount demand is soft, while skill coverage is mandatory. Feasible schedules can fall substantially below desired demand.
- Fairness history and preference weights: ordinary workspace inputs explicitly have zero historical quantities, unlike the synthetic history used in dedicated engine fixtures.
- Save replaces the selected whole week, including the old manual roster. Adjacent stored weeks constrain rest/rolling limits. Single local manager operation is assumed; publication/approval and Strobbo synchronization remain separate future states.

## Verification

`npm run check`, `npm run build`, `npm run test:api`, `npm run engine:test`; with the engine running, `npm run test:planning` exercises the production Next gateway against actual CP-SAT and Python validation. The planning suite uses an isolated temporary workspace, verifies unchanged source drafts during generation, invalid and valid edited previews, atomic concurrent saves, provenance/audit, full validation of later calendar edits, stale/forged run rejection and restart persistence. Browser QA covers generation → edit → revalidate → save → CSV download, comparison rendering and responsive layout. No test changes the user's project data.
