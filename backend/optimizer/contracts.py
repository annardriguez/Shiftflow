"""Versioned, immutable transport/domain contracts. All time quantities are integers."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from uuid import uuid4
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, model_validator

ID = Annotated[str, Field(min_length=1, max_length=100)]
Minute = Annotated[int, Field(strict=True, ge=0, le=1440, multiple_of=30)]
Units = Annotated[int, Field(strict=True, ge=0, le=336)]
Kind = Literal["Opening", "Midday", "Closing"]
Strategy = Literal["budget-first", "balanced", "coverage-first"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class Window(Contract):
    start: Minute
    end: Minute

    @model_validator(mode="after")
    def ordered(self):
        if self.start >= self.end:
            raise ValueError(
                "Window must have positive duration; overnight windows are unsupported"
            )
        return self


class Availability(Contract):
    day: date
    windows: tuple[Window, ...] = Field(max_length=4)

    @model_validator(mode="after")
    def disjoint(self):
        windows = sorted(self.windows, key=lambda w: w.start)
        if any(a.end > b.start for a, b in zip(windows, windows[1:])):
            raise ValueError("Availability windows must not overlap")
        return self


class Qualification(Contract):
    skill_id: ID
    verified_by: ID
    verified_at: datetime
    expires_at: datetime | None = None
    revoked_at: datetime | None = None

    @model_validator(mode="after")
    def aware(self):
        for value in (self.verified_at, self.expires_at, self.revoked_at):
            if value is not None and value.utcoffset() is None:
                raise ValueError("Qualification timestamps require an explicit timezone")
        if self.expires_at and self.expires_at <= self.verified_at:
            raise ValueError("Qualification expiry must follow verification")
        return self


class EmploymentRules(Contract):
    # Explicit synthetic entitlement bounds, never inferred from a zero-hour contract.
    min_weekly_units: Units
    max_weekly_units: Units
    min_shift_minutes: Annotated[int, Field(strict=True, ge=30, le=540, multiple_of=30)]
    max_shift_minutes: Annotated[int, Field(strict=True, ge=30, le=540, multiple_of=30)]
    max_daily_units: Units
    max_days_per_week: Annotated[int, Field(strict=True, ge=0, le=7)]
    max_consecutive_days: Annotated[int, Field(strict=True, ge=1, le=7)]
    max_rolling_seven_day_units: Units
    min_rest_minutes: Annotated[int, Field(strict=True, ge=0, le=1440, multiple_of=30)]
    break_after_minutes: Annotated[int, Field(strict=True, ge=30, le=540, multiple_of=30)]
    min_break_minutes: Annotated[int, Field(strict=True, ge=30, le=120, multiple_of=30)]
    max_continuous_minutes: Annotated[int, Field(strict=True, ge=30, le=540, multiple_of=30)]

    @model_validator(mode="after")
    def consistent(self):
        if self.min_weekly_units > self.max_weekly_units:
            raise ValueError("Minimum weekly entitlement exceeds maximum")
        if self.min_shift_minutes > self.max_shift_minutes:
            raise ValueError("Minimum shift duration exceeds maximum")
        return self


class TimePreference(Contract):
    weekday: Annotated[int, Field(strict=True, ge=0, le=6)]
    window: Window
    cost_per_interval: Annotated[int, Field(strict=True, ge=0, le=20)]


class History(Contract):
    paid_units: Annotated[int, Field(strict=True, ge=0, le=2000)] = 0
    desired_units: Annotated[int, Field(strict=True, ge=0, le=2000)] = 0
    unpopular_shifts: Annotated[int, Field(strict=True, ge=0, le=100)] = 0


class Employee(Contract):
    id: ID
    name: Annotated[str, Field(min_length=1, max_length=100)]
    availability: tuple[Availability, ...] = Field(max_length=7)
    absent_dates: tuple[date, ...] = Field(default=(), max_length=7)
    eligible_kinds: tuple[Kind, ...] = Field(min_length=1, max_length=3)
    qualifications: tuple[Qualification, ...] = Field(max_length=40)
    skills_reviewed: bool
    supervision_skill_id: ID | None = None
    rules: EmploymentRules
    preferred_min_units: Units
    preferred_max_units: Units
    time_preferences: tuple[TimePreference, ...] = Field(default=(), max_length=14)
    prefers_unpopular: bool = False
    history: History = History()

    @model_validator(mode="after")
    def unique(self):
        if self.preferred_min_units > self.preferred_max_units:
            raise ValueError("Preferred minimum exceeds preferred maximum")
        if len({a.day for a in self.availability}) != len(self.availability):
            raise ValueError("Availability dates must be unique")
        if len({q.skill_id for q in self.qualifications}) != len(self.qualifications):
            raise ValueError("Duplicate qualification")
        return self


class SkillRequirement(Contract):
    id: ID
    day: date
    window: Window
    skill_id: ID
    minimum: Annotated[int, Field(strict=True, ge=1, le=40)]


class HeadcountRequirement(Contract):
    day: date
    window: Window
    target: Annotated[int, Field(strict=True, ge=0, le=40)]
    mandatory: Annotated[int, Field(strict=True, ge=0, le=40)] = 0

    @model_validator(mode="after")
    def target_above_minimum(self):
        if self.target < self.mandatory:
            raise ValueError("Desired headcount must not be lower than mandatory minimum")
        return self


class Budget(Contract):
    day: date
    paid_units: Annotated[int, Field(strict=True, ge=0, le=600)]


class DutyRules(Contract):
    opening: tuple[ID, ...] = ()
    midday: tuple[ID, ...] = ()
    closing: tuple[ID, ...] = ()

    def for_kind(self, kind: Kind) -> tuple[str, ...]:
        return getattr(self, kind.lower())


class Assignment(Contract):
    id: ID
    employee_id: ID
    day: date
    start: Minute
    end: Minute
    break_start: Minute | None = None
    break_minutes: Annotated[int, Field(strict=True, ge=0, le=120, multiple_of=30)] = 0
    kind: Kind
    required_skills: tuple[ID, ...] = Field(default=(), max_length=40)

    @model_validator(mode="after")
    def clock_and_break(self):
        if self.end <= self.start:
            raise ValueError("Assignment end must follow start")
        if self.break_minutes:
            if (
                self.break_start is None
                or self.break_start < self.start
                or self.break_start + self.break_minutes > self.end
                or self.break_minutes >= self.end - self.start
            ):
                raise ValueError("Unpaid break must fit entirely inside shift")
        elif self.break_start is not None:
            raise ValueError("A zero-length break must not have a start")
        return self

    @property
    def paid_units(self) -> int:
        return (self.end - self.start - self.break_minutes) // 30


class Candidate(Assignment):
    """Employee ID is empty-pattern sentinel internally; outputs always have actual employees."""


class Generation(Contract):
    start_step_minutes: Literal[30, 60] = 60
    durations_minutes: tuple[
        Annotated[int, Field(strict=True, ge=60, le=540, multiple_of=30)], ...
    ] = (240, 360, 480)
    break_offsets_minutes: tuple[
        Annotated[int, Field(strict=True, ge=30, le=480, multiple_of=30)], ...
    ] = (120, 180, 240)
    break_minutes: Literal[30, 60] = 30
    minimum_desirable_paid_units: Annotated[int, Field(strict=True, ge=0, le=18)] = 8

    @model_validator(mode="after")
    def bounded(self):
        if not 1 <= len(set(self.durations_minutes)) <= 8:
            raise ValueError("Provide 1–8 distinct candidate durations")
        if not 1 <= len(set(self.break_offsets_minutes)) <= 8:
            raise ValueError("Provide 1–8 distinct break offsets")
        return self


class SchedulingInput(Contract):
    schema_version: Literal[1] = 1
    fictional_data: Literal[True]
    rules_verified_for_demo: Literal[True]
    restaurant_id: Literal["restaurant-demo"]
    source_revision: Annotated[int, Field(strict=True, ge=0)] | None = None
    week_start: date
    timezone: str = "Europe/Amsterdam"
    operating_window: Window = Window(start=600, end=1380)
    skill_ids: tuple[ID, ...] = Field(min_length=1, max_length=40)
    skill_requirements: tuple[SkillRequirement, ...] = Field(max_length=560)
    duties: DutyRules
    supervision_capacity: Annotated[int, Field(strict=True, ge=1, le=10)]
    employees: tuple[Employee, ...] = Field(min_length=1, max_length=30)
    headcount: tuple[HeadcountRequirement, ...] = Field(max_length=182)
    budgets: tuple[Budget, ...] = Field(min_length=7, max_length=7)
    boundary_assignments: tuple[Assignment, ...] = Field(default=(), max_length=420)
    baseline: tuple[Assignment, ...] = Field(default=(), max_length=210)
    locked_assignment_ids: tuple[ID, ...] = Field(default=(), max_length=210)
    generation: Generation = Generation()
    rule_version: str = "fictional-adult-v1"
    history_window: str = "Four fictional weeks preceding the scheduling week"

    @property
    def days(self) -> tuple[date, ...]:
        return tuple(self.week_start + timedelta(days=d) for d in range(7))

    @model_validator(mode="after")
    def references(self):
        if self.week_start.weekday() != 0:
            raise ValueError("Scheduling week must start on Monday")
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Unknown IANA timezone") from exc
        skills = set(self.skill_ids)
        ids = {e.id for e in self.employees}
        if len(skills) != len(self.skill_ids) or len(ids) != len(self.employees):
            raise ValueError("Employee and skill IDs must be unique")
        if {b.day for b in self.budgets} != set(self.days):
            raise ValueError("Exactly one budget is required for each scheduling date")
        known_skills = [*self.duties.opening, *self.duties.midday, *self.duties.closing]
        for e in self.employees:
            known_skills.extend(q.skill_id for q in e.qualifications)
            if e.supervision_skill_id:
                known_skills.append(e.supervision_skill_id)
            if any(a.day not in self.days for a in e.availability) or any(
                d not in self.days for d in e.absent_dates
            ):
                raise ValueError("Availability and absence dates must fall in the scheduling week")
        for r in (*self.skill_requirements, *self.headcount):
            if (
                r.day not in self.days
                or r.window.start < self.operating_window.start
                or r.window.end > self.operating_window.end
            ):
                raise ValueError("Requirements must fit scheduling dates and operating window")
        known_skills.extend(r.skill_id for r in self.skill_requirements)
        assignments = (*self.baseline, *self.boundary_assignments)
        if len({s.id for s in assignments}) != len(assignments):
            raise ValueError("Assignment IDs must be unique across baseline and boundaries")
        for s in assignments:
            if s.employee_id not in ids:
                raise ValueError("Assignment references an unknown employee")
            known_skills.extend(s.required_skills)
        if any(s.day not in self.days for s in self.baseline):
            raise ValueError("Baseline assignments must be in the scheduling week")
        if any(
            s.day in self.days or not -7 <= (s.day - self.week_start).days <= 13
            for s in self.boundary_assignments
        ):
            raise ValueError(
                "Boundary assignments must be outside the week and within the adjacent seven days"
            )
        if not set(self.locked_assignment_ids) <= {s.id for s in self.baseline}:
            raise ValueError("Locked IDs must refer to baseline assignments")
        if not set(known_skills) <= skills:
            raise ValueError("Unknown competency reference")
        # Daytime-only, unambiguous timestamps; never guess DST folds/gaps.
        from .time_math import instant

        for d in self.days:
            for m in range(self.operating_window.start, self.operating_window.end + 1, 30):
                instant(d, m, self.timezone)
        for assignment in assignments:
            instant(assignment.day, assignment.start, self.timezone)
            instant(assignment.day, assignment.end, self.timezone)
        from .time_math import signature

        if len({signature(s) for s in self.baseline}) != len(self.baseline):
            raise ValueError("Baseline contains duplicate physical assignments")
        return self


class Weights(Contract):
    understaffing: Annotated[int, Field(strict=True, ge=0, le=1000)]
    budget: Annotated[int, Field(strict=True, ge=0, le=1000)]
    preferences: Annotated[int, Field(strict=True, ge=0, le=1000)]
    fairness: Annotated[int, Field(strict=True, ge=0, le=1000)]
    unpopular: Annotated[int, Field(strict=True, ge=0, le=1000)]
    stability: Annotated[int, Field(strict=True, ge=0, le=1000)]
    short_shifts: Annotated[int, Field(strict=True, ge=0, le=1000)] = 5


DEFAULT_WEIGHTS = {
    "budget-first": Weights(
        understaffing=30, budget=70, preferences=10, fairness=10, unpopular=5, stability=10
    ),
    "balanced": Weights(
        understaffing=60, budget=30, preferences=25, fairness=20, unpopular=10, stability=15
    ),
    "coverage-first": Weights(
        understaffing=100, budget=10, preferences=15, fairness=10, unpopular=5, stability=10
    ),
}


class SolveOptions(Contract):
    max_seconds_per_strategy: float = Field(default=15, ge=0, le=30)
    deterministic_time_limit: float = Field(default=2, ge=0, le=20)
    random_seed: Annotated[int, Field(strict=True, ge=0, le=2147483647)] = 17
    # Single worker is deliberate: assumption cores and reproducible fixture tests.
    weights: Weights | None = None


class SolveRequest(Contract):
    snapshot: SchedulingInput
    strategies: tuple[Strategy, ...] = ("budget-first", "balanced", "coverage-first")
    options: SolveOptions = SolveOptions()

    @model_validator(mode="after")
    def distinct(self):
        if not 1 <= len(self.strategies) <= 3 or len(set(self.strategies)) != len(self.strategies):
            raise ValueError("Select 1–3 distinct strategies")
        if self.options.weights and len(self.strategies) != 1:
            raise ValueError(
                "Custom weights require one strategy so alternatives cannot be mislabelled"
            )
        return self


class ValidationRequest(Contract):
    snapshot: SchedulingInput
    assignments: tuple[Assignment, ...] = Field(max_length=210)


class Issue(Contract):
    code: str
    message: str
    employee_id: str | None = None
    day: date | None = None
    minute: int | None = None
    skill_id: str | None = None
    required: int | None = None
    actual: int | None = None


class Pairing(Contract):
    day: date
    minute: int
    trainee_id: str
    supervisor_id: str


class ValidationReport(Contract):
    valid: bool
    issues: tuple[Issue, ...]
    supervision_pairings: tuple[Pairing, ...]


class ObjectiveComponent(Contract):
    raw: int
    denominator: int
    normalized: float
    weight: int
    integer_coefficient: int
    weighted_integer: int


class SolverMetadata(Contract):
    solver: str = "OR-Tools CP-SAT"
    solver_version: str
    rule_version: str
    runtime_seconds: float
    solve_seconds: float
    deterministic_time: float
    seed: int
    workers: int = 1
    candidates: int
    admissible_pairs: int
    integer_objective: int | None = None
    best_bound: float | None = None
    relative_gap: float | None = None
    objective_scale: int = 1_000_000_000
    max_coefficient_rounding_error: float | None = None
    max_seconds: float = 15
    max_deterministic_time: float = 2
    model_fingerprint: str
    warm_start_objective: str = "Normalized coverage and budget; full objective in second phase"
    feasibility_status: str | None = None
    optimization_status: str | None = None
    used_feasibility_incumbent: bool = False


class SkillCount(Contract):
    skill_id: str
    required: int
    actual: int


class CoverageInterval(Contract):
    day: date
    minute: int
    actual: int
    target: int
    mandatory: int
    understaffing: int
    skills: tuple[SkillCount, ...]


class DailyHours(Contract):
    day: date
    paid_units: int
    paid_hours: float
    budget_units: int
    budget_deviation_units: int


class EmployeeHours(Contract):
    employee_id: str
    paid_units: int
    paid_hours: float
    preferred_min_units: int
    preferred_max_units: int
    preference_deviation_units: int
    fairness_reference_units: int
    fairness_capacity_upper_units: int
    historical_fulfillment_ratio: float | None
    unpopular_opportunity_days: int
    unpopular_shifts: int
    evening_shifts: int
    weekend_shifts: int


class ScheduleMetrics(Contract):
    total_paid_hours: float
    recommended_paid_hours: float
    budget_deviation_hours: float
    uncovered_person_hours: float
    target_coverage_percent: float | None
    daily: tuple[DailyHours, ...]
    coverage: tuple[CoverageInterval, ...]
    uncovered_intervals: tuple[CoverageInterval, ...]
    employees: tuple[EmployeeHours, ...]
    fairness_score: float
    fairness_limitations: tuple[str, ...]
    history_window: str
    baseline_assignment_changes: int


class ScheduleResult(Contract):
    strategy: Strategy
    status: Literal[
        "OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "MODEL_INVALID", "VALIDATION_FAILED"
    ]
    solver_status: str
    assignments: tuple[Assignment, ...] = ()
    validation: ValidationReport | None = None
    objective_components: dict[str, ObjectiveComponent] = Field(default_factory=dict)
    metrics: ScheduleMetrics | None = None
    diagnostics: tuple[Issue, ...] = ()
    warnings: tuple[str, ...] = ()
    metadata: SolverMetadata


class SolveResponse(Contract):
    run_id: str = Field(default_factory=lambda: str(uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    input_snapshot_id: str
    source_revision: int | None
    fictional_data: Literal[True] = True
    external_sync: Literal["not_connected"] = "not_connected"
    alternatives: tuple[ScheduleResult, ...]
