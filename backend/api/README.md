# Local FastAPI boundary

Implemented in Milestone 2. Launch from the project root with `npm run engine:dev`, then open http://127.0.0.1:8000/docs. The service accepts fictional inputs, runs bounded synchronous solves, and returns actual solver statuses plus independent validation. It never writes the manager workspace or contacts Strobbo. Real authentication, tenant isolation, durable jobs and swap application remain future work.

See ../README.md for the endpoint contract. Regenerate ../../backend/openapi.json with `npm run engine:openapi`.
