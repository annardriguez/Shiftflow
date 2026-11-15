# Implementation roadmap, assumptions, and evaluation

## Milestone 1 — product foundation (implemented)

Deliver dashboard, team directory and profile edits, recurring availability editor, soft labour targets, weekly draft roster and list, server-validated manual edits, CSV export, calculated coverage and paid hours, fictional scenarios, local persistence, responsive navigation, tests, and technical documentation.

Acceptance: all three fixture rosters satisfy individual demo assignment rules, and intentionally incomplete skill coverage is explicitly diagnosed; invalid edits are rejected; local data survives reload/restart; interface distinguishes fixtures and future functions; type checks, tests and build succeed. This is a demonstration foundation, not a complete legally compliant scheduling system.

## Milestone 2 — optimization engine (approved and implemented)

1. Confirm preparation hours, staffing intervals, mandatory versus desired coverage, employee entitlements and rules with the manager and appropriate qualified reviewers.
2. Set up Python/FastAPI/Pydantic, pinned OR-Tools, immutable snapshots, candidate generation including break alternatives, and explicit OpenAPI contracts.
3. Implement the specified CP-SAT model and independent validation; add deterministic normal, high-demand, shortage, and hard-infeasible fixtures.
4. Return actual metrics, solver statuses, assumption diagnostics, runtime and bounds. Profile candidate size and set resource limits.

Acceptance: no unavailable assignments; all hard rules independently verified; shortages exposed; infeasibility distinguished from timeout; all three strategies use genuine solves against the same snapshot. The local fictional-data engine, contracts, tests and API are implemented; manager/legal rule confirmation remains required before any real pilot. See [Milestone 2 implementation](milestone2.md).

## Milestone 3 — intelligent scheduling interface (approved and implemented)

Implement week/config review → solve → compare three real alternatives → inspect evidence-based explanations → manually edit/revalidate → save preferred draft/export. Store run provenance and audit previous/new assignments; publishing remains a separate future workflow. Cancel or label stale runs after input changes. Show objective tradeoffs and exact coverage intervals instead of a single opaque quality number.

Acceptance: saved assignments match the selected validated alternative; explanations reconcile with metrics; manual changes invalidate stale metrics correctly. Implemented and verified locally; see [Milestone 3 details](milestone3.md).

## Milestone 4 — workforce workflows (approved and implemented locally)

Build mobile employee access, recurring/date-specific availability and preferences, time-off requests, swap acceptance/manager approval/application, quick manager-recorded changes, transition history, and notification events. Record WhatsApp agreements only as manager-entered changes; never imply Strobbo was updated.

Acceptance: state transitions authorized and version checked; approving/applying a swap revalidates both schedules atomically; failures leave the original roster intact. Implemented using explicit fictional demo identities and single-process atomic JSON persistence. See [Milestone 4 details](milestone4.md). Authentication/database foundations from Milestone 5 remain required before real accounts or real data.

## Milestone 5 — local authentication and PostgreSQL (approved scope implemented)

Implemented password authentication and revocable sessions, authoritative per-restaurant manager/employee memberships, PostgreSQL persistence with forced tenant RLS, multi-process atomic workflows, migration/import, append-only history, private logical backup/empty-target restore, and automated/browser isolation checks. The identity impersonation switcher and JSON runtime fallback are removed. Everything runs on loopback with fictional data; Strobbo is disconnected. See [Milestone 5](milestone5.md).

Acceptance evidence covers forged role/tenant claims, cross-tenant IDs/runs/requests, revoked/expired/tampered sessions, membership role changes, password-change revocation, rate limits, database privilege/RLS checks, two-process concurrency, and restored access/isolation. Existing scheduling/workforce suites run against PostgreSQL and the protected real engine.

Public deployment and a real pilot are not part of this approval. Remaining gates include production HTTPS/secrets and backup operations, real-user onboarding/recovery/MFA policies, retention/deletion and tenant lifecycle, shared-worker cross-restaurant rules, security/privacy review and manager/qualified employment-rule review. No live employee data or external integration is enabled.

## Critical assumptions and limitations

