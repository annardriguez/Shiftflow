from datetime import UTC, date, datetime, timedelta
import pytest
from pydantic import ValidationError

from backend.optimizer.candidates import prepare
from backend.optimizer.contracts import (
    Assignment,
    Availability,
    DEFAULT_WEIGHTS,
    Generation,
    HeadcountRequirement,
    Qualification,
    SkillRequirement,
    SolveOptions,
    SolveRequest,
    Weights,
    Window,
)
from backend.optimizer.metrics import context, evaluate
from backend.optimizer.model import solve
from backend.optimizer.service import optimize, snapshot_id
from backend.optimizer.time_math import instant
from backend.optimizer.validation import validate_assignments


def run(p, strategy="balanced", seconds=5, **options):
    return solve(
        p,
        strategy,
        SolveOptions(max_seconds_per_strategy=seconds, **options),
        DEFAULT_WEIGHTS[strategy],
    )


def assignment(p, eid="e0", **updates):
    return Assignment(
        id="shift", employee_id=eid, day=p.week_start, start=600, end=840, kind="Opening", **updates
    )


def employees(p, **changes):
    return p.model_copy(
        update={"employees": tuple(e.model_copy(update=changes.get(e.id, {})) for e in p.employees)}
    )


def test_real_solver_produces_independently_valid_roster(tiny):
    result = run(tiny)
    assert result.status == "OPTIMAL"
    assert result.validation.valid
    assert result.assignments
    assert result.metadata.solver == "OR-Tools CP-SAT"
    assert result.metadata.best_bound == result.metadata.integer_objective
    assert validate_assignments(tiny, result.assignments).valid


def test_all_strategies_solve_same_snapshot_and_different_budget_tradeoffs(tiny):
    response = optimize(SolveRequest(snapshot=tiny))
    assert response.input_snapshot_id == snapshot_id(tiny)
    assert response.external_sync == "not_connected"
    assert all(s.status == "OPTIMAL" and s.validation.valid for s in response.alternatives)
    budget, balanced, coverage = response.alternatives
    assert budget.metrics.total_paid_hours < coverage.metrics.total_paid_hours
    assert budget.metrics.uncovered_person_hours > coverage.metrics.uncovered_person_hours
    for key in budget.objective_components:
        assert len({s.objective_components[key].denominator for s in response.alternatives}) == 1


def test_unavailable_and_absent_people_are_never_assigned(tiny):
    p = employees(tiny, e0={"availability": ()}, e1={"absent_dates": (tiny.week_start,)})
    r = run(p)
    assert r.status == "INFEASIBLE" and not r.assignments
    assert any(d.code == "skill_coverage" for d in r.diagnostics)


def test_mandatory_closer_cannot_be_relaxed_by_any_strategy(tiny):
    p = tiny.model_copy(
        update={
            "employees": tuple(
                e.model_copy(
                    update={
                        "qualifications": tuple(
                            q for q in e.qualifications if q.skill_id != "close"
                        )
                    }
                )
                for e in tiny.employees
            )
        }
    )
    for strategy in DEFAULT_WEIGHTS:
        r = run(p, strategy)
        assert r.status == "INFEASIBLE" and not r.assignments
        assert any(i.skill_id == "close" and i.actual == 0 for i in r.diagnostics)


def test_trainee_alone_fails_independent_validation(tiny):
    r = validate_assignments(tiny, (assignment(tiny, "e2"),))
    assert not r.valid and any(i.code == "supervision" for i in r.issues)


def test_solver_pairs_required_trainee_with_independent_supervisor(tiny):
    trainee = tiny.employees[2]
    p = employees(tiny, e2={"rules": trainee.rules.model_copy(update={"min_weekly_units": 8})})
    r = run(p)
    assert r.validation.valid
    assert any(s.employee_id == "e2" for s in r.assignments)
    assert len(r.validation.supervision_pairings) == 8
    assert all(pair.supervisor_id in {"e0", "e1"} for pair in r.validation.supervision_pairings)


