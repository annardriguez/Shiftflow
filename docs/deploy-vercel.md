# Full fictional demo on Vercel and Neon

This deployment uses Vercel's Container Runtime (beta) to run the existing Next.js app and protected Python OR-Tools service together. The engine binds to loopback only. A separate Neon PostgreSQL database persists identities, rosters, approvals and audit events across container restarts and instances. No embedded database is started in the cloud container, and no Strobbo connection is configured.

`Dockerfile.vercel` selects the container preset. `scripts/start-cloud.mjs` starts the protected engine, waits for health, then starts the web server on `$PORT`. `SHIFTFLOW_CLOUD=1` reads only explicit server environment settings; it never falls back to local runtime data. Remote connections must use Neon with `sslmode=verify-full`. All other local startup paths keep the loopback restriction.

Required production environment variables:

- `SHIFTFLOW_CLOUD=1`
- `SHIFTFLOW_APP_DATABASE_URL`: restricted `sf_app` role
- `SHIFTFLOW_AUTH_DATABASE_URL`: separate `sf_auth` role
- `SHIFTFLOW_AUTH_SECRET`: high-entropy private session secret
- `SHIFTFLOW_ENGINE_TOKEN`: high-entropy private engine key
- `SHIFTFLOW_PUBLIC_ORIGIN`: the exact public HTTPS origin

Never give the deployment the Neon database-owner connection string. Bootstrap is offline: `scripts/cloud-bootstrap.mts` creates the existing identity/application schema and restricted roles only in an empty dedicated database. It requires an owner with BYPASSRLS for the existing narrow, audited security-definer membership/session functions. Runtime roles have neither superuser nor BYPASSRLS permissions. `scripts/cloud-seed.mts` provisions the user-approved fictional Maastricht team and individual manager/employee passwords. Both scripts refuse to reset existing hosted data. Private bootstrap material and credentials stay under ignored `.data/cloud/` and are excluded from builds and archives.

Manager sign-ins are `eefje@shiftflow.test` and `osamah@shiftflow.test`. Employee emails use fictional `@maastricht.shiftflow.test` addresses. Passwords are generated individually, saved privately and never printed. The current account list is in `.data/cloud/fictional-accounts.json`, not in this repository.

The hosted app is a fictional demo, not approval to import real staff data. Desired staffing gaps are reported separately from mandatory validity. Container and free database usage are subject to provider quotas; cold starts are possible. Hosting does not certify real-world working-time rules.
