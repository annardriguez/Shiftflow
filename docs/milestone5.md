# Milestone 5 — local authentication and tenant persistence

## Current personalized demo (15 November 2026)

The primary local tenant is now **Eefje · Maastricht Hawaiian**, with 16 fictional profiles requested by the user. Eefje signs in as `eefje@shiftflow.test`; Osamah as `osamah@maastricht.shiftflow.test`. Their existing generated passwords are preserved in the private `.data/fictional-accounts.json`. Eefje's redundant employee login is inactive; her manager login is active. Osamah has a shift-leader profile and manager access. The old shared test manager's Maastricht membership is inactive; its Rotterdam membership is unchanged.

Nicole 1 cannot close. Juan, Giulia, Anna, Achraf, Yasmijn, Sahara, Milica, Tim and Nicole 2 have opening, closing and training competencies, per the user's explicit fictional setup. Lucía, Alex, Nore and Selma require training supervision. Manager access alone did not confer task qualifications on Eefje or Osamah. Availability is fictional 10:00–23:00 daily, with 11-hour rest and 9-hour maximum shifts. Preferred weekly hours are 16 for trainees and 24 for others; maxima are 24 and 40 respectively. Existing labour targets and saved shifts were preserved. Prior comparison snapshots and audit history are historical; new comparisons use workspace revision 1.

The one-time customization is recorded in PostgreSQL audit history and implemented by `scripts/customize-maastricht-demo.mts`; it refuses to reset later edits. A private database backup was taken first. Standard fixture reset controls still load the original generic fixtures, so they also reset these personalized demo profiles.

Port 3000 is currently occupied by another local tool. Start the web app with `SHIFTFLOW_ORIGIN=http://127.0.0.1:3001 npm start -- --port 3001` and open http://127.0.0.1:3001. The database and engine use the same local ports below. This localhost address only works on this Mac; show the demo in person or by screen sharing. No public hosting or Strobbo connection was added.

Implemented in the local working copy outside iCloud. All accounts, restaurants, qualifications and rosters remain fictional. No Strobbo connection, external identity provider, public deployment or outbound email is configured.

## Start and sign in

The local PostgreSQL installation is project-managed; Docker/Homebrew and a remote database are not required. Dependencies are pinned in package-lock.json. It runs a native PostgreSQL server bound to `127.0.0.1:54329` using SCRAM password authentication, with Unix sockets disabled.

Fresh setup, from this project:

```sh
npm ci
npm run db:start       # keep this terminal open
```

In another terminal:

```sh
npm run db:setup       # version/checksum-tracked application SQL + Better Auth migrations
npm run db:seed        # resumable fictional provisioning; never resets existing tenants/passwords
npm run engine:setup   # needed only if Python dependencies are not installed
npm run engine:dev     # keep this terminal open; supplies the private internal service key
```

Then `npm run dev` in a third terminal, or `npm run build` followed by `npm start`. Open http://127.0.0.1:3000. First-time access shows a password sign-in form; it never creates a manager session automatically.

Private initial credentials are in `.data/fictional-accounts.json` (mode 0600). The file is not served over HTTP or included in the source archive. It contains Jamie’s manager account for Utrecht, Robin’s manager account for Rotterdam, employee accounts per restaurant, and Alex’s explicitly assigned manager memberships in both fictional restaurants. Employees use their own passwords; managers cannot assume an employee identity. Password changes do not rewrite the initial-credentials file.

The first seed imports a materialized legacy `.data/workspace.json` and `.data/runs/*.json` into Utrecht if present, with an import SHA-256 receipt. Original files are left unchanged. If there is no saved workspace, it uses the existing fictional seed. Rotterdam receives a separate fictional dataset. Re-running seed preserves existing data and passwords. A private provisioning journal allows interrupted initialization to resume without silently resetting credentials.

Original manual fixtures may have skill gaps. Generate and save a feasible weekly roster before testing approved cover/swap flows, as in Milestone 4.

## Authentication and authorization