def test_required_trainee_without_supervisor_is_infeasible(tiny):
    p = employees(
        tiny,
        e0={
            "qualifications": tuple(
                q for q in tiny.employees[0].qualifications if q.skill_id != "train"
            )
        },
        e1={
            "qualifications": tuple(
                q for q in tiny.employees[1].qualifications if q.skill_id != "train"
            )
        },
        e2={"rules": tiny.employees[2].rules.model_copy(update={"min_weekly_units": 8})},
    )
    r = run(p)
    assert r.status == "INFEASIBLE" and not r.assignments
    assert any(i.code in {"supervision", "employment"} for i in r.diagnostics)


def test_shared_supervision_capacity_across_different_task_groups(tiny):
    first = tiny.employees[2]
    second = first.model_copy(
        update={"id": "e3", "name": "Second fictional trainee", "supervision_skill_id": "open"}
    )
    p = tiny.model_copy(update={"employees": (tiny.employees[0], first, second)})
    assignments = (
        assignment(p),
        assignment(p, "e2").model_copy(update={"id": "t1"}),
        assignment(p, "e3").model_copy(update={"id": "t2"}),
    )
    r = validate_assignments(p, assignments)
    assert any(i.code == "supervision" for i in r.issues)
    assert validate_assignments(p.model_copy(update={"supervision_capacity": 2}), assignments).valid
    # Force both trainees: the solver must also reject the shared-capacity violation.
    forced = p.model_copy(
        update={
            "employees": tuple(
                e.model_copy(update={"rules": e.rules.model_copy(update={"min_weekly_units": 8})})
                for e in p.employees
            )
        }
    )
    assert run(forced).status == "INFEASIBLE"
    assert run(forced.model_copy(update={"supervision_capacity": 2})).validation.valid


def test_breaks_reduce_paid_hours_and_supervision(tiny):
    supervisor = assignment(tiny).model_copy(
        update={"id": "supervisor", "break_start": 720, "break_minutes": 30}
    )
    trainee = assignment(tiny, "e2").model_copy(update={"id": "trainee"})
    report = validate_assignments(tiny, (supervisor, trainee))
    assert supervisor.paid_units == 7
    assert any(i.code == "supervision" and i.minute == 720 for i in report.issues)


def test_staggered_qualified_closers_cover_every_required_interval(tiny):
    a = assignment(tiny).model_copy(update={"end": 810})
    b = assignment(tiny, "e1").model_copy(update={"id": "second", "start": 810, "kind": "Closing"})
    p = tiny.model_copy(
        update={"headcount": (), "skill_requirements": (tiny.skill_requirements[1],)}
    )
    assert not any(i.code == "skill_coverage" for i in validate_assignments(p, (a, b)).issues)
    b = b.model_copy(
        update={"start": 840}
    )  # validator can still inspect a malformed library object
    assert any(i.code == "skill_coverage" for i in validate_assignments(p, (a, b)).issues)


def test_personal_duty_requires_assigned_employee_qualification(tiny):
    p = tiny.model_copy(update={"skill_requirements": (), "headcount": ()})
    s = assignment(p, "e2", required_skills=("close",))
    report = validate_assignments(
        p, (s, assignment(p).model_copy(update={"id": "qualified-colleague"}))
    )
    assert any(i.code == "personal_qualification" and i.employee_id == "e2" for i in report.issues)


def test_overlaps_rest_and_boundary_rules_are_independent_checks(tiny):
    first = assignment(tiny)
    second = first.model_copy(update={"id": "other", "start": 660})
    assert any(
        i.code == "overlap_or_rest" for i in validate_assignments(tiny, (first, second)).issues
    )
    boundary = Assignment(
        id="previous",
        employee_id="e0",
        day=tiny.week_start - timedelta(days=1),
        start=1080,
        end=1380,
        kind="Closing",
    )
    p = tiny.model_copy(
        update={
            "operating_window": Window(start=600, end=1380),
            "boundary_assignments": (boundary,),
        }
    )
    assert validate_assignments(
        p, (first,)
    ).valid  # exactly 11 elapsed hours satisfies the boundary rest rule
    from backend.optimizer.time_math import conflicting

    assert not conflicting(first, boundary, p.timezone, 660)
    assert conflicting(first.model_copy(update={"start": 570}), boundary, p.timezone, 660)


