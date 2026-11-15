"""Pure orchestration; one immutable input and normalization for all strategy solves."""

from hashlib import sha256

from .candidates import prepare
from .contracts import DEFAULT_WEIGHTS, SchedulingInput, SolveRequest, SolveResponse
from .model import solve


def snapshot_id(p: SchedulingInput) -> str:
    return sha256(p.model_dump_json().encode()).hexdigest()


def optimize(request: SolveRequest) -> SolveResponse:
    # JSON round-trip severs any mutable reference a library caller may have retained.
    p = SchedulingInput.model_validate_json(request.snapshot.model_dump_json())
    prepared = prepare(p)
    results = tuple(
        solve(
            p,
            strategy,
            request.options,
            request.options.weights or DEFAULT_WEIGHTS[strategy],
            prepared,
        )
        for strategy in request.strategies
    )
    return SolveResponse(
        input_snapshot_id=snapshot_id(p), source_revision=p.source_revision, alternatives=results
    )
