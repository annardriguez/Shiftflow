# Product redesign: interface, swap experience and design system

This pass turns the Milestone 5 workspace into a coherent product interface. No backend capability was removed or weakened: the CP-SAT engine, the independent validator, PostgreSQL row-level security, the request state machine and atomic approval are unchanged. Only one additive server capability was introduced (see "Server changes").

## Information architecture

**Manager** (sidebar, grouped):

| Group      | Page                         | Route           | Purpose                                                                       |
| ---------- | ---------------------------- | --------------- | ----------------------------------------------------------------------------- |
| Operations | Overview                     | `/`             | Needs-attention list, week strip, day line-up, quick actions, recent changes |
| Operations | Schedule                     | `/schedule`     | Weekly roster grid (desktop) / agenda (phones), shift drawer                  |
| Operations | Swap Centre                  | `/requests`     | Filterable requests, roster impact, live preflight check, approve/reject     |
| People     | Team                         | `/team`         | Capability matrix (opens / closes / supervises / service), skill verification |
| People     | Availability                 | `/availability` | Weekly availability, time off, one-off changes                               |
| Planning   | Schedule Intelligence        | `/intelligence` | "Generate my week": three optimiser strategies compared side by side          |
| Planning   | Labour & coverage            | `/labour`       | Hours vs targets, per-person hours, half-hour staffing heat map              |
| —          | Settings                     | `/settings`     | Staffing rules, working-time rules, integrations status, demo data           |

**Employee** (mobile-first, bottom tab bar on phones, top tabs on desktop): My shifts, Requests, Availability, Profile. Employees never see the full roster or manager controls; the server already enforces this.

## Signature flow: intelligent shift swapping

1. The employee taps a shift and chooses **Find a replacement**.
2. The server evaluates every colleague (or every nearby shift for a two-way swap) with the independent engine validator on the complete proposed roster, exactly as before.
3. `src/lib/swap-insights.ts` translates the engine findings into a verdict and plain-language explanation. It never decides eligibility.
   - **Suitable replacement**: passed every mandatory check. Only these can be asked.
   - **Needs manager review**: blocked only because the person's skills are unverified (unknown is never treated as competent).
   - **Blocked by existing gap**: every finding already exists on the saved roster; the person isn't the problem, the roster is.
   - **Not eligible**: the change itself breaks a rule (availability, rest, hours, closing cover, supervision, …).
   - Soft factors (hours relative to preference, "Can close", "Can supervise", shift leader) are shown as chips and can never upgrade an ineligible option.
4. The colleague accepts or declines on their phone. Acceptance revalidates (existing behaviour).
5. In the Swap Centre the manager sees the concrete roster change, the request history, and a **roster check** that runs the same validation approval will run. Approve is disabled when the check fails, and approval itself still revalidates atomically on the server.
6. The applied request shows who approved it, when, the roster version, and that **no external scheduling system is connected**.

Request states are distinct and labelled: Awaiting colleague → Awaiting approval → Applied to roster, plus Declined, Rejected, Cancelled and Expired (the shift changed after the request was made).

## Server changes (additive)

- `CoverOption` / `SwapOption` gain optional `issues: CandidateIssue[]` (engine code, message, day, minute, employee) with `preExisting`, computed by validating the unmodified saved roster for the same weeks. Also `role`, `skillsReviewed`, `maxHours`, `canClose`. Existing `reasons` strings are unchanged.
- `GET /api/workforce?view=assessment&id=<requestId>` returns a read-only preflight (`RequestAssessment`) for a stored request. It is restricted to the manager and the two people on the request, never writes, and is never used as approval authority.

## Design system

`src/app/globals.css` defines tokens on `:root`: surfaces, text, lines, one cobalt accent, status colours (positive, caution, negative) and three shift-type hues used only on the roster (opening amber, midday teal, closing indigo). Inter is self-hosted via `@fontsource-variable/inter` (no external font requests). Reusable primitives live in `src/components/ui.tsx` (Avatar, CanClose, StatusPill, Callout, EmptyState, Skeleton, Modal with dialog and drawer variants, WeekPicker, PageTitle) and `src/components/requests.tsx` (Stepper, ChangeCards, Timeline, PersonalChange). Drawers become bottom sheets under 640 px. Reduced-motion preferences disable animation.

## What is real and what is not

- **Fully functional (persisted in PostgreSQL):** shift edits, schedule generation and saving, skill verification, availability, cover/swap requests, colleague acceptance, manager approval and application, time-off and availability requests, in-app notifications, audit history.
- **Demo-only:** all people and restaurants are fictional. The workspace says so in the sidebar and on sign-in.
- **Not implemented, and labelled as such:** no external scheduling system (e.g. Strobbo) integration, and no email, SMS or WhatsApp notifications. Approved changes must be copied into any external system manually, and the UI says so wherever a change is applied.

## Tests

- `tests/swap-insights.test.ts`: verdict classification, fail-closed behaviour, "soft preference never upgrades ineligible", pre-existing attribution, plain-language translation, request-state stepper and filter partitioning, notification text.
- `tests/workforce.integration.ts`: new case for structured candidate issues and the read-only assessment endpoint (scoping, agreement with approval, no writes).
