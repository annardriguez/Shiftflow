"""Independent assignment validation: no OR-Tools imports or solver variables."""

from collections import Counter
from datetime import timedelta

from .contracts import Assignment, Employee, Issue, Pairing, SchedulingInput, ValidationReport
from .time_math import active, conflicting, instant, signature


def qualified(e: Employee, skill: str, day, start: int, end: int, timezone: str) -> bool:
    if not e.skills_reviewed:
        return False
    left, right = instant(day, start, timezone), instant(day, end, timezone)
    return any(
        q.skill_id == skill
        and q.verified_at <= left
        and (q.expires_at is None or q.expires_at >= right)
        and (q.revoked_at is None or q.revoked_at >= right)
        for q in e.qualifications
    )


def individual_issues(
    p: SchedulingInput, e: Employee, s: Assignment, *, availability: bool = True
) -> list[Issue]:
    issues = []

    def fail(code, text):
        issues.append(Issue(code=code, message=text, employee_id=e.id, day=s.day))

    if s.start < p.operating_window.start or s.end > p.operating_window.end:
        fail("operating_window", "Shift is outside preparation/operating hours")
    if s.end - s.start < e.rules.min_shift_minutes or s.end - s.start > e.rules.max_shift_minutes:
        fail("shift_length", "Shift clock duration violates individual employment bounds")
    if s.paid_units > e.rules.max_daily_units:
        fail("daily_hours", "Shift exceeds the employee's daily paid-hour maximum")
    if (
        s.end - s.start > e.rules.break_after_minutes
        and s.break_minutes < e.rules.min_break_minutes
    ):
        fail("break_required", "Clock duration requires a longer unpaid break")
    segments = (
        [s.end - s.start]
        if not s.break_minutes
        else [s.break_start - s.start, s.end - s.break_start - s.break_minutes]
    )
    if max(segments) > e.rules.max_continuous_minutes:
        fail("continuous_work", "Continuous working period exceeds configured limit")
    if s.kind not in e.eligible_kinds:
        fail("shift_eligibility", "Employee is not permitted to work this shift type")
    if s.kind == "Opening" and s.start != p.operating_window.start:
        fail("opening_time", "Opening shift must start at preparation opening time")
    if s.kind == "Closing" and s.end != p.operating_window.end:
        fail("closing_time", "Closing shift must end at preparation closing time")
    if availability:
        windows = next((a.windows for a in e.availability if a.day == s.day), ())
        if not any(w.start <= s.start and w.end >= s.end for w in windows):
            fail("availability", "Full clock window is outside confirmed availability")
        if s.day in e.absent_dates:
            fail("absence", "Approved absence prevents assignment")
    if not e.skills_reviewed:
        fail("skills_unreviewed", "Competencies and supervision needs require manager review")
    for skill in set((*p.duties.for_kind(s.kind), *s.required_skills)):
        if skill not in p.skill_ids or not qualified(e, skill, s.day, s.start, s.end, p.timezone):
            fail(
                "personal_qualification",
                f"Missing effective qualification for personal duty: {skill}",
            )
    return issues


def interval_pairing(p: SchedulingInput, people: list[Employee], day, minute: int):
    """Maximum bipartite matching, independent of the model's pairing variables."""
    trainees = [e for e in people if e.supervision_skill_id]
    slots = [
        e
        for e in people
        if e.skills_reviewed and not e.supervision_skill_id
        for _ in range(p.supervision_capacity)
    ]
    owners = {}

    def assign(index, seen):
        for slot, supervisor in enumerate(slots):
            if slot in seen or not qualified(
                supervisor,
                trainees[index].supervision_skill_id,
                day,
                minute,
                minute + 30,
                p.timezone,
            ):
                continue
            seen.add(slot)
            if slot not in owners or assign(owners[slot], seen):
                owners[slot] = index
                return True
        return False

    for i in range(len(trainees)):
        assign(i, set())
    pairs = tuple(
        Pairing(day=day, minute=minute, trainee_id=trainees[i].id, supervisor_id=slots[slot].id)
        for slot, i in owners.items()
    )
    missing = [e for e in trainees if e.id not in {v.trainee_id for v in pairs}]
    return pairs, missing


def requirements_at(p: SchedulingInput, day, minute):
    counts = [
        r
        for r in p.headcount
        if r.day == day and r.window.start <= minute and r.window.end >= minute + 30
    ]
    target = max((r.target for r in counts), default=0)
    mandatory = max((r.mandatory for r in counts), default=0)
    skills = {}
    for r in p.skill_requirements:
        if r.day == day and r.window.start <= minute and r.window.end >= minute + 30:
            skills[r.skill_id] = max(skills.get(r.skill_id, 0), r.minimum)
    return target, mandatory, skills


