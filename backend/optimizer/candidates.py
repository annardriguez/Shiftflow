"""Finite candidate shifts including explicit unpaid break alternatives."""

from dataclasses import dataclass
from hashlib import sha256

from .contracts import Assignment, SchedulingInput
from .time_math import active, conflicting, signature
from .validation import individual_issues


class ResourceLimit(ValueError):
    pass


@dataclass(frozen=True)
class Prepared:
    candidates: tuple[Assignment, ...]
    eligible: dict[str, tuple[int, ...]]
    rejected: dict[str, dict[str, int]]
    capacities: dict[str, int]
    references: dict[str, int]
    opportunities: dict[str, int]
    preference_costs: dict[tuple[str, int], int]


def unpopular(s: Assignment) -> int:
    return int(s.day.weekday() >= 5 or s.end >= 1260)


def prepare(p: SchedulingInput) -> Prepared:
    values = {}
    for day in p.days:
        for start in range(
            p.operating_window.start, p.operating_window.end, p.generation.start_step_minutes
        ):
            for duration in sorted(set(p.generation.durations_minutes)):
                end = start + duration
                if end > p.operating_window.end:
                    continue
                kinds = ["Midday"]
                if start == p.operating_window.start:
                    kinds.append("Opening")
                if end == p.operating_window.end:
                    kinds.append("Closing")
                breaks = [
                    (None, 0),
                    *(
                        (start + offset, p.generation.break_minutes)
                        for offset in sorted(set(p.generation.break_offsets_minutes))
                        if offset + p.generation.break_minutes < duration
                    ),
                ]
                for kind in kinds:
                    for break_start, break_minutes in breaks:
                        s = Assignment(
                            id="pattern",
                            employee_id="pattern",
                            day=day,
                            start=start,
                            end=end,
                            kind=kind,
                            break_start=break_start,
                            break_minutes=break_minutes,
                            required_skills=(),
                        )
                        key = signature(s)[1:]
                        values[key] = s
    # Preserve identity of arbitrary existing break patterns for stability and locked assignments.
    for s in p.baseline:
        values[signature(s)[1:]] = s.model_copy(update={"employee_id": "pattern"})
    candidates = []
    for key, value in sorted(values.items(), key=lambda item: repr(item[0])):
        cid = "candidate-" + sha256(repr(key).encode()).hexdigest()[:20]
        candidates.append(value.model_copy(update={"id": cid, "employee_id": "pattern"}))
    if len(candidates) > 4000:
        raise ResourceLimit(
            "More than 4,000 candidates; reduce start choices, durations or break variants"
        )
    eligible, rejected, capacities, references, opportunities, costs = {}, {}, {}, {}, {}, {}
    for e in p.employees:
        indices = []
        counts = {}
        boundaries = [s for s in p.boundary_assignments if s.employee_id == e.id]
        for index, s in enumerate(candidates):
            issues = individual_issues(p, e, s)
            codes = {i.code for i in issues}
            if any(conflicting(s, b, p.timezone, e.rules.min_rest_minutes) for b in boundaries):
                codes.add("boundary_rest")
            if codes:
                for code in codes:
                    counts[code] = counts.get(code, 0) + 1
                continue
            indices.append(index)
            cost = sum(
                pref.cost_per_interval
                for pref in e.time_preferences
                if pref.weekday == s.day.weekday()
                for minute in range(pref.window.start, pref.window.end, 30)
                if active(s, minute)
            )
            costs[e.id, index] = cost + (unpopular(s) if not e.prefers_unpopular else 0)
        eligible[e.id], rejected[e.id] = tuple(indices), counts
        daily_capacities = [
            max((candidates[i].paid_units for i in indices if candidates[i].day == day), default=0)
            for day in p.days
        ]
        capacity_upper = min(
            e.rules.max_weekly_units,
            sum(sorted(daily_capacities, reverse=True)[: e.rules.max_days_per_week]),
        )
        capacities[e.id] = capacity_upper
        reference = min((e.preferred_min_units + e.preferred_max_units) // 2, capacity_upper)
        references[e.id] = reference
        # One shift/day: deduplicate opportunity by local day, never by break-pattern count.
        opportunities[e.id] = len({candidates[i].day for i in indices if unpopular(candidates[i])})
    if sum(map(len, eligible.values())) > 60000:
        raise ResourceLimit(
            "More than 60,000 admissible employee-shift pairs; reduce candidate choices"
        )
    return Prepared(
        tuple(candidates), eligible, rejected, capacities, references, opportunities, costs
    )
