# Current local engine boundary — Milestone 5

Run the project PostgreSQL setup first, then `npm run engine:dev` from the project root. The wrapper loads the private engine service key and binds only to 127.0.0.1:8000. Operational endpoints require `x-shiftflow-engine-key`; the actual ASGI entry point fails closed without a configured key. `/health` remains non-sensitive and loopback-only. Browser employees never receive the key. The Next server captures tenant-authorized workspace inputs and persists results in tenant-scoped PostgreSQL records; the mathematical service itself never writes a roster or calls Strobbo.

The standalone `create_app()` test factory can be instantiated without a key for isolated tests. This does not change the protected deployed-local ASGI entry point. See [Milestone 5](../docs/milestone5.md). Older API examples below require the service key now; no public deployment is configured.

# ShiftFlow scheduling engine — Milestone 2

A standalone Python 3.12 / FastAPI / OR-Tools CP-SAT service for **fictional data only**. It never connects to Strobbo, writes the manager workspace, or uses a paid AI API. The existing Next.js app remains the manual planning workspace; the generated-roster comparison/save interface is Milestone 3.

## Local setup and launch

From the repository root:

```sh
npm run engine:setup
npm run engine:dev
```

Setup creates a local uv bootstrap in `.venv`, downloads a managed Python 3.12.16, and installs the exact dependencies in `backend/uv.lock` into `backend/.venv`. It does not replace system Python. Setup needs internet access; subsequent solves need no network service. If the project is stored in iCloud Drive, download it locally before setup/running.

Open [interactive API documentation](http://127.0.0.1:8000/docs). The launch command binds to 127.0.0.1:8000. Stop with Ctrl+C. No credentials or external configuration are required. The service is unauthenticated and local-only; do not expose it publicly or use real employee information.

If uv is already installed, equivalent commands from the repository root are:

```sh
uv sync --project backend --frozen
uv run --project backend --frozen uvicorn backend.api.main:app --host 127.0.0.1 --port 8000
```

## Run a real solve

```sh
curl --fail http://127.0.0.1:8000/v1/fixtures/normal -o /tmp/shiftflow-input.json
curl --fail -H 'Content-Type: application/json' \
  --data-binary @/tmp/shiftflow-input.json \
  http://127.0.0.1:8000/v1/schedule-runs -o /tmp/shiftflow-result.json
```

A request chooses 1–3 strategies. All three use the **same immutable input**, candidate set and normalization. Budgets are soft targets; mandatory headcount, qualifications and supervision cannot be bought off by weights. Alternatives can coincide, especially under short search limits; distinct schedules are not fabricated.

An HTTP 200 only means the API processed the request. Inspect every alternative's `status`, `validation.valid`, warnings and metrics. `OPTIMAL` proves optimality only for the finite candidate model and selected weights. `FEASIBLE` means a valid incumbent without proof of optimality. `UNKNOWN` is a timeout/resource outcome, not proof of infeasibility. `INFEASIBLE` returns no roster, with structured diagnostics. `VALIDATION_FAILED` withholds solver assignments rejected by independent checks.

## Endpoints

| Endpoint                      | Behavior                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| GET `/health`                 | Local service and installed solver version                                            |
| GET `/v1/fixtures/{scenario}` | Fictional solve input: normal, high-demand, shortage, infeasible                      |
| POST `/v1/schedule-runs`      | Bounded synchronous solve; returns run ID, snapshot hash and actual alternatives      |
| GET `/v1/schedule-runs/{id}`  | Retained response, at most 20 runs/30 minutes; lost on restart                        |
| POST `/v1/validate`           | Independent full-roster validation without a solver                                   |
| POST `/v1/workspace-snapshot` | Convert a v2 fictional workspace into explicit engine inputs without changing it      |
| POST `/v1/workspace-solve`    | Solve a supplied v2 fictional workspace snapshot without saving or publishing results |

The machine-readable contract is `backend/openapi.json`, generated from Pydantic/FastAPI. Canonical time quantities are **integer half-hour units** for paid hours and **integer local minutes** for clock windows; Rest uses UTC instants in the restaurant timezone. Inputs explicitly confirm fictional data and synthetic-rule verification. A missing employment minimum is rejected in canonical inputs, not inferred from a zero-hour contract.

## Architecture

- `optimizer/contracts.py`: immutable validated domain/HTTP contracts and bounded input sizes.
- `optimizer/candidates.py`: finite shift/break alternatives and admissible employee-shift pairs; baseline patterns remain available for stability/locks.
- `optimizer/model.py`: genuine CP-SAT decision variables, hard constraints, weighted objectives and named infeasibility assumptions.
- `optimizer/validation.py`: pure independent checks and maximum-matching supervision proof, with no OR-Tools imports.
- `optimizer/metrics.py`: independent paid hours, interval/skill coverage, preference/fairness diagnostics and objective recomputation.
- `optimizer/service.py`: immutable snapshot hashing and common-input scenario orchestration.
- `optimizer/workspace.py`: explicit adapter for the existing local workspace; no filesystem access or writes.
- `optimizer/fixtures.py` and `fixtures/workspaces.json`: deterministic fictional inputs derived from the existing TS fixtures, plus explicit fictional history and a revoked-closer infeasible case.
- `api/main.py`: HTTP validation, loopback/same-origin boundary, 2 MB body limit, one concurrent solve per process, and bounded ephemeral results.

## Checks and evidence

```sh
npm run engine:test       # Real solver, independent validator, and HTTP tests
npm run engine:verify     # All strategies for normal, high-demand, shortage and hard-infeasible inputs
npm run engine:openapi    # Regenerate the machine-readable contract
npm run engine:fixtures   # Re-export TS fictional inputs; never generates solver outputs
```

`engine:verify` writes actual results to `artifacts/engine-verification.json` without touching `.data/workspace.json`. Time limits and versions are recorded with results. Use `npm run engine:verify -- --seconds 15` for a longer bounded verification run.

See [implementation details and limitations](../docs/milestone2.md), [mathematical model](../docs/optimization-model.md), and [verification](../docs/verification.md).
