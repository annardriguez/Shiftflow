"""Existing synthetic inputs, adapted into a reproducible solver snapshot."""

import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal

from .contracts import History, SolveRequest
from .workspace import WorkspaceRequest

Scenario = Literal["normal", "high-demand", "shortage", "infeasible"]


@lru_cache(maxsize=1)
def _source():
    return json.loads((Path(__file__).parents[1] / "fixtures" / "workspaces.json").read_text())


def fixture(scenario: Scenario = "normal") -> SolveRequest:
    source = _source()["shortage" if scenario == "infeasible" else scenario]
    request = WorkspaceRequest(
        fictional_data=True, rules_verified_for_demo=True, workspace=source, week_start="2026-11-16"
    ).to_request()
    employees = []
    for i, e in enumerate(request.snapshot.employees):
        history = History(
            paid_units=max(0, e.preferred_max_units * 4 - (i % 4) * 8),
            desired_units=e.preferred_max_units * 4,
            unpopular_shifts=i % 5,
        )
        qualifications = e.qualifications
        if scenario == "infeasible":
            qualifications = tuple(
                q.model_copy(update={"revoked_at": datetime(2026, 11, 16, tzinfo=timezone.utc)})
                if q.skill_id == "close"
                else q
                for q in qualifications
            )
        employees.append(
            e.model_copy(update={"history": history, "qualifications": qualifications})
        )
    return request.model_copy(
        update={
            "snapshot": request.snapshot.model_copy(
                update={
                    "employees": tuple(employees),
                    "history_window": "Four deterministically generated fictional prior weeks",
                }
            )
        }
    )