def test_rest_uses_real_elapsed_amsterdam_dst_time():
    assert (
        instant(date(2027, 3, 28), 600, "Europe/Amsterdam")
        - instant(date(2027, 3, 27), 1380, "Europe/Amsterdam")
    ).total_seconds() == 10 * 3600
    assert (
        instant(date(2026, 10, 25), 600, "Europe/Amsterdam")
        - instant(date(2026, 10, 24), 1380, "Europe/Amsterdam")
    ).total_seconds() == 12 * 3600
    with pytest.raises(ValueError, match="Ambiguous"):
        instant(date(2026, 10, 25), 150, "Europe/Amsterdam")


def test_weekly_minimum_and_maximum_are_hard_constraints(tiny):
    p = employees(
        tiny,
        e0={
            "rules": tiny.employees[0].rules.model_copy(
                update={"min_weekly_units": 9, "max_weekly_units": 9}
            )
        },
    )
    assert run(p).status == "INFEASIBLE"
    p = employees(
        tiny, e0={"rules": tiny.employees[0].rules.model_copy(update={"max_weekly_units": 0})}
    )
    r = run(p)
    assert all(s.employee_id != "e0" for s in r.assignments)
    assert r.validation.valid


def test_rolling_limits_and_consecutive_days_span_boundaries(tiny):
    fixed = Assignment(
        id="prior",
        employee_id="e0",
        day=tiny.week_start - timedelta(days=1),
        start=600,
        end=840,
        kind="Opening",
    )
    p = tiny.model_copy(update={"boundary_assignments": (fixed,)})
    p = employees(
        p,
        e0={
            "rules": p.employees[0].rules.model_copy(
                update={"max_rolling_seven_day_units": 8, "max_consecutive_days": 1}
            )
        },
    )
    report = validate_assignments(p, (assignment(p),))
    assert any(i.code == "rolling_hours" for i in report.issues)
    assert any(i.code == "consecutive_days" for i in report.issues)
    r = run(p)
    assert r.validation.valid and all(s.employee_id != "e0" for s in r.assignments)


def test_qualification_expiry_inside_interval_is_not_covered(tiny):
    expiry = datetime(2026, 11, 16, 12, 30, tzinfo=UTC)  # 13:30 Amsterdam
    p = tiny.model_copy(
        update={
            "employees": tuple(
                e.model_copy(
                    update={
                        "qualifications": tuple(
                            q.model_copy(update={"expires_at": expiry})
                            if q.skill_id == "close"
                            else q
                            for q in e.qualifications
                        )
                    }
                )
                for e in tiny.employees
            )
        }
    )
    r = run(p)
    assert r.status == "INFEASIBLE"
    assert any(i.skill_id == "close" and i.minute == 810 for i in r.diagnostics)


def test_locked_assignment_survives_with_arbitrary_existing_break_pattern(tiny):
    baseline = assignment(tiny).model_copy(update={"break_start": 690, "break_minutes": 30})
    p = tiny.model_copy(update={"baseline": (baseline,), "locked_assignment_ids": ("shift",)})
    r = run(p)
    assert r.validation.valid
    assert baseline in r.assignments


def test_invalid_locked_assignment_reports_hard_infeasibility(tiny):
    baseline = assignment(tiny)
    p = employees(tiny, e0={"availability": ()}).model_copy(
        update={"baseline": (baseline,), "locked_assignment_ids": ("shift",)}
    )
    r = run(p)
    assert r.status == "INFEASIBLE" and not r.assignments
    assert any(i.code in {"locked_assignment", "availability"} for i in r.diagnostics)


def test_zero_budgets_are_soft_not_hard_ceilings(tiny):
    p = tiny.model_copy(
        update={"budgets": tuple(b.model_copy(update={"paid_units": 0}) for b in tiny.budgets)}
    )
    r = run(p, "budget-first")
    assert r.validation.valid and r.metrics.total_paid_hours > 0
    assert r.metrics.budget_deviation_hours > 0


def test_desired_coverage_shortfalls_return_explicit_intervals(tiny):
    p = tiny.model_copy(
        update={"headcount": (tiny.headcount[0].model_copy(update={"target": 10}),)}
    )
    r = run(p)
    assert r.validation.valid
    assert r.metrics.uncovered_intervals and r.metrics.uncovered_person_hours > 0
    assert any("unmet desired" in w for w in r.warnings)