Password sign-in, password changes, opaque sessions, expiry, sign-out and revocation use pinned **Better Auth 1.7.25**, with the `pg` PostgreSQL driver. Public sign-up, OAuth, account deletion and recovery-email endpoints are not exposed. Passwords are hashed using the library’s password implementation; passwords are never stored in workspace data. Cookies are HttpOnly and SameSite=Strict. Cookie caching is disabled: each protected request verifies the database session and current membership. Sessions have an absolute eight-hour lifetime; sliding refresh is explicitly disabled. Password changes revoke other sessions; sign-out revokes the current session.

Local HTTP cookies intentionally do not use Secure because the app is loopback-only. This is not a public HTTPS deployment configuration. The library’s database-backed sign-in rate limit is enabled; the HTTP wrapper overwrites IP forwarding headers so callers cannot bypass it by claiming another IP. Tests use separate databases and an explicit higher attempt limit except in the dedicated rate-limit case.

Roles live in `app.memberships`, not in employee profiles or client claims. Each active membership links an authenticated user to exactly one restaurant and either manager authority or a specific employee ID. The same user may have different roles in different restaurants. A shift leader employment role or a competency badge does not grant manager access. Editing an employee contact email does not change their login email.

Every business API resolves the actor from the authenticated session, checks the selected restaurant membership and runs within an async-local actor context. Manager workspace, planning and legacy cover endpoints require manager access. Employee endpoints project only the caller’s profile, assignments, related requests and addressed notifications. A client cannot supply an actor, approval identity, role or tenant to a business mutation. The obsolete `/api/demo-session` endpoint returns 410 and never grants access.

Restaurant selection is a preference cookie, not authorization: selecting or forging an unassigned restaurant is rejected. Browser requests also send the restaurant context they were rendered for; a changed cookie in another tab cannot silently apply an old form to a different restaurant. A changed restaurant/role context or expired access causes a full client reload, clearing stale forms rather than retargeting their data. Authorization is rechecked inside database transactions, including active membership, role, employee linkage, live session and expiry. Membership/session locks serialize revocation with in-flight commits.

## PostgreSQL model and transaction boundary

- `auth.*`: library-managed users, credential accounts, sessions, verification and rate-limit tables. The auth runtime role has access to this schema, not restaurant data.
- `app.tenants`, `app.memberships`: restaurant identity and authoritative role/employee mappings, with foreign keys, role/linkage checks and uniqueness constraints.
- `app.workspaces`: one versioned JSONB aggregate per restaurant. This preserves the working v2 domain model and whole-roster operations rather than unnecessarily rewriting the scheduler. The database tenant key is authoritative; root `tenantId` is server-stamped.
- `app.schedule_runs`: immutable tenant-keyed snapshots/results; cross-restaurant run IDs cannot be read, validated or saved.
- `app.audit_events`, `app.request_events`: append-only history with composite tenant keys. New audit events include authenticated user/membership attribution. Historical pre-authentication actor labels remain historical, not retroactively verified identities.
- `app.imports`, `app.schema_migrations`: import receipt and applied migration/checksum history.

Runtime database roles are not superusers, table owners or BYPASSRLS roles. Tenant tables have enabled and forced row-level security. A transaction sets user/tenant context locally; policies check active database membership, so an unscoped query returns no tenant data. Run access is additionally manager-restricted. The application runtime role cannot update memberships, inspect credential/session tables, rewrite audit history or adopt the migration role; the separate auth role is limited to library-managed identity tables. A narrowly scoped security-definer function locks/checks the current membership and session without exposing tokens or granting role-edit permissions. Functions use fixed search paths.

The aggregate is read internally by the trusted application for full-roster validation. RLS provides the restaurant boundary; within-restaurant employee projection and action ownership are enforced by the server. Database credentials are never given to employees or browser code. This is not a direct-to-database browser API or a claim of per-field RLS inside JSONB.

