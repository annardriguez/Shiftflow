"""Recompute objective terms and business metrics from actual assignments, not solver values."""

from dataclasses import dataclass
from itertools import combinations

from .candidates import Prepared, unpopular
from .contracts import (
    CoverageInterval,
    DailyHours,
    EmployeeHours,
    ObjectiveComponent,
    ScheduleMetrics,
    SchedulingInput,
    SkillCount,
    Weights,
)
from .time_math import active, signature
from .validation import qualified, requirements_at

SCALE = 1_000_000_000
RATIO_SCALE = 100
COMPONENTS = (
    "understaffing",
    "budget",
    "preferences",
    "fairness",
    "unpopular",
    "stability",
    "short_shifts",
)


@dataclass(frozen=True)
class ObjectiveContext:
    denominators: dict[str, int]
    bounds: dict[str, int]
    fairness_pairs: tuple[tuple[str, str], ...]
    ratio_denominators: dict[str, int]
    ratio_bounds: dict[str, int]
    opportunity_total: int
    unpopular_participants: tuple[str, ...]


def context(p: SchedulingInput, prepared: Prepared) -> ObjectiveContext:
    ids = [e.id for e in p.employees]
    ratio_denoms = {e.id: e.history.desired_units + prepared.references[e.id] for e in p.employees}
    ratio_bounds = {
        e.id: RATIO_SCALE * (e.history.paid_units + e.rules.max_weekly_units) // ratio_denoms[e.id]
        for e in p.employees
        if ratio_denoms[e.id]
    }
    fairness_pairs = tuple(combinations((eid for eid in ids if ratio_denoms[eid]), 2))
    opportunities = prepared.opportunities
    participants = tuple(eid for eid in ids if opportunities[eid])
    opportunity_total = sum(opportunities[eid] for eid in participants)
    nmax = {e.id: e.history.unpopular_shifts + e.rules.max_days_per_week for e in p.employees}
    total_nmax = sum(nmax[eid] for eid in participants)
    targets = sum(
        requirements_at(p, d, t)[0]
        for d in p.days
        for t in range(p.operating_window.start, p.operating_window.end, 30)
    )
    max_cost = sum(
        sum(
            max(
                (
                    prepared.preference_costs[e.id, i]
                    for i in prepared.eligible[e.id]
                    if prepared.candidates[i].day == d
                ),
                default=0,
            )
            for d in p.days
        )
        for e in p.employees
    )
    bounds = {
        "understaffing": targets,
        "budget": sum(
            max(b.paid_units, sum(e.rules.max_daily_units for e in p.employees)) for b in p.budgets
        ),
        "preferences": sum(
            max(e.preferred_max_units, e.rules.max_weekly_units) for e in p.employees
        )
        + max_cost,
        "fairness": sum(max(ratio_bounds[a], ratio_bounds[b]) for a, b in fairness_pairs),
        "unpopular": sum(
            opportunity_total * nmax[eid] + opportunities[eid] * total_nmax for eid in participants
        ),
        "stability": len({signature(s) for s in p.baseline})
        + sum(len(v) for v in prepared.eligible.values()),
        "short_shifts": sum(
            e.rules.max_days_per_week * p.generation.minimum_desirable_paid_units
            for e in p.employees
        ),
    }
    denoms = {key: max(1, value) for key, value in bounds.items()}
    denoms["budget"] = max(1, sum(b.paid_units for b in p.budgets))
    return ObjectiveContext(
        denoms,
        {key: max(1, value) for key, value in bounds.items()},
        fairness_pairs,
        ratio_denoms,
        ratio_bounds,
        opportunity_total,
        participants,
    )


def coefficients(ctx: ObjectiveContext, weights: Weights) -> dict[str, int]:
    return {
        key: (
            max(1, round(getattr(weights, key) * SCALE / ctx.denominators[key]))
            if getattr(weights, key)
            else 0
        )
        for key in COMPONENTS
    }


def assignment_preference(e, s) -> int:
    return sum(
        pref.cost_per_interval
        for pref in e.time_preferences
        if pref.weekday == s.day.weekday()
        for minute in range(pref.window.start, pref.window.end, 30)
        if active(s, minute)
    ) + (unpopular(s) if not e.prefers_unpopular else 0)


