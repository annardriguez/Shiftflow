"""Explicit adapter for existing fictional Milestone 1 workspace snapshots.

Never reads the UI's filesystem or changes its draft. Synthetic employment defaults are
exposed in this contract and must not be mistaken for verified real employee entitlements.
"""

from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from .contracts import (
    Assignment,
    Availability,
    Budget,
    Contract,
    DutyRules,
    Employee,
    EmploymentRules,
    HeadcountRequirement,
    Kind,
    Qualification,
    SchedulingInput,
    SkillRequirement,
    SolveOptions,
    SolveRequest,
    Strategy,
    Window,
)


class Source(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="ignore", frozen=True
    )


class SourceQualification(Source):
    skill_id: str
    verified_by: str
    verified_at: datetime


class SourceAvailabilityOverride(Source):
    date: date
    window: Window | None


class SourceEmployee(Source):
    id: str
    name: str
    preferred_hours: Annotated[float, Field(ge=0, le=60, multiple_of=0.5)]
    max_hours: Annotated[float, Field(ge=0, le=60, multiple_of=0.5)]
    min_rest_hours: Annotated[float, Field(ge=0, le=24, multiple_of=0.5)]
    max_shift_hours: Annotated[float, Field(ge=1, le=9, multiple_of=0.5)]
    eligible: tuple[Kind, ...] = Field(min_length=1, max_length=3)
    competencies: tuple[SourceQualification, ...] = Field(max_length=40)
    skills_reviewed_at: datetime | None
    supervision_skill_id: str | None
    availability: tuple[Window | None, ...] = Field(min_length=7, max_length=7)
    absent_dates: tuple[date, ...] = Field(max_length=366)
    availability_overrides: tuple[SourceAvailabilityOverride, ...] = Field(
        default=(), max_length=366
    )

    @model_validator(mode="after")
    def unique_override_dates(self):
        if len({o.date for o in self.availability_overrides}) != len(self.availability_overrides):
            raise ValueError("Duplicate availability override dates")
        return self

    def windows_on(self, day: date):
        window = next(
            (o.window for o in self.availability_overrides if o.date == day),
            self.availability[day.weekday()],
        )
        return (window,) if window else ()


class SourceRule(Source):
    id: str
    skill_id: str
    days: tuple[Annotated[int, Field(ge=0, le=6)], ...] = Field(min_length=1, max_length=7)
    start: int
    end: int
    minimum: int


class SourceSkill(Source):
    id: str
    name: str


class SourceSkillRules(Source):
    catalog: tuple[SourceSkill, ...] = Field(min_length=1, max_length=40)
    requirements: tuple[SourceRule, ...] = Field(max_length=80)
    required_by_kind: dict[Kind, tuple[str, ...]]
    supervision_capacity: int

    @model_validator(mode="after")
    def all_kinds(self):
        if set(self.required_by_kind) != {"Opening", "Midday", "Closing"}:
            raise ValueError("Personal-duty rules must include every shift kind")
        return self


class SourceRestaurant(Source):
    id: Literal["restaurant-demo"]
    timezone: str
    open: int
    close: int
    skill_rules: SourceSkillRules


class SourceShift(Source):
    id: str
    employee_id: str
    date: date
    start: int
    end: int
    break_start: int | None
    break_minutes: int
    kind: Kind
    required_skill_ids: tuple[str, ...] = ()

    def assignment(self):
        return Assignment(
            id=self.id,
            employee_id=self.employee_id,
            day=self.date,
            start=self.start,
            end=self.end,
            break_start=self.break_start,
            break_minutes=self.break_minutes,
            kind=self.kind,
            required_skills=self.required_skill_ids,
        )


class SourceWeek(Source):
    start: date
    budgets: tuple[Annotated[float, Field(ge=0, le=300, multiple_of=0.5)], ...] = Field(
        min_length=7, max_length=7
    )
    shifts: tuple[SourceShift, ...] = Field(max_length=210)


class SourceWorkspace(Source):
    schema_version: Literal[2]
    revision: Annotated[int, Field(strict=True, ge=0)]
    restaurant: SourceRestaurant
    employees: tuple[SourceEmployee, ...] = Field(min_length=1, max_length=30)
    scenario: Literal["normal", "high-demand", "shortage"]
    weeks: tuple[SourceWeek, ...] = Field(max_length=104)


class DemoPolicy(Contract):
    min_shift_minutes: int = Field(default=180, ge=30, le=540, multiple_of=30)
    max_days_per_week: int = Field(default=5, ge=0, le=7)
    max_consecutive_days: int = Field(default=6, ge=1, le=7)
    break_after_minutes: int = Field(default=330, ge=30, le=540, multiple_of=30)
    min_break_minutes: int = Field(default=30, ge=30, le=120, multiple_of=30)
    max_continuous_minutes: int = Field(default=330, ge=30, le=540, multiple_of=30)
    minimum_weekly_units: dict[str, Annotated[int, Field(strict=True, ge=0, le=120)]] = Field(
        default_factory=dict
    )