def validate_assignments(
    p: SchedulingInput, assignments: tuple[Assignment, ...]
) -> ValidationReport:
    issues = []
    pairings = []
    people = {e.id: e for e in p.employees}
    usable = []
    for shift in assignments:
        try:
            instant(shift.day, shift.start, p.timezone)
            instant(shift.day, shift.end, p.timezone)
        except ValueError as exc:
            issues.append(
                Issue(
                    code="invalid_local_time",
                    message=str(exc),
                    employee_id=shift.employee_id,
                    day=shift.day,
                )
            )
        else:
            usable.append(shift)
    original_assignments = assignments
    assignments = tuple(usable)
    if len({s.id for s in original_assignments}) != len(original_assignments):
        issues.append(Issue(code="duplicate_assignment", message="Assignment IDs are duplicated"))
    if {s.id for s in assignments} & {s.id for s in p.boundary_assignments}:
        issues.append(
            Issue(code="boundary_id", message="Assignment ID collides with a fixed boundary shift")
        )
    for s in assignments:
        if s.day not in p.days:
            issues.append(
                Issue(
                    code="outside_week",
                    message="Returned assignment is outside the requested week",
                    day=s.day,
                )
            )
        if s.employee_id not in people:
            issues.append(
                Issue(
                    code="unknown_employee",
                    message="Unknown employee in assignment",
                    employee_id=s.employee_id,
                )
            )
            continue
        issues.extend(individual_issues(p, people[s.employee_id], s))
    all_shifts = (*assignments, *p.boundary_assignments)
    for e in p.employees:
        scheduled = sorted(
            (s for s in all_shifts if s.employee_id == e.id), key=lambda s: (s.day, s.start)
        )
        # Fixed boundaries are authoritative availability, but still must satisfy clock/rule/skill limits.
        for s in p.boundary_assignments:
            if s.employee_id == e.id:
                issues.extend(individual_issues(p, e, s, availability=False))
        for a, b in zip(scheduled, scheduled[1:]):
            if conflicting(a, b, p.timezone, e.rules.min_rest_minutes):
                issues.append(
                    Issue(
                        code="overlap_or_rest",
                        message="Overlapping shifts or insufficient elapsed rest",
                        employee_id=e.id,
                        day=b.day,
                    )
                )
        inside = [s for s in assignments if s.employee_id == e.id]
        units = sum(s.paid_units for s in inside)
        if not e.rules.min_weekly_units <= units <= e.rules.max_weekly_units:
            issues.append(
                Issue(
                    code="weekly_hours",
                    message="Paid hours violate weekly entitlement/maximum",
                    employee_id=e.id,
                )
            )
        days = Counter(s.day for s in inside)
        all_days = Counter(s.day for s in scheduled)
        if any(
            sum(s.paid_units for s in scheduled if s.day == d) > e.rules.max_daily_units
            for d in all_days
        ):
            issues.append(
                Issue(
                    code="daily_hours",
                    message="Daily paid hours exceed the employee maximum",
                    employee_id=e.id,
                )
            )
        if any(n > 1 for n in all_days.values()):
            issues.append(
                Issue(
                    code="daily_shifts",
                    message="This model allows at most one shift per employee per local day",
                    employee_id=e.id,
                )
            )
        if len(days) > e.rules.max_days_per_week:
            issues.append(
                Issue(
                    code="weekly_days",
                    message="Too many working days in the week",
                    employee_id=e.id,
                )
            )
        for offset in range(-6, 7):
            left = p.week_start + timedelta(days=offset)
            total = sum(s.paid_units for s in scheduled if left <= s.day < left + timedelta(days=7))
            if total > e.rules.max_rolling_seven_day_units:
                issues.append(
                    Issue(
                        code="rolling_hours",
                        message=f"Rolling seven-day paid maximum exceeded from {left}",
                        employee_id=e.id,
                        day=left,
                    )
                )
        worked = {s.day for s in scheduled}
        k = e.rules.max_consecutive_days
        for offset in range(-k, 7):
            left = p.week_start + timedelta(days=offset)
            if all(left + timedelta(days=i) in worked for i in range(k + 1)):
                issues.append(
                    Issue(
                        code="consecutive_days",
                        message=f"More than {k} consecutive working days",
                        employee_id=e.id,
                        day=left,
                    )
                )
    by_signature = {signature(s) for s in assignments}
    for s in p.baseline:
        if s.id in p.locked_assignment_ids and signature(s) not in by_signature:
            issues.append(
                Issue(
                    code="locked_assignment",
                    message=f"Locked assignment {s.id} was changed or omitted",
                    employee_id=s.employee_id,
                    day=s.day,
                )
            )
    for day in p.days:
        daily = [s for s in assignments if s.day == day and s.employee_id in people]
        for minute in range(p.operating_window.start, p.operating_window.end, 30):
            active_ids = {s.employee_id for s in daily if active(s, minute)}
            present = [people[eid] for eid in sorted(active_ids)]
            _, minimum, skills = requirements_at(p, day, minute)
            if len(present) < minimum:
                issues.append(
                    Issue(
                        code="mandatory_headcount",
                        message="Mandatory staffing minimum not met",
                        day=day,
                        minute=minute,
                        required=minimum,
                        actual=len(present),
                    )
                )
            for skill, minimum in skills.items():
                actual = sum(
                    qualified(e, skill, day, minute, minute + 30, p.timezone) for e in present
                )
                if actual < minimum:
                    issues.append(
                        Issue(
                            code="skill_coverage",
                            message=f"Mandatory qualified {skill} coverage not met",
                            day=day,
                            minute=minute,
                            skill_id=skill,
                            required=minimum,
                            actual=actual,
                        )
                    )
            paired, missing = interval_pairing(p, present, day, minute)
            pairings.extend(paired)
            for e in missing:
                issues.append(
                    Issue(
                        code="supervision",
                        message="Trainee lacks independent qualified supervision capacity",
                        employee_id=e.id,
                        day=day,
                        minute=minute,
                        skill_id=e.supervision_skill_id,
                    )
                )
    # Keep distinct structured issues, not duplicated strings from adjacent checks.
    unique = {issue.model_dump_json(): issue for issue in issues}
    return ValidationReport(
        valid=not unique, issues=tuple(unique.values()), supervision_pairings=tuple(pairings)
    )
