"""Run actual solver scenarios and save evidence; never writes the manager workspace."""

import argparse
import json
from pathlib import Path

from backend.optimizer.contracts import SolveOptions
from backend.optimizer.fixtures import fixture
from backend.optimizer.service import optimize

parser = argparse.ArgumentParser()
parser.add_argument("--seconds", type=float, default=8)
parser.add_argument("--output", default="artifacts/engine-verification.json")
args = parser.parse_args()
report = {}
for scenario in ("normal", "high-demand", "shortage", "infeasible"):
    request = fixture(scenario).model_copy(
        update={
            "options": SolveOptions(
                max_seconds_per_strategy=args.seconds, deterministic_time_limit=2
            )
        }
    )
    response = optimize(request)
    report[scenario] = response.model_dump(mode="json")
    for result in response.alternatives:
        if scenario == "infeasible":
            assert result.status == "INFEASIBLE" and not result.assignments, (
                result.status
            )
        else:
            assert result.status in {"OPTIMAL", "FEASIBLE"}, result.status
            assert result.validation and result.validation.valid
            assert result.metrics
        print(
            json.dumps(
                {
                    "scenario": scenario,
                    "strategy": result.strategy,
                    "status": result.status,
                    "hours": result.metrics.total_paid_hours
                    if result.metrics
                    else None,
                    "coverage_percent": result.metrics.target_coverage_percent
                    if result.metrics
                    else None,
                    "validated": result.validation.valid if result.validation else None,
                    "runtime_seconds": result.metadata.runtime_seconds,
                }
            ),
            flush=True,
        )
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + "\n")
print(f"Saved actual solver evidence to {args.output}", flush=True)