A real PostgreSQL transaction locks the restaurant workspace row before checking expected revision and running independent engine validation. Assignments, request state, approvals, notifications, aggregate history and normalized history commit or roll back together. It works across multiple Node processes, replacing the former in-process queue/atomic-file-rename limit. Existing audit/request-history prefixes cannot be removed or changed, and database grants/triggers prohibit modifying normalized history. A failed database, stale revision, expired session or invalid roster never falls back to the old JSON store.

The engine remains a stateless mathematical service. Actual business tenant IDs are scoped by PostgreSQL and the server; the fictional engine adapter retains its canonical `restaurant-demo` identifier. Its operational endpoints now require a private server-to-server key. The real ASGI entry point fails closed without a key, while isolated unit-test app factories remain testable. Only a non-sensitive loopback health endpoint is available without the key. Employees cannot use the engine service to bypass schedule persistence or tenant authorization.

## Local administration

Administration requires the private local database administrator configuration. It is not an employee/manager HTTP endpoint.

```sh
npm run db:access -- list
npm run db:access -- provision --tenant RESTAURANT_UUID --email new-person@shiftflow.test --role employee --employee EMPLOYEE_ID
npm run db:access -- disable --membership MEMBERSHIP_UUID
npm run db:access -- enable --membership MEMBERSHIP_UUID
npm run db:access -- role --membership MEMBERSHIP_UUID --role manager
```

Provisioning creates a random password and writes private account credentials under `.data/accounts/`; it does not send an email. An employee profile must exist in that restaurant before linking employee access. To change a membership to employee, pass `--role employee --employee EMPLOYEE_ID`. Membership changes revoke all that user’s sessions and append an administrator event to PostgreSQL audit history. Existing accounts/passwords are not reset by seed or provision. The local database administrator can access all tenants and must not be exposed through an app endpoint.

## Backups and restore

```sh
npm run db:backup
npm run db:restore -- /absolute/path/to/private-backup.json
```

Backup uses a consistent repeatable-read transaction across identities, memberships, workspaces, runs and history. Files contain password hashes and restaurant data, are private (0600), and must not be published. Restore accepts only an empty, already migrated local database with matching migration versions/checksums; it refuses to overwrite data and rolls back on error. Sessions and one-time tokens are deliberately not restored: users sign in again. For a different target, use a separate private runtime configuration/database and run setup there first. Tests restored into a distinct temporary PostgreSQL database and verified access and isolation again.

The source archive excludes `.data`, credentials, secrets, database files, backups, dependencies and build output. Runtime/admin configurations are split; no administrator connection is imported by a route or client component.

## Verified scope and remaining gates

Automated tests cover credentials, cookies, disabled registration/demo selection, employee/manager boundaries, role changes, membership revocation, token tampering/expiry/logout, password-change revocation, rate limiting, cross-tenant IDs/claims/runs/requests, unscoped SQL, runtime privilege limits, append-only history, cross-process concurrent writes, import compatibility, and backup/restore. Existing generation, edit/save/export and full cover/swap/approval suites run against real PostgreSQL and the protected independent Python engine, each in isolated databases.

Browser checks verified manager and employee password sign-in, logout, mobile employee layout without horizontal overflow, and authorized switching between Utrecht and Rotterdam with correct restaurant data. A physical PostgreSQL stop/start preserved the exact workspace and authenticated session; during the outage the app failed closed without serving a fallback roster and recovered without restarting the web server. No project roster was replaced during these checks.

This completes the requested **local** authentication, role-based access, PostgreSQL persistence and tenant isolation milestone. It is not approval for a real pilot or public deployment. Production HTTPS/secrets/backup operations, MFA/recovery/invitations, tenant lifecycle/privacy/retention policy, security review, authenticated integration authorization, cross-restaurant shared-worker rules and manager/qualified legal review remain explicit future gates. No legal compliance or real-data readiness is claimed.

Implementation references: [Better Auth email/password](https://better-auth.com/docs/authentication/email-password), [session management](https://better-auth.com/docs/concepts/session-management), [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [embedded PostgreSQL package](https://github.com/leinelissen/embedded-postgres). Installed/locked versions and observed tests, not assumptions about hosted providers, govern this local implementation.