def test_impossible_mandatory_headcount_is_not_a_soft_shortage(tiny):
    p = tiny.model_copy(
        update={"headcount": (tiny.headcount[0].model_copy(update={"target": 4, "mandatory": 4}),)}
    )
    r = run(p)
    assert r.status == "INFEASIBLE" and not r.assignments
    assert any(i.code == "mandatory_headcount" for i in r.diagnostics)


def test_all_components_are_recomputed_exactly_from_assignments(tiny):
    r = run(tiny)
    problem = prepare(tiny)
    comp, metrics = evaluate(
        tiny, problem, context(tiny, problem), r.assignments, DEFAULT_WEIGHTS["balanced"]
    )
    assert comp == r.objective_components and metrics == r.metrics
    assert sum(c.weighted_integer for c in comp.values()) == r.metadata.integer_objective
    assert sum(s.paid_units for s in r.assignments) / 2 == metrics.total_paid_hours


def test_fairness_handles_zero_references_and_unavailable_people(tiny):
    p = employees(tiny, e2={"preferred_min_units": 0, "preferred_max_units": 0, "availability": ()})
    r = run(p)
    m = next(e for e in r.metrics.employees if e.employee_id == "e2")
    assert m.historical_fulfillment_ratio is None
    assert m.fairness_reference_units == 0 and m.paid_units == 0
    assert r.metrics.fairness_limitations


def test_time_preferences_influence_real_model_cost(tiny):
    from backend.optimizer.contracts import TimePreference

    p = employees(
        tiny,
        e0={
            "time_preferences": (
                TimePreference(weekday=0, window=Window(start=600, end=840), cost_per_interval=10),
            )
        },
    )
    r = run(p, "budget-first")
    assert all(s.employee_id != "e0" for s in r.assignments)


def test_stability_uses_physical_assignments_not_ids(tiny):
    baseline = assignment(tiny)
    weights = Weights(
        understaffing=0,
        budget=0,
        preferences=0,
        fairness=0,
        unpopular=0,
        stability=100,
        short_shifts=0,
    )
    p = tiny.model_copy(update={"baseline": (baseline,)})
    r = solve(p, "balanced", SolveOptions(), weights)
    assert r.validation.valid and r.assignments == (baseline,)
    assert r.objective_components["stability"].raw == 0


def test_deterministic_fixture_assignments_repeat(tiny):
    a, b = run(tiny), run(tiny)
    assert a.assignments == b.assignments
    assert a.metadata.model_fingerprint == b.metadata.model_fingerprint


def test_zero_time_limit_returns_unknown_not_infeasible_or_fake_assignments(tiny):
    r = run(tiny, seconds=0)
    assert (
        r.status == "UNKNOWN" and not r.assignments and r.validation is None and r.metrics is None
    )


def test_successful_solver_status_cannot_bypass_independent_validation(tiny, monkeypatch):
    from backend.optimizer.contracts import Issue, ValidationReport
    import backend.optimizer.model as module

    monkeypatch.setattr(
        module,
        "validate_assignments",
        lambda *_: ValidationReport(
            valid=False,
            issues=(Issue(code="deliberate-test", message="Independent check rejected output"),),
            supervision_pairings=(),
        ),
    )
    r = run(tiny)
    assert r.solver_status == "OPTIMAL" and r.status == "VALIDATION_FAILED" and not r.assignments


def test_invalid_contracts_do_not_silently_default_entitlements(tiny):
    payload = tiny.model_dump(mode="json")
    del payload["employees"][0]["rules"]["min_weekly_units"]
    with pytest.raises(ValidationError):
        type(tiny).model_validate(payload)
    payload = tiny.model_dump(mode="json")
    payload["fictional_data"] = False
    with pytest.raises(ValidationError):
        type(tiny).model_validate(payload)
    payload = tiny.model_dump(mode="json")
    payload["skill_requirements"][0]["skill_id"] = "unknown"
    with pytest.raises(ValidationError):
        type(tiny).model_validate(payload)