class WorkspaceRequest(Contract):
    fictional_data: Literal[True]
    rules_verified_for_demo: Literal[True]
    workspace: SourceWorkspace
    week_start: date
    demo_policy: DemoPolicy = DemoPolicy()
    locked_assignment_ids: tuple[str, ...] = ()
    strategies: tuple[Strategy, ...] = ("budget-first", "balanced", "coverage-first")
    options: SolveOptions = SolveOptions()

    def to_request(self) -> SolveRequest:
        w = self.workspace
        week = self.week_start
        days = tuple(week + timedelta(days=i) for i in range(7))
        r = w.restaurant
        skill_rules = r.skill_rules
        selected = next((s for s in w.weeks if s.start == week), None)
        if not set(self.demo_policy.minimum_weekly_units) <= {e.id for e in w.employees}:
            raise ValueError("Minimum entitlements reference an unknown employee")
        employees = tuple(
            Employee(
                id=e.id,
                name=e.name,
                availability=tuple(
                    Availability(
                        day=d,
                        windows=e.windows_on(d),
                    )
                    for d in days
                ),
                absent_dates=tuple(d for d in e.absent_dates if d in days),
                eligible_kinds=e.eligible,
                qualifications=tuple(
                    Qualification(
                        skill_id=q.skill_id, verified_by=q.verified_by, verified_at=q.verified_at
                    )
                    for q in e.competencies
                ),
                skills_reviewed=e.skills_reviewed_at is not None,
                supervision_skill_id=e.supervision_skill_id,
                rules=EmploymentRules(
                    min_weekly_units=self.demo_policy.minimum_weekly_units.get(e.id, 0),
                    max_weekly_units=int(e.max_hours * 2),
                    min_shift_minutes=self.demo_policy.min_shift_minutes,
                    max_shift_minutes=int(e.max_shift_hours * 60),
                    max_daily_units=int(e.max_shift_hours * 2),
                    max_days_per_week=self.demo_policy.max_days_per_week,
                    max_consecutive_days=self.demo_policy.max_consecutive_days,
                    max_rolling_seven_day_units=int(e.max_hours * 2),
                    min_rest_minutes=int(e.min_rest_hours * 60),
                    break_after_minutes=self.demo_policy.break_after_minutes,
                    min_break_minutes=self.demo_policy.min_break_minutes,
                    max_continuous_minutes=self.demo_policy.max_continuous_minutes,
                ),
                preferred_min_units=int(e.preferred_hours * 2),
                preferred_max_units=int(e.preferred_hours * 2),
            )
            for e in w.employees
        )
        default_budgets = (
            [40, 40, 42, 44, 52, 56, 48]
            if w.scenario == "high-demand"
            else [32, 32, 34, 36, 44, 48, 40]
        )
        staffing = []
        for d in days:
            for minute in range(r.open, r.close, 30):
                peak = 720 <= minute < 840 or 1020 <= minute < 1200
                target = (
                    1
                    if minute < 660 or minute >= 1290
                    else (3 if peak else 2)
                    + int(d.weekday() >= 4 and peak)
                    + int(w.scenario == "high-demand")
                )
                staffing.append(
                    HeadcountRequirement(
                        day=d, window=Window(start=minute, end=minute + 30), target=target
                    )
                )
        snapshot = SchedulingInput(
            fictional_data=True,
            rules_verified_for_demo=True,
            restaurant_id=r.id,
            source_revision=w.revision,
            week_start=week,
            timezone=r.timezone,
            operating_window=Window(start=r.open, end=r.close),
            skill_ids=tuple(k.id for k in skill_rules.catalog),
            skill_requirements=tuple(
                SkillRequirement(
                    id=f"{rule.id}-{d}",
                    day=d,
                    window=Window(start=rule.start, end=rule.end),
                    skill_id=rule.skill_id,
                    minimum=rule.minimum,
                )
                for d in days
                for rule in skill_rules.requirements
                if d.weekday() in rule.days
            ),
            duties=DutyRules(
                opening=skill_rules.required_by_kind["Opening"],
                midday=skill_rules.required_by_kind["Midday"],
                closing=skill_rules.required_by_kind["Closing"],
            ),
            supervision_capacity=skill_rules.supervision_capacity,
            employees=employees,
            headcount=tuple(staffing),
            budgets=tuple(
                Budget(
                    day=d,
                    paid_units=int((selected.budgets[i] if selected else default_budgets[i]) * 2),
                )
                for i, d in enumerate(days)
            ),
            baseline=tuple(s.assignment() for s in selected.shifts) if selected else (),
            boundary_assignments=tuple(
                s.assignment()
                for other in w.weeks
                for s in other.shifts
                if s.date not in days and -7 <= (s.date - week).days <= 13
            ),
            locked_assignment_ids=self.locked_assignment_ids,
            history_window="No history supplied by workspace; historical quantities explicitly zero",
            rule_version="workspace-v2-explicit-fictional-adult-defaults-v1",
        )
        return SolveRequest(snapshot=snapshot, strategies=self.strategies, options=self.options)