- All people are fictional adults; the 15 synthetic profiles include students, morning/evening and weekend preferences, approved absences and opening/closing eligibility restrictions. No real employee information is used.
- The restaurant name is contextual. Utrecht is a fictional pilot location, not a verified store selection or authorized brand partnership.
- Base dates are 16–22 November 2026. The overview uses the selected Monday, not live attendance or a live clock.
- Preparation hours are 10:00–23:00; fixture customer-facing coverage rises from 11:00 and falls at 21:30. Exact real opening/preparation hours remain unconfirmed.
- Labour recommendations have unknown provenance. The demo exposes manually editable paid-hour targets and never derives sales forecasts or claims budget provenance.
- Minimum 11h rest, maximum 9h shifts, a 30-minute unpaid break after 5.5h, employee max paid hours, and availability are explicit prototype rules. This is not a comprehensive legal rule set. Minors, rolling work/rest limits, entitlements and applicable collective agreements need review. No real-world legal sufficiency is asserted.
- The manager editor still has one recurring window per day. Canonical Python inputs now support disjoint date-specific availability windows, explicit weekly minimum entitlements, rolling limits and supplied history. Overnight shifts, multiple/paid breaks and the richer manager configuration interface remain future work.
- Opening and closing shift types validate endpoint semantics and individual shift eligibility. Separate competency rules now diagnose qualified opening/closing coverage and block new/worsened skill deficits. Existing draft gaps remain visible; there is no publishable certification.
- Current rest checks account for actual elapsed Amsterdam time over DST changes. Daytime operating windows avoid ambiguous/nonexistent DST clock times. Paid hours use clock duration; this is valid for these daytime shifts and must be generalized before overnight work.
- Local single-process JSON persistence is reversible demo infrastructure, not a scalable multi-user repository. The bounded audit is not immutable. Same-origin restrictions do not replace authentication.
- No Strobbo integration, paid model, external account or production deployment exists. Direct editing and sample values are never described as optimization.

## Future evaluation plan

Ask the manager to create comparable fictional rosters with their existing workflow and with ShiftFlow. Use the same demand, availability, rules, and quality criteria, counterbalance order, and separate learning time from normal use. Only move to approved real data after pilot gates.

Measure time to a hard-valid usable draft, number of manual revisions, confirmed-availability conflicts, uncovered person-intervals, mandatory shortfalls, paid-hour deviation, published changes/cancellations, and employee-reported scheduling satisfaction. Record sample sizes, workload context, missing data and subjective tradeoffs. Include qualitative interviews about whether diagnostics support decisions and whether preferences are represented fairly. Report descriptive results and uncertainty; do not claim causal labour savings or broad performance improvements from a small uncontrolled pilot.

## Revised scope: skill-aware staffing and replacement

Milestone 1 now includes objective competency badges, a manager-workspace skill review editor, configurable restaurant skill coverage/supervision parameters, per-shift diagnostics, skill warnings, and read-only Find Shift Cover with complete hard reasons and separate preference ranking. Preserve completed scheduling/availability/budget features and old local edits through a fail-closed migration. Local demo manager provenance is explicit; real role authorization is not claimed.

Milestone 2 adds qualification parameters, hard interval skill coverage, shared-capacity supervision pairings and qualification-aware independent validation to the real CP-SAT service. Milestone 3 exposes those diagnostics and pairing explanations for genuine alternatives. Milestone 4 implements employee offers/bilateral swaps, final manager approval, fresh transactional revalidation/application, durable approver/time/history and separate external sync state. Milestone 5 establishes authenticated manager-only certification, tenant isolation and durable effective-dated qualification history before real data/use.

Manager decisions still needed:

1. Which skills are mandatory, and at exactly which intervals? Does closing qualification apply to a named responsible closer, everyone on a closing shift, or at least one colleague? How many openers/closers must be present, and can a closer take a break during those duties?
2. What qualifies someone to train/supervise, who may verify it, and when does a qualification expire or require re-verification? Can trainees hold independent task qualifications while still needing supervision for another task?
3. Maximum simultaneous trainees per supervisor; can that supervisor serve customers/open/close simultaneously? Must mentorship be continuous with one person, or are interval-based handovers allowed? Must distinct tasks be covered by different people?
4. Does a trainee need general supervision or supervision for specific tasks, and does that vary by shift or training stage? Multiple simultaneous supervision needs are not supported by the local v2 editor.
5. Are there employees who can work till closing but cannot be the responsible closer? Confirm shift-duty requirements separately from clock-time shift eligibility.
6. Should already-incomplete drafts allow incremental repairs? Current manual edits reject new/worsened skill deficits; cover previews require all relevant mandatory intervals to pass. True revocation is always recordable and exposes gaps.
7. Which rest/working-time and entitlement rules apply beyond the demo defaults? Eligibility is valid only for configured rules; it is not legal compliance certification.
8. How should eligible people be ranked (preferred-hour shortfall, requested times, equitable distribution)? No preference may override hard eligibility.
