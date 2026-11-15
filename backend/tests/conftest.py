from datetime import UTC, date, datetime
import pytest

from backend.optimizer.contracts import (
    Availability,
    Budget,
    DutyRules,
    Employee,
    EmploymentRules,
    Generation,
    HeadcountRequirement,
    Qualification,
    SchedulingInput,
    SkillRequirement,
    Window,
)


@pytest.fixture
def tiny():
    monday = date(2026, 11, 16)
    rules = EmploymentRules(
        min_weekly_units=0,
        max_weekly_units=32,
        min_shift_minutes=60,
        max_shift_minutes=540,
        max_daily_units=18,
        max_days_per_week=5,
        max_consecutive_days=6,
        max_rolling_seven_day_units=32,
        min_rest_minutes=660,
        break_after_minutes=330,
        min_break_minutes=30,
        max_continuous_minutes=330,
    )
    employees = []
    for i in range(3):
        skills = ["service"] if i == 2 else ["service", "open", "close", "train"]
        employees.append(
            Employee(
                id=f"e{i}",
                name=f"Fictional person {i}",
                availability=(Availability(day=monday, windows=(Window(start=600, end=840),)),),
                eligible_kinds=("Opening", "Midday", "Closing"),
                skills_reviewed=True,
                supervision_skill_id="train" if i == 2 else None,
                qualifications=tuple(
                    Qualification(
                        skill_id=k,
                        verified_by="demo-manager",
                        verified_at=datetime(2026, 1, 1, tzinfo=UTC),
                    )
                    for k in skills
                ),
                rules=rules,
                preferred_min_units=8,
                preferred_max_units=8,
            )
        )
    return SchedulingInput(
        fictional_data=True,
        rules_verified_for_demo=True,
        restaurant_id="restaurant-demo",
        week_start=monday,
        operating_window=Window(start=600, end=840),
        skill_ids=("service", "open", "close", "train"),
        skill_requirements=(
            SkillRequirement(
                id="opener",
                day=monday,
                window=Window(start=600, end=660),
                skill_id="open",
                minimum=1,
            ),
            SkillRequirement(
                id="closer",
                day=monday,
                window=Window(start=780, end=840),
                skill_id="close",
                minimum=1,
            ),
        ),
        duties=DutyRules(opening=("service",), midday=("service",), closing=("service",)),
        supervision_capacity=1,
        employees=tuple(employees),
        headcount=(
            HeadcountRequirement(
                day=monday, window=Window(start=600, end=840), target=2, mandatory=1
            ),
        ),
        budgets=tuple(
            Budget(day=monday.replace(day=16 + i), paid_units=8 if i == 0 else 0) for i in range(7)
        ),
        generation=Generation(
            start_step_minutes=60,
            durations_minutes=(240,),
            break_offsets_minutes=(120,),
            minimum_desirable_paid_units=8,
        ),
    )
