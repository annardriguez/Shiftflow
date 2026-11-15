"""Clock windows are local, rest is measured between UTC instants."""

from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo


@lru_cache(maxsize=8192)
def instant(day: date, minute: int, timezone: str) -> datetime:
    wall = datetime.combine(day, datetime.min.time()) + timedelta(minutes=minute)
    zone = ZoneInfo(timezone)
    variants = set()
    for fold in (0, 1):
        value = wall.replace(tzinfo=zone, fold=fold).astimezone(UTC)
        if value.astimezone(zone).replace(tzinfo=None) == wall:
            variants.add(value)
    if len(variants) != 1:
        raise ValueError(f"Ambiguous or nonexistent local time: {day} {minute} in {timezone}")
    return variants.pop()


def conflicting(a, b, timezone: str, rest_minutes: int) -> bool:
    a_start, a_end = instant(a.day, a.start, timezone), instant(a.day, a.end, timezone)
    b_start, b_end = instant(b.day, b.start, timezone), instant(b.day, b.end, timezone)
    return max(a_start, b_start) - min(a_end, b_end) < timedelta(minutes=rest_minutes)


def signature(s, employee_id: str | None = None) -> tuple:
    return (
        employee_id or s.employee_id,
        s.day,
        s.start,
        s.end,
        s.break_start,
        s.break_minutes,
        s.kind,
        tuple(sorted(s.required_skills)),
    )


def active(s, minute: int) -> bool:
    return (
        s.start <= minute
        and s.end >= minute + 30
        and not (
            s.break_minutes
            and s.break_start is not None
            and s.break_start < minute + 30
            and s.break_start + s.break_minutes > minute
        )
    )
