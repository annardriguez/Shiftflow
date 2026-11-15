# ShiftFlow

Local restaurant workforce planning with an independently validated FastAPI/OR-Tools engine, employee requests, manager approvals, password sign-in and PostgreSQL tenant isolation. Milestones 1–5 are implemented for **fictional local data**. Strobbo is not connected and nothing is deployed publicly.

The working copy is `/Users/annarodriguez/.codex/local-projects/shiftflow`, outside iCloud. Existing manual fixtures deliberately include some skill/supervision gaps; generating and saving a feasible roster provides a valid starting point for cover/swap workflows.

## Run locally

Developed with Node 24 and managed Python 3.12. PostgreSQL runs from a pinned project-local native package; Docker/Homebrew and cloud accounts are not required.

```sh
npm ci
npm run db:start
```

Keep that terminal open. In another:

```sh
npm run local:setup       # migrations + fictional seed; existing records/passwords preserved
npm run engine:setup      # once on a fresh checkout
npm run engine:dev
```

In a third terminal, run `npm run dev` (or `npm run build` then `npm start`). Open [ShiftFlow](http://127.0.0.1:3000).

Sign in using the private initial account details in `.data/fictional-accounts.json`. Jamie manages Utrecht; Robin manages Rotterdam; Alex is explicitly assigned both fictional restaurants. Employees have individual accounts. There is no identity impersonation switcher or public sign-up. The Restaurant selector lists only the signed-in user’s active memberships.

All services bind to loopback. PostgreSQL listens on `127.0.0.1:54329`, the internal engine on port 8000 and the app on port 3000. The engine launch script supplies its private service key. Keep `.data`, credentials and backups private; none are included in source packages.

## What works

- Manager dashboard, team/competency profiles, availability, labour targets, weekly calendar/list editor and CSV exports.
- Actual budget-first, balanced and coverage-first CP-SAT alternatives; skill coverage, trainee supervision, availability/rest/hour/break rules; independent whole-roster validation and explicit unmet-demand explanations.
- Editable generated previews, comparison history, revision-aware atomic draft saves and exports.
- Employee portal, targeted cover offers, bilateral swaps, colleague acceptance, manager approval/application, time-off and availability/preference requests, local notifications and persistent history.
- Password sign-in/change, session expiry/logout/revocation, server-enforced role/ownership checks and current per-restaurant membership checks.
- PostgreSQL transactions, forced tenant row-level security, tenant-scoped runs, append-only audit/request events, cross-process concurrency protection, legacy import, private consistent backup and empty-target restore.

Employment roles and qualifications do not grant application manager authority. Employee contact-email changes do not change account credentials. Accounts and memberships are provisioned locally by an administrator.

## Checks

With PostgreSQL running and setup complete:

```sh
npm run check            # TypeScript + pure domain tests
npm run engine:test      # optimizer/validator/internal HTTP boundary
npm run build
npm run test:api         # isolated PostgreSQL + production Next HTTP
npm run test:security    # auth, RLS, roles, tenant attacks, two processes, backup/restore
```

With the protected local engine running too:

```sh
npm run test:planning
npm run test:workforce
```

HTTP suites create and remove their own temporary databases. They never overwrite your restaurant workspace. No test makes a Strobbo request or publishes anything.

## Persistence and administration

The app now reads/writes PostgreSQL exclusively. Missing/unavailable PostgreSQL fails closed; there is no automatic fallback to JSON or an administrator demo session. Legacy workspace/run files are imported once into the first fictional tenant without modifying the files. Each restaurant has an independent versioned workspace and schedule-run namespace.

`npm run db:access -- list` lists memberships. The offline CLI can provision fictional accounts, enable/disable memberships and change roles; membership changes revoke sessions and append administrator audit events. `npm run db:backup` creates a private consistent logical backup; `npm run db:restore -- /path/to/backup.json` refuses nonempty or incompatible targets and requires sign-in after restore. See the detailed instructions below before using these commands.

## Documentation

- [Milestone 5: setup, security boundaries, administration, backups and remaining pilot gates](docs/milestone5.md)
- [Architecture](docs/architecture.md), [data model](docs/data-model.md), [optimization model](docs/optimization-model.md)
- [Generation/comparison workflow](docs/milestone3.md), [employee request workflow](docs/milestone4.md)
- [Roadmap](docs/roadmap.md), [verification](docs/verification.md), [backend](backend/README.md)

This is an authenticated local fictional-data environment, not a public production deployment or a legal-compliance certification. Real accounts/data, hosted operations and external synchronization require the remaining pilot reviews described in the roadmap.
