"""Local-only HTTP boundary. No persistence or imports from the existing UI data store."""

import os
import secrets
from collections import OrderedDict
from datetime import UTC, datetime
from threading import BoundedSemaphore, Lock
from time import monotonic
from urllib.parse import urlsplit

import ortools
from backend.optimizer.candidates import ResourceLimit
from backend.optimizer.contracts import (
    SchedulingInput,
    SolveRequest,
    SolveResponse,
    ValidationReport,
    ValidationRequest,
)
from backend.optimizer.fixtures import Scenario, fixture
from backend.optimizer.service import optimize
from backend.optimizer.validation import validate_assignments
from backend.optimizer.workspace import WorkspaceRequest
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from starlette.responses import JSONResponse


class LocalBoundary:
    """Loopback Host/same-Origin restriction and bounded HTTP body before JSON parsing.

    Not authentication; the launch command also binds exclusively to loopback.
    """

    def __init__(self, app, require_key=False):
        self.app = app
        self.key = os.environ.get("SHIFTFLOW_ENGINE_TOKEN")
        if (require_key or os.environ.get("SHIFTFLOW_ENGINE_REQUIRE_KEY") == "1") and not self.key:
            raise RuntimeError("Engine service key is required")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        host = headers.get(b"host", b"").decode()
        origin = headers.get(b"origin", b"").decode()
        try:
            local = urlsplit(f"http://{host}").hostname in {"localhost", "127.0.0.1", "::1"}
            if origin:
                source = urlsplit(origin)
                local = local and source.netloc == host and source.scheme == scope["scheme"]
        except ValueError:
            local = False
        if not local:
            return await JSONResponse(
                {"detail": "Local fictional-data service; external hosts/origins are not allowed"},
                403,
            )(scope, receive, send)
        if self.key and scope["path"] != "/health":
            supplied = headers.get(b"x-shiftflow-engine-key", b"")
            if not secrets.compare_digest(supplied, self.key.encode()):
                return await JSONResponse({"detail": "Internal engine credentials required"}, 401)(
                    scope, receive, send
                )
        if scope["method"] in {"POST", "PUT", "PATCH"}:
            chunks, size = [], 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                size += len(chunk)
                if size > 2_000_000:
                    return await JSONResponse(
                        {"detail": "Snapshot exceeds the 2 MB request limit"}, 413
                    )(scope, receive, send)
                chunks.append(chunk)
                if not message.get("more_body", False):
                    break
            body, sent = b"".join(chunks), False

            async def replay():
                nonlocal sent
                if not sent:
                    sent = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await receive()

            return await self.app(scope, replay, send)
        return await self.app(scope, receive, send)


def create_app(require_key: bool = False) -> FastAPI:
    application = FastAPI(
        title="ShiftFlow Scheduling Engine",
        version="0.2.0",
        description="Local fictional-data CP-SAT service. A 200 response does not imply a valid roster: inspect each alternative's status and validation.valid. No Strobbo integration.",
    )
    application.add_middleware(LocalBoundary, require_key=require_key)
    capacity = BoundedSemaphore(1)
    cache_lock = Lock()
    results: OrderedDict[str, tuple[float, SolveResponse]] = OrderedDict()

    def remember(response: SolveResponse):
        with cache_lock:
            results[response.run_id] = (monotonic(), response)
            while len(results) > 20:
                results.popitem(last=False)

    def run(request: SolveRequest) -> SolveResponse:
        if not capacity.acquire(blocking=False):
            raise HTTPException(
                429,
                "A solve is already running in this local process; retry when it finishes",
                headers={"Retry-After": "5"},
            )
        try:
            response = optimize(request)
            remember(response)
            return response
        except ResourceLimit as exc:
            raise HTTPException(422, str(exc)) from exc
        finally:
            capacity.release()

    @application.get("/health")
    def health():
        return {
            "status": "ok",
            "engine": "OR-Tools CP-SAT",
            "solver_version": ortools.__version__,
            "fictional_data_only": True,
            "external_sync": "not_connected",
            "at": datetime.now(UTC),
        }

    @application.get("/v1/fixtures/{scenario}", response_model=SolveRequest)
    def get_fixture(scenario: Scenario):
        return fixture(scenario)

    @application.post("/v1/schedule-runs", response_model=SolveResponse)
    def schedule_run(request: SolveRequest):
        """Bounded synchronous run. Returns genuine statuses, including UNKNOWN/INFEASIBLE."""
        return run(request)

    @application.get("/v1/schedule-runs/{run_id}", response_model=SolveResponse)
    def get_run(run_id: str):
        with cache_lock:
            item = results.get(run_id)
            if not item or monotonic() - item[0] > 1800:
                results.pop(run_id, None)
                raise HTTPException(
                    404, "Run not retained; local results expire after 30 minutes or restart"
                )
            return item[1]

    @application.post("/v1/validate", response_model=ValidationReport)
    def validate(request: ValidationRequest):
        return validate_assignments(request.snapshot, request.assignments)

    @application.post("/v1/workspace-snapshot", response_model=SchedulingInput)
    def workspace_snapshot(request: WorkspaceRequest):
        try:
            return request.to_request().snapshot
        except (ValueError, ValidationError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @application.post("/v1/workspace-solve", response_model=SolveResponse)
    def workspace_solve(request: WorkspaceRequest):
        try:
            converted = request.to_request()
        except (ValueError, ValidationError) as exc:
            raise HTTPException(422, str(exc)) from exc
        return run(converted)

    return application


app = create_app(require_key=True)
