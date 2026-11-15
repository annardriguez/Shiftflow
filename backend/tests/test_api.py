import asyncio
import json
from pathlib import Path
from threading import Event

import httpx
from backend.api.main import create_app
from backend.optimizer.contracts import SolveOptions, SolveRequest


def request(app, method, path, **kwargs):
    async def call():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
        ) as c:
            return await c.request(method, path, **kwargs)

    return asyncio.run(call())


def test_health_openapi_and_fictional_fixtures():
    app = create_app()
    assert request(app, "GET", "/health").json()["external_sync"] == "not_connected"
    schema = request(app, "GET", "/openapi.json").json()
    assert "/v1/schedule-runs" in schema["paths"] and "/v1/validate" in schema["paths"]
    for scenario in ["normal", "high-demand", "shortage", "infeasible"]:
        r = request(app, "GET", f"/v1/fixtures/{scenario}")
        assert r.status_code == 200
        parsed = SolveRequest.model_validate(r.json())
        assert len(parsed.snapshot.employees) == 15 and parsed.snapshot.fictional_data
    assert request(app, "GET", "/v1/fixtures/unknown").status_code == 422


def test_http_solve_retention_and_independent_validation(tiny):
    app = create_app()
    payload = SolveRequest(snapshot=tiny, strategies=("balanced",)).model_dump(mode="json")
    r = request(app, "POST", "/v1/schedule-runs", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["alternatives"][0]["status"] == "OPTIMAL"
    assert body["alternatives"][0]["validation"]["valid"]
    assert request(app, "GET", f"/v1/schedule-runs/{body['run_id']}").json() == body
    assert request(create_app(), "GET", f"/v1/schedule-runs/{body['run_id']}").status_code == 404
    validate = request(
        app,
        "POST",
        "/v1/validate",
        json={
            "snapshot": payload["snapshot"],
            "assignments": body["alternatives"][0]["assignments"],
        },
    )
    assert validate.status_code == 200 and validate.json()["valid"]
    assert request(app, "GET", "/v1/schedule-runs/missing").status_code == 404


def test_http_200_does_not_claim_infeasible_is_valid(tiny):
    employees = tuple(
        e.model_copy(
            update={"qualifications": tuple(q for q in e.qualifications if q.skill_id != "close")}
        )
        for e in tiny.employees
    )
    p = tiny.model_copy(update={"employees": employees})
    payload = SolveRequest(snapshot=p, strategies=("balanced",)).model_dump(mode="json")
    r = request(create_app(), "POST", "/v1/schedule-runs", json=payload)
    assert r.status_code == 200
    assert r.json()["alternatives"][0]["status"] == "INFEASIBLE"
    assert not r.json()["alternatives"][0]["assignments"]


def test_unknown_status_and_input_rejections(tiny):
    app = create_app()
    payload = SolveRequest(
        snapshot=tiny, strategies=("balanced",), options=SolveOptions(max_seconds_per_strategy=0)
    ).model_dump(mode="json")
    assert (
        request(app, "POST", "/v1/schedule-runs", json=payload).json()["alternatives"][0]["status"]
        == "UNKNOWN"
    )
    payload["snapshot"]["fictional_data"] = False
    assert request(app, "POST", "/v1/schedule-runs", json=payload).status_code == 422
    assert request(app, "POST", "/v1/schedule-runs", content="{bad").status_code == 422
    assert request(app, "POST", "/v1/schedule-runs", content="x" * 2_000_001).status_code == 413
    assert request(app, "GET", "/health", headers={"Host": "example.test"}).status_code == 403
    assert (
        request(app, "GET", "/health", headers={"Origin": "https://example.test"}).status_code
        == 403
    )


def test_workspace_adapter_preserves_input_and_does_not_touch_local_draft():
    data = json.loads((Path(__file__).parents[1] / "fixtures/workspaces.json").read_text())[
        "normal"
    ]
    before = json.dumps(data, sort_keys=True)
    r = request(
        create_app(),
        "POST",
        "/v1/workspace-snapshot",
        json={
            "workspace": data,
            "fictional_data": True,
            "rules_verified_for_demo": True,
            "week_start": "2026-11-16",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["source_revision"] == data["revision"] and len(body["baseline"]) == len(
        data["weeks"][0]["shifts"]
    )
    assert all(e["history"]["paid_units"] == 0 for e in body["employees"])
    assert "No history supplied" in body["history_window"]
    assert json.dumps(data, sort_keys=True) == before


def test_workspace_adapter_fails_closed_for_unreviewed_skills():
    data = json.loads((Path(__file__).parents[1] / "fixtures/workspaces.json").read_text())[
        "normal"
    ]
    for e in data["employees"]:
        e["skillsReviewedAt"] = None
    body = {
        "workspace": data,
        "fictional_data": True,
        "rules_verified_for_demo": True,
        "week_start": "2026-11-16",
        "strategies": ["balanced"],
        "options": {
            "max_seconds_per_strategy": 2,
            "deterministic_time_limit": 1,
            "random_seed": 17,
        },
    }
    r = request(create_app(), "POST", "/v1/workspace-solve", json=body)
    assert r.status_code == 200 and r.json()["alternatives"][0]["status"] == "INFEASIBLE"
    assert not r.json()["alternatives"][0]["assignments"]


def test_concurrent_solve_is_rejected_instead_of_unbounded_queue(tiny, monkeypatch):
    import backend.api.main as module

    actual = module.optimize
    entered, release = Event(), Event()

    def blocking(req):
        entered.set()
        assert release.wait(5)
        return actual(req)

    monkeypatch.setattr(module, "optimize", blocking)

    async def check():
        app = create_app()
        payload = SolveRequest(snapshot=tiny, strategies=("balanced",)).model_dump(mode="json")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
        ) as c:
            first = asyncio.create_task(c.post("/v1/schedule-runs", json=payload))
            assert await asyncio.to_thread(entered.wait, 5)
            try:
                second = await c.post("/v1/schedule-runs", json=payload)
                assert second.status_code == 429
            finally:
                release.set()
            assert (await first).status_code == 200

    asyncio.run(check())


def test_workspace_future_week_keeps_scenario_recommendations():
    data = json.loads((Path(__file__).parents[1] / "fixtures/workspaces.json").read_text())[
        "high-demand"
    ]
    response = request(
        create_app(),
        "POST",
        "/v1/workspace-snapshot",
        json={
            "workspace": data,
            "fictional_data": True,
            "rules_verified_for_demo": True,
            "week_start": "2026-11-23",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert [b["paid_units"] for b in body["budgets"]] == [80, 80, 84, 88, 104, 112, 96]
    assert not body["baseline"]
    assert body["boundary_assignments"]


def test_workspace_dated_availability_overrides_recurring_windows():
    data = json.loads((Path(__file__).parents[1] / "fixtures/workspaces.json").read_text())[
        "normal"
    ]
    data["employees"][0]["availabilityOverrides"] = [
        {"date": "2026-11-16", "window": None},
        {"date": "2026-11-17", "window": {"start": 720, "end": 900}},
    ]
    r = request(
        create_app(),
        "POST",
        "/v1/workspace-snapshot",
        json={
            "workspace": data,
            "fictional_data": True,
            "rules_verified_for_demo": True,
            "week_start": "2026-11-16",
        },
    )
    assert r.status_code == 200
    availability = r.json()["employees"][0]["availability"]
    assert availability[0]["windows"] == []
    assert availability[1]["windows"] == [{"start": 720, "end": 900}]
    assert availability[2]["windows"] == [data["employees"][0]["availability"][2]]


def test_workspace_duplicate_override_dates_are_rejected():
    data = json.loads((Path(__file__).parents[1] / "fixtures/workspaces.json").read_text())[
        "normal"
    ]
    override = {"date": "2026-11-16", "window": None}
    data["employees"][0]["availabilityOverrides"] = [override, override]
    r = request(
        create_app(),
        "POST",
        "/v1/workspace-snapshot",
        json={
            "workspace": data,
            "fictional_data": True,
            "rules_verified_for_demo": True,
            "week_start": "2026-11-16",
        },
    )
    assert r.status_code == 422


def test_internal_engine_key_blocks_operational_endpoints(monkeypatch):
    monkeypatch.setenv("SHIFTFLOW_ENGINE_TOKEN", "fictional-service-key-for-testing")
    app = create_app(require_key=True)
    assert request(app, "GET", "/health").status_code == 200
    assert request(app, "GET", "/v1/fixtures/normal").status_code == 401
    assert (
        request(
            app, "GET", "/v1/fixtures/normal", headers={"x-shiftflow-engine-key": "wrong"}
        ).status_code
        == 401
    )
    assert (
        request(
            app,
            "GET",
            "/v1/fixtures/normal",
            headers={"x-shiftflow-engine-key": "fictional-service-key-for-testing"},
        ).status_code
        == 200
    )


def test_internal_engine_cannot_run_without_required_key(monkeypatch):
    import pytest

    monkeypatch.delenv("SHIFTFLOW_ENGINE_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="key is required"):
        request(create_app(require_key=True), "GET", "/health")
