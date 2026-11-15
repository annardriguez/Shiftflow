"""CP-SAT workforce model; hard rules are invariant across all objective strategies."""

from __future__ import annotations

from datetime import timedelta
from hashlib import sha256
from time import perf_counter

import ortools
from ortools.sat.python import cp_model

from .candidates import Prepared, ResourceLimit, prepare, unpopular
from .contracts import (
    Assignment,
    Issue,
    ScheduleResult,
    SchedulingInput,
    SolveOptions,
    SolverMetadata,
    Strategy,
    ValidationReport,
    Weights,
)
from .metrics import COMPONENTS, RATIO_SCALE, SCALE, coefficients, context, evaluate
from .time_math import active, instant, signature
from .validation import individual_issues, qualified, requirements_at, validate_assignments


def solve(
    p: SchedulingInput,
    strategy: Strategy,
    options: SolveOptions,
    weights: Weights,
    prepared: Prepared | None = None,
) -> ScheduleResult:
    started = perf_counter()
    prepared = prepared or prepare(p)
    ctx = context(p, prepared)
    coeffs = coefficients(ctx, weights)
    if sum(ctx.bounds[k] * coeffs[k] for k in COMPONENTS) >= 2**60:
        raise ResourceLimit(
            "Objective bound exceeds safe integer range; reduce rules/history/weights"
        )
    model = cp_model.CpModel()
    assumptions: dict[int, Issue] = {}
    preflight = []

    def assumption(name: str, issue: Issue):
        literal = model.new_bool_var(name)
        model.add_assumption(literal)
        assumptions[literal.index] = issue
        return literal

    candidates = prepared.candidates
    x = {
        (e.id, i): model.new_bool_var(f"x_{e.id}_{i}")
        for e in p.employees
        for i in prepared.eligible[e.id]
    }
    origin = instant(p.week_start, 0, p.timezone)
    daily_vars, hours, nburden = {}, {}, {}
    for e in p.employees:
        indices = prepared.eligible[e.id]
        employment = assumption(
            f"employment_{e.id}",
            Issue(
                code="employment",
                employee_id=e.id,
                message=f"Inspect weekly/rolling entitlement, maximum hours and days for {e.id}; this group is in a jointly inconsistent assumption set",
            ),
        )
        intervals = []
        for i in indices:
            s = candidates[i]
            start = int((instant(s.day, s.start, p.timezone) - origin).total_seconds() // 60)
            end = int((instant(s.day, s.end, p.timezone) - origin).total_seconds() // 60)
            intervals.append(
                model.new_optional_fixed_size_interval_var(
                    start, end - start + e.rules.min_rest_minutes, x[e.id, i], f"rest_{e.id}_{i}"
                )
            )
        for s in p.boundary_assignments:
            if s.employee_id == e.id:
                start = int((instant(s.day, s.start, p.timezone) - origin).total_seconds() // 60)
                end = int((instant(s.day, s.end, p.timezone) - origin).total_seconds() // 60)
                intervals.append(
                    model.new_fixed_size_interval_var(
                        start, end - start + e.rules.min_rest_minutes, f"fixed_{s.id}"
                    )
                )
                problems = individual_issues(p, e, s, availability=False)
                if problems:
                    preflight.extend(problems)
                    model.add(0 == 1).only_enforce_if(employment)
        fixed_for_employee = [s for s in p.boundary_assignments if s.employee_id == e.id]
        for day in {s.day for s in fixed_for_employee}:
            fixed_daily = [s for s in fixed_for_employee if s.day == day]
            if (
                len(fixed_daily) > 1
                or sum(s.paid_units for s in fixed_daily) > e.rules.max_daily_units
            ):
                preflight.append(
                    Issue(
                        code="boundary_daily_limit",
                        employee_id=e.id,
                        day=day,
                        message="Fixed boundary assignments violate daily shift/hour limits",
                    )
                )
                model.add(0 == 1).only_enforce_if(employment)
        model.add_no_overlap(intervals)
        for day in p.days:
            chosen = [x[e.id, i] for i in indices if candidates[i].day == day]
            zday = model.new_bool_var(f"works_{e.id}_{day}")
            model.add(sum(chosen) == zday)  # explicit one-shift-per-day policy
            daily_vars[e.id, day] = zday
        h = model.new_int_var(0, e.rules.max_weekly_units, f"hours_{e.id}")
        model.add(h == sum(candidates[i].paid_units * x[e.id, i] for i in indices))
        model.add(h >= e.rules.min_weekly_units).only_enforce_if(employment)
        hours[e.id] = h
        model.add(
            sum(daily_vars[e.id, d] for d in p.days) <= e.rules.max_days_per_week
        ).only_enforce_if(employment)
        for offset in range(-6, 7):
            left = p.week_start + timedelta(days=offset)
            fixed = sum(
                s.paid_units
                for s in p.boundary_assignments
                if s.employee_id == e.id and left <= s.day < left + timedelta(days=7)
            )
            model.add(
                fixed
                + sum(
                    candidates[i].paid_units * x[e.id, i]
                    for i in indices
                    if left <= candidates[i].day < left + timedelta(days=7)
                )
                <= e.rules.max_rolling_seven_day_units
            ).only_enforce_if(employment)
        fixed_days = {s.day for s in p.boundary_assignments if s.employee_id == e.id}
        k = e.rules.max_consecutive_days
        for offset in range(-k, 7):
            left = p.week_start + timedelta(days=offset)
            days = [left + timedelta(days=j) for j in range(k + 1)]
            model.add(
                sum(daily_vars[e.id, d] if d in p.days else int(d in fixed_days) for d in days) <= k
            ).only_enforce_if(employment)
        nburden[e.id] = e.history.unpopular_shifts + sum(
            unpopular(candidates[i]) * x[e.id, i] for i in indices
        )
    # A baseline signature is independent of assignment IDs, including explicit duties and breaks.
    baseline = {signature(s): s for s in p.baseline}
    key_to_x = {signature(candidates[i], eid): variable for (eid, i), variable in x.items()}
    for s in p.baseline:
        if s.id in p.locked_assignment_ids:
            lit = assumption(
                f"locked_{s.id}",
                Issue(
                    code="locked_assignment",
                    employee_id=s.employee_id,
                    day=s.day,
                    message=f"Locked assignment {s.id} is incompatible with the mandatory rules",
                ),
            )
            model.add(key_to_x.get(signature(s), 0) == 1).only_enforce_if(lit)
            if signature(s) not in key_to_x:
                employee = next(e for e in p.employees if e.id == s.employee_id)
                preflight.extend(individual_issues(p, employee, s))
    presence, under = {}, []
    for day in p.days:
        for minute in range(p.operating_window.start, p.operating_window.end, 30):
            for e in p.employees:
                covers = [
                    x[e.id, i]
                    for i in prepared.eligible[e.id]
                    if candidates[i].day == day and active(candidates[i], minute)
                ]
                z = model.new_bool_var(f"present_{e.id}_{day}_{minute}")
                model.add(z == sum(covers))
                presence[e.id, day, minute] = z
            count = sum(presence[e.id, day, minute] for e in p.employees)
            target, minimum, skills = requirements_at(p, day, minute)
            u = model.new_int_var(0, target, f"under_{day}_{minute}")
            model.add_max_equality(u, [0, target - count])
            under.append(u)
            if minimum:
                lit = assumption(
                    f"headcount_{day}_{minute}",
                    Issue(
                        code="mandatory_headcount",
                        day=day,
                        minute=minute,
                        required=minimum,
                        message="Mandatory staffing minimum cannot be met; confirm availability or arrange eligible cover",
                    ),
                )
                model.add(count >= minimum).only_enforce_if(lit)
            for skill, minimum in sorted(skills.items()):
                eligible = [
                    e
                    for e in p.employees
                    if qualified(e, skill, day, minute, minute + 30, p.timezone)
                ]
                possible = sum(
                    any(
                        candidates[i].day == day and active(candidates[i], minute)
                        for i in prepared.eligible[e.id]
                    )
                    for e in eligible
                )
                issue = Issue(
                    code="skill_coverage",
                    day=day,
                    minute=minute,
                    skill_id=skill,
                    required=minimum,
                    actual=possible,
                    message=f"Need {minimum} qualified {skill} worker(s); optimistic available capacity is {possible}. Confirm qualifications/availability or arrange qualified cover.",
                )
                lit = assumption(f"skill_{day}_{minute}_{skill}", issue)
                model.add(
                    sum(presence[e.id, day, minute] for e in eligible) >= minimum
                ).only_enforce_if(lit)
                if possible < minimum:
                    preflight.append(issue)
            trainees = [e for e in p.employees if e.supervision_skill_id]
            supervisors = [
                e for e in p.employees if e.skills_reviewed and not e.supervision_skill_id
            ]
            supervisor_pairs = {e.id: [] for e in supervisors}
            supervision = assumption(
                f"supervision_{day}_{minute}",
                Issue(
                    code="supervision",
                    day=day,
                    minute=minute,
                    message="Inspect trainee supervision at this interval in the inconsistent assumption set. Add independent qualified staff or adjust training shifts/breaks; capacity is shared across tasks.",
                ),
            )
            for trainee in trainees:
                pairs = []
                for supervisor in supervisors:
                    if qualified(
                        supervisor,
                        trainee.supervision_skill_id,
                        day,
                        minute,
                        minute + 30,
                        p.timezone,
                    ):
                        pair = model.new_bool_var(
                            f"pair_{trainee.id}_{supervisor.id}_{day}_{minute}"
                        )
                        model.add(pair <= presence[supervisor.id, day, minute])
                        supervisor_pairs[supervisor.id].append(pair)
                        pairs.append(pair)
                model.add(sum(pairs) == presence[trainee.id, day, minute]).only_enforce_if(
                    supervision
                )
            for supervisor in supervisors:
                model.add(
                    sum(supervisor_pairs[supervisor.id])
                    <= p.supervision_capacity * presence[supervisor.id, day, minute]
                )
    core_variable_count = len(model.proto.variables)
    feasibility_model = model.clone()
    warm_budget_terms = []
    for b in p.budgets:
        labor = sum(
            candidates[i].paid_units * var
            for (eid, i), var in x.items()
            if candidates[i].day == b.day
        )
        deviation = feasibility_model.new_int_var(0, ctx.bounds["budget"], f"warm_budget_{b.day}")
        feasibility_model.add_abs_equality(deviation, labor - b.paid_units)
        warm_budget_terms.append(deviation)
    # A smaller, genuine CP-SAT objective supplies a useful initial incumbent.
    # All preference, fairness and stability terms remain in the full second phase.
    feasibility_model.minimize(
        coeffs["understaffing"] * sum(under) + coeffs["budget"] * sum(warm_budget_terms)
    )
    raw = {}

    def raw_term(key, expression):
        variable = model.new_int_var(0, ctx.bounds[key], f"objective_{key}")
        model.add(variable == expression)
        raw[key] = variable

    raw_term("understaffing", sum(under))
    budget_terms = []
    for b in p.budgets:
        labor = sum(
            candidates[i].paid_units * var
            for (eid, i), var in x.items()
            if candidates[i].day == b.day
        )
        deviation = model.new_int_var(0, ctx.bounds["budget"], f"budget_{b.day}")
        model.add_abs_equality(deviation, labor - b.paid_units)
        budget_terms.append(deviation)
    raw_term("budget", sum(budget_terms))
    deviations = []
    ratios = {}
    for e in p.employees:
        lower = model.new_int_var(
            0, max(e.preferred_min_units, e.rules.max_weekly_units), f"pref_minus_{e.id}"
        )
        upper = model.new_int_var(
            0, max(e.preferred_max_units, e.rules.max_weekly_units), f"pref_plus_{e.id}"
        )
        model.add_max_equality(lower, [0, e.preferred_min_units - hours[e.id]])
        model.add_max_equality(upper, [0, hours[e.id] - e.preferred_max_units])
        deviations.extend([lower, upper])
        if ctx.ratio_denominators[e.id]:
            ratio = model.new_int_var(0, ctx.ratio_bounds[e.id], f"ratio_{e.id}")
            model.add_division_equality(
                ratio,
                RATIO_SCALE * (e.history.paid_units + hours[e.id]),
                ctx.ratio_denominators[e.id],
            )
            ratios[e.id] = ratio
    raw_term(
        "preferences",
        sum(deviations)
        + sum(prepared.preference_costs[eid, i] * var for (eid, i), var in x.items()),
    )
    disparities = []
    for a, b in ctx.fairness_pairs:
        diff = model.new_int_var(
            0, max(ctx.ratio_bounds[a], ctx.ratio_bounds[b]), f"disparity_{a}_{b}"
        )
        model.add_abs_equality(diff, ratios[a] - ratios[b])
        disparities.append(diff)
    raw_term("fairness", sum(disparities))
    burdens = []
    total_burden = sum(nburden[eid] for eid in ctx.unpopular_participants)
    for eid in ctx.unpopular_participants:
        diff = model.new_int_var(0, ctx.bounds["unpopular"], f"burden_{eid}")
        model.add_abs_equality(
            diff, ctx.opportunity_total * nburden[eid] - prepared.opportunities[eid] * total_burden
        )
        burdens.append(diff)
    raw_term("unpopular", sum(burdens))
    raw_term(
        "stability",
        len(baseline) + sum((-1 if key in baseline else 1) * var for key, var in key_to_x.items()),
    )
    raw_term(
        "short_shifts",
        sum(
            max(0, p.generation.minimum_desirable_paid_units - candidates[i].paid_units) * var
            for (eid, i), var in x.items()
        ),
    )
    model.minimize(sum(coeffs[key] * raw[key] for key in COMPONENTS))
    model_error = model.validate()
    fingerprint = sha256(str(model.proto).encode()).hexdigest()
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.cp_model_presolve = len(x) <= 500
    solver.parameters.cp_model_probing_level = 0
    solver.parameters.symmetry_level = 0
    solver.parameters.linearization_level = 0
    solver.parameters.random_seed = options.random_seed
    solver.parameters.max_time_in_seconds = options.max_seconds_per_strategy
    solver.parameters.max_deterministic_time = options.deterministic_time_limit
    warnings = [
        "Fictional adult-worker rules only; no legal compliance certification. No Strobbo connection."
    ]
    if any(not e.skills_reviewed for e in p.employees):
        warnings.append(
            "Unreviewed skill/supervision profiles were excluded from assignment candidates."
        )
    if not p.boundary_assignments:
        warnings.append(
            "No boundary shifts supplied; cross-week rules are checked against an explicitly empty boundary snapshot."
        )
    invalid = bool(model_error)
    warm_solver = None
    warm_status_name = None
    warm_seconds = 0.0
    warm_deterministic = 0.0
    # A genuine coverage/budget solve supplies a valid incumbent before the harder objective search.
    # This is not an authored/sample roster and never relaxes a mandatory constraint.
    if (
        not invalid
        and len(x) > 500
        and options.max_seconds_per_strategy > 0
        and options.deterministic_time_limit > 0
    ):
        warm_model = feasibility_model
        warm_solver = cp_model.CpSolver()
        warm_solver.parameters.num_search_workers = 1
        warm_solver.parameters.random_seed = options.random_seed
        warm_solver.parameters.cp_model_probing_level = 0
        warm_solver.parameters.symmetry_level = 0
        warm_solver.parameters.linearization_level = 0
        warm_solver.parameters.max_time_in_seconds = min(
            4.0, options.max_seconds_per_strategy * 0.4
        )
        warm_solver.parameters.max_deterministic_time = min(
            0.7, options.deterministic_time_limit * 0.4
        )
        warm_status = warm_solver.solve(warm_model)
        warm_status_name = warm_solver.status_name(warm_status)
        warm_seconds = warm_solver.wall_time
        warm_deterministic = warm_solver.response_proto.deterministic_time
        if warm_status in (cp_model.FEASIBLE, cp_model.OPTIMAL):
            # Complete the auxiliary objective values in another CP-SAT solve with the
            # core assignment/pairing variables fixed. The resulting hint is fully feasible.
            complete_model = model.clone()
            complete_model.clear_objective()
            for index in range(core_variable_count):
                variable = complete_model.get_int_var_from_proto_index(index)
                complete_model.add(variable == warm_solver.value(variable))
            complete_solver = cp_model.CpSolver()
            complete_solver.parameters.num_search_workers = 1
            complete_solver.parameters.max_time_in_seconds = min(
                0.75, max(0, options.max_seconds_per_strategy - warm_seconds) * 0.25
            )
            complete_solver.parameters.max_deterministic_time = min(
                0.1, max(0, options.deterministic_time_limit - warm_deterministic) * 0.25
            )
            complete_status = complete_solver.solve(complete_model)
            warm_seconds += complete_solver.wall_time
            warm_deterministic += complete_solver.response_proto.deterministic_time
            hint_count = core_variable_count
            if complete_status in (cp_model.FEASIBLE, cp_model.OPTIMAL):
                warm_solver = complete_solver
                hint_count = len(model.proto.variables)
            for index in range(hint_count):
                variable = model.get_int_var_from_proto_index(index)
                model.add_hint(variable, warm_solver.value(variable))
        else:
            warm_solver = None
        solver.parameters.max_time_in_seconds = max(
            0, options.max_seconds_per_strategy - warm_seconds
        )
        solver.parameters.max_deterministic_time = max(
            0, options.deterministic_time_limit - warm_deterministic
        )
    status = cp_model.MODEL_INVALID if invalid else solver.solve(model)
    optimization_status = "MODEL_INVALID" if invalid else solver.status_name(status)
    elapsed_solve = 0 if invalid else warm_seconds + solver.wall_time
    deterministic_time = (
        0 if invalid else warm_deterministic + solver.response_proto.deterministic_time
    )
    fallback = status == cp_model.UNKNOWN and warm_solver is not None
    optimization_bound = (
        None if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE) else solver.best_objective_bound
    )
    if fallback:
        solver, status = warm_solver, cp_model.FEASIBLE
        warnings.append(
            "Optimization found no incumbent before its limit; returning the genuine coverage/budget warm-start incumbent after independent validation. Optimality is not proved."
        )
    status_name = (
        "MODEL_INVALID" if invalid else ("FEASIBLE" if fallback else solver.status_name(status))
    )
    metadata = dict(
        solver_version=ortools.__version__,
        rule_version=p.rule_version,
        runtime_seconds=perf_counter() - started,
        solve_seconds=elapsed_solve,
        deterministic_time=deterministic_time,
        feasibility_status=warm_status_name,
        optimization_status=optimization_status,
        used_feasibility_incumbent=fallback,
        seed=options.random_seed,
        max_seconds=options.max_seconds_per_strategy,
        max_deterministic_time=options.deterministic_time_limit,
        candidates=len(candidates),
        admissible_pairs=len(x),
        model_fingerprint=fingerprint,
        max_coefficient_rounding_error=max(
            abs(coeffs[k] / SCALE - getattr(weights, k) / ctx.denominators[k]) for k in COMPONENTS
        ),
    )
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        diagnostics = list(preflight)
        if status == cp_model.INFEASIBLE:
            diagnostics.extend(
                assumptions[i]
                for i in solver.sufficient_assumptions_for_infeasibility()
                if i in assumptions
            )
            if not diagnostics:
                diagnostics.append(
                    Issue(
                        code="infeasible",
                        message="Mandatory working/rest/coverage rules or fixed boundary assignments are jointly inconsistent; inspect employment bounds and adjacent-week shifts.",
                    )
                )
            warnings.append(
                "No feasible complete roster was found. No assignment was returned or silently relaxed. Assumption causes are sufficient, not necessarily minimal or exhaustive."
            )
        elif status == cp_model.UNKNOWN:
            diagnostics.append(
                Issue(
                    code="time_limit",
                    message="No feasible incumbent was found within the time/resource limit; this does not prove infeasibility.",
                )
            )
        else:
            diagnostics.append(
                Issue(code="model_invalid", message=model_error or solver.solution_info())
            )
        return ScheduleResult(
            strategy=strategy,
            status=status_name,
            solver_status=status_name,
            diagnostics=tuple({i.model_dump_json(): i for i in diagnostics}.values()),
            warnings=tuple(warnings),
            metadata=SolverMetadata(**metadata),
        )
    assignments = []
    used = {s.id for s in (*p.baseline, *p.boundary_assignments)}
    for (eid, i), variable in x.items():
        if not solver.boolean_value(variable):
            continue
        pattern = candidates[i]
        key = signature(pattern, eid)
        if key in baseline:
            aid = baseline[key].id
        else:
            aid = "generated-" + sha256(repr(key).encode()).hexdigest()[:24]
            while aid in used:
                aid += "x"
            used.add(aid)
        assignments.append(pattern.model_copy(update={"id": aid, "employee_id": eid}))
    assignments = tuple(sorted(assignments, key=lambda s: (s.day, s.start, s.employee_id, s.id)))
    validation = validate_assignments(p, assignments)
    components, metrics = evaluate(p, prepared, ctx, assignments, weights)
    mismatches = [
        Issue(
            code="objective_mismatch",
            message=f"Independent objective component {k} disagrees with solver",
        )
        for k in COMPONENTS
        if not fallback and components[k].raw != solver.value(raw[k])
    ]
    if mismatches:
        validation = ValidationReport(
            valid=False,
            issues=(*validation.issues, *mismatches),
            supervision_pairings=validation.supervision_pairings,
        )
    integer_objective = (
        sum(components[k].weighted_integer for k in COMPONENTS)
        if fallback
        else sum(solver.value(raw[k]) * coeffs[k] for k in COMPONENTS)
    )
    metadata.update(
        integer_objective=integer_objective,
        best_bound=optimization_bound,
        relative_gap=(
            max(0, (integer_objective - optimization_bound) / max(1, abs(integer_objective)))
            if optimization_bound is not None
            else None
        ),
    )
    metadata["runtime_seconds"] = perf_counter() - started
    if not validation.valid:
        return ScheduleResult(
            strategy=strategy,
            status="VALIDATION_FAILED",
            solver_status=status_name,
            validation=validation,
            diagnostics=validation.issues,
            warnings=(*warnings, "Solver output failed independent validation and was withheld."),
            metadata=SolverMetadata(**metadata),
        )
    if metrics.uncovered_intervals:
        warnings.append(
            f"Hard-valid draft with {len(metrics.uncovered_intervals)} unmet desired-coverage intervals ({metrics.uncovered_person_hours:g} person-hours)."
        )
    if status == cp_model.FEASIBLE:
        warnings.append(
            "Feasible incumbent; optimality was not proved within the configured limits."
        )
    return ScheduleResult(
        strategy=strategy,
        status=status_name,
        solver_status=optimization_status,
        assignments=assignments,
        validation=validation,
        objective_components=components,
        metrics=metrics,
        warnings=tuple(warnings),
        metadata=SolverMetadata(**metadata),
    )