def test_replacement_cannot_remove_the_only_effective_closer(tiny):
    p = employees(tiny, e2={"supervision_skill_id": None})
    before = validate_assignments(p, (assignment(p),))
    after = validate_assignments(p, (assignment(p, "e2"),))
    assert before.valid
    assert not after.valid and any(
        i.code == "skill_coverage" and i.skill_id == "close" for i in after.issues
    )
    # The same service-only replacement is valid when another qualified colleague remains.
    assert validate_assignments(
        p, (assignment(p, "e2"), assignment(p, "e1").model_copy(update={"id": "other-closer"}))
    ).valid


def test_matching_is_not_greedy_and_no_supervisor_can_supervise_themself(tiny):
    from backend.optimizer.validation import interval_pairing

    a = tiny.employees[0]
    b = tiny.employees[1].model_copy(
        update={
            "qualifications": tuple(
                q for q in tiny.employees[1].qualifications if q.skill_id != "open"
            )
        }
    )
    t1 = tiny.employees[2]
    t2 = t1.model_copy(update={"id": "e3", "supervision_skill_id": "open"})
    pairs, missing = interval_pairing(tiny, [a, b, t1, t2], tiny.week_start, 600)
    assert (
        not missing
        and next(pair for pair in pairs if pair.trainee_id == "e3").supervisor_id == "e0"
    )
    trainee = a.model_copy(update={"supervision_skill_id": "train"})
    assert interval_pairing(tiny, [trainee], tiny.week_start, 600)[1]


def test_unknown_employee_and_out_of_week_assignments_are_invalid(tiny):
    report = validate_assignments(
        tiny,
        (
            assignment(tiny, "missing").model_copy(
                update={"day": tiny.week_start + timedelta(days=7)}
            ),
        ),
    )
    assert not report.valid
    assert {"unknown_employee", "outside_week"} <= {i.code for i in report.issues}


def test_paid_break_metrics_and_targetless_coverage_are_explicit(tiny):
    s = assignment(tiny).model_copy(update={"break_start": 720, "break_minutes": 30})
    p = tiny.model_copy(update={"headcount": (), "skill_requirements": ()})
    problem = prepare(p)
    _, metrics = evaluate(p, problem, context(p, problem), (s,), DEFAULT_WEIGHTS["balanced"])
    assert metrics.total_paid_hours == 3.5
    assert metrics.target_coverage_percent is None
    assert (
        next(i for i in metrics.coverage if i.day == p.week_start and i.minute == 720).actual == 0
    )


def test_candidate_resource_limit_is_explicit(tiny):
    from backend.optimizer.candidates import ResourceLimit

    p = tiny.model_copy(
        update={
            "operating_window": Window(start=600, end=1380),
            "generation": Generation(
                start_step_minutes=30,
                durations_minutes=(120, 180, 240, 300, 360, 420, 480, 540),
                break_offsets_minutes=(30, 60, 90, 120, 150, 180, 210, 240),
            ),
        }
    )
    with pytest.raises(ResourceLimit, match="4,000"):
        prepare(p)


def test_genuine_warm_incumbent_is_validated_when_weighted_phase_times_out(tiny, monkeypatch):
    from ortools.sat.python import cp_model

    p = tiny.model_copy(
        update={
            "operating_window": Window(start=600, end=1380),
            "employees": tuple(
                e.model_copy(
                    update={
                        "availability": tuple(
                            Availability(day=d, windows=(Window(start=600, end=1380),))
                            for d in tiny.days
                        )
                    }
                )
                for e in tiny.employees
            ),
        }
    )
    assert sum(map(len, prepare(p).eligible.values())) > 500
    original = cp_model.CpSolver
    calls = [0]

    class FinalTimeout(original):
        def solve(self, model, *args, **kwargs):
            calls[0] += 1
            if calls[0] == 3:
                self.parameters.max_time_in_seconds = 0
            return super().solve(model, *args, **kwargs)

    monkeypatch.setattr(cp_model, "CpSolver", FinalTimeout)
    result = run(p, seconds=5)
    assert result.status == "FEASIBLE" and result.solver_status == "UNKNOWN"
    assert result.metadata.used_feasibility_incumbent
    assert result.validation.valid and validate_assignments(p, result.assignments).valid
    assert (
        sum(c.weighted_integer for c in result.objective_components.values())
        == result.metadata.integer_objective
    )