def evaluate(
    p: SchedulingInput, prepared: Prepared, ctx: ObjectiveContext, assignments, weights: Weights
):
    employees = {e.id: e for e in p.employees}
    paid = {
        e.id: sum(s.paid_units for s in assignments if s.employee_id == e.id) for e in p.employees
    }
    burden = {
        e.id: e.history.unpopular_shifts
        + sum(unpopular(s) for s in assignments if s.employee_id == e.id)
        for e in p.employees
    }
    ratios = {
        e.id: RATIO_SCALE * (e.history.paid_units + paid[e.id]) // ctx.ratio_denominators[e.id]
        for e in p.employees
        if ctx.ratio_denominators[e.id]
    }
    pref_devs = {
        e.id: max(0, e.preferred_min_units - paid[e.id])
        + max(0, paid[e.id] - e.preferred_max_units)
        for e in p.employees
    }
    budgets = {b.day: b.paid_units for b in p.budgets}
    daily = tuple(
        DailyHours(
            day=day,
            paid_units=(units := sum(s.paid_units for s in assignments if s.day == day)),
            paid_hours=units / 2,
            budget_units=budgets[day],
            budget_deviation_units=units - budgets[day],
        )
        for day in p.days
    )
    coverage = []
    for day in p.days:
        for minute in range(p.operating_window.start, p.operating_window.end, 30):
            present = {s.employee_id for s in assignments if s.day == day and active(s, minute)}
            target, mandatory, skills = requirements_at(p, day, minute)
            coverage.append(
                CoverageInterval(
                    day=day,
                    minute=minute,
                    actual=len(present),
                    target=target,
                    mandatory=mandatory,
                    understaffing=max(0, target - len(present)),
                    skills=tuple(
                        SkillCount(
                            skill_id=k,
                            required=n,
                            actual=sum(
                                qualified(employees[eid], k, day, minute, minute + 30, p.timezone)
                                for eid in present
                            ),
                        )
                        for k, n in sorted(skills.items())
                    ),
                )
            )
    current_signatures = {signature(s) for s in assignments}
    baseline_signatures = {signature(s) for s in p.baseline}
    total_burden = sum(burden[eid] for eid in ctx.unpopular_participants)
    raw = {
        "understaffing": sum(i.understaffing for i in coverage),
        "budget": sum(abs(d.budget_deviation_units) for d in daily),
        "preferences": sum(pref_devs.values())
        + sum(assignment_preference(employees[s.employee_id], s) for s in assignments),
        "fairness": sum(abs(ratios[a] - ratios[b]) for a, b in ctx.fairness_pairs),
        "unpopular": sum(
            abs(ctx.opportunity_total * burden[eid] - prepared.opportunities[eid] * total_burden)
            for eid in ctx.unpopular_participants
        ),
        "stability": len(current_signatures ^ baseline_signatures),
        "short_shifts": sum(
            max(0, p.generation.minimum_desirable_paid_units - s.paid_units) for s in assignments
        ),
    }
    coeffs = coefficients(ctx, weights)
    components = {
        key: ObjectiveComponent(
            raw=value,
            denominator=ctx.denominators[key],
            normalized=value / ctx.denominators[key],
            weight=getattr(weights, key),
            integer_coefficient=coeffs[key],
            weighted_integer=value * coeffs[key],
        )
        for key, value in raw.items()
    }
    target = sum(i.target for i in coverage)
    employee_metrics = tuple(
        EmployeeHours(
            employee_id=e.id,
            paid_units=paid[e.id],
            paid_hours=paid[e.id] / 2,
            preferred_min_units=e.preferred_min_units,
            preferred_max_units=e.preferred_max_units,
            preference_deviation_units=pref_devs[e.id],
            fairness_reference_units=prepared.references[e.id],
            fairness_capacity_upper_units=prepared.capacities[e.id],
            historical_fulfillment_ratio=(
                (e.history.paid_units + paid[e.id]) / ctx.ratio_denominators[e.id]
                if ctx.ratio_denominators[e.id]
                else None
            ),
            unpopular_opportunity_days=prepared.opportunities[e.id],
            unpopular_shifts=sum(unpopular(s) for s in assignments if s.employee_id == e.id),
            evening_shifts=sum(s.end >= 1260 for s in assignments if s.employee_id == e.id),
            weekend_shifts=sum(s.day.weekday() >= 5 for s in assignments if s.employee_id == e.id),
        )
        for e in p.employees
    )
    total = sum(paid.values()) / 2
    budget = sum(budgets.values()) / 2
    metrics = ScheduleMetrics(
        total_paid_hours=total,
        recommended_paid_hours=budget,
        budget_deviation_hours=total - budget,
        uncovered_person_hours=raw["understaffing"] / 2,
        target_coverage_percent=100 * (target - raw["understaffing"]) / target if target else None,
        daily=daily,
        coverage=tuple(coverage),
        uncovered_intervals=tuple(i for i in coverage if i.understaffing),
        employees=employee_metrics,
        fairness_score=max(0, 100 * (1 - components["fairness"].normalized)),
        fairness_limitations=(
            "Descriptive fulfillment disparity, not employee satisfaction or proof of fairness.",
            "References are clipped to an individual availability-capacity upper bound, not guaranteed joint feasibility.",
            "Equal underallocation can still receive a high score; inspect unmet preferred hours and coverage.",
            "Zero-reference employees are excluded from hour ratios; zero-opportunity employees are excluded from burden comparisons.",
            "One person may cover multiple skills while supervising under the configured prototype policy.",
        ),
        history_window=p.history_window,
        baseline_assignment_changes=raw["stability"],
    )
    return components, metrics
