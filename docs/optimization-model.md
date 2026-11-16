# Mathematical scheduling model

**Status: Milestone 2 implemented.** The standalone Python/FastAPI service runs OR-Tools CP-SAT and independently validates returned assignments. See [implementation contract](milestone2.md) for exact integer scales, finite candidate defaults, phase statuses and scope limits. The existing manager calendar remains a handcrafted/editable fixture; API results are not applied there until the Milestone 3 interface.

## Index sets and inputs

Use E employees, D local scheduling dates, S candidate shift-and-break variants, and T half-hour coverage intervals. A candidate has one date d(s), timezone-aware start/end instants, type, and an explicit break pattern. Candidate generation enumerates feasible start/length/break variants inside operating/preparation windows; it must not independently choose an employee. Prune employee/candidate pairs using confirmed availability, approved absences, eligibility, employment rules, and boundary-week assignments.

Use integer half-hour units Δ=30 minutes. Let q_s be **paid** duration in units, and a_sdt be 1 only when the worker is actually available for service for the entire interval (0 during any break, paid or unpaid). Clock duration and paid labour therefore differ. Inputs also include desired headcount r_dt, mandatory minimum m_dt (possibly zero), daily paid-unit target b_d, preferred paid-hour range [pL_e,pU_e], employment min/max [hL_e,hU_e], individual rest bounds, historical paid hours/burden, existing published assignment indicators y_es, opening/closing qualified requirements, and per-pair preference costs c_es. No sensitive personal attributes enter the model.

Mandatory opening and closing counts are distinct from desired interval targets. The UI's synthetic headcount targets remain soft. Restaurant-level competency interval requirements are now separately configurable and mandatory in skill diagnostics and cover checks; the Milestone 2 solver must enforce those hard inputs. The draft UI does not certify a complete operational roster.

## Variables and accounting

For each admissible pair, x_es ∈ {0,1}. Define:

- H_e = Σ_s q_s x_es, integer paid units.
- L_d = Σ_e Σ_{s:d(s)=d} q_s x_es.
- C_dt = Σ_e,s a_sdt x_es.
- U_dt = max(0, r_dt − C_dt), understaffed people per interval.
- Bplus_d = max(0,L_d−b_d), Bminus_d = max(0,b_d−L_d).
- Pminus_e = max(0,pL_e−H_e), Pplus_e = max(0,H_e−pU_e).
- K_es = |x_es−y_es| for existing-roster stability; map manual assignments into an explicit baseline candidate identity before solving.

Use CP-SAT max/absolute equalities or bounded linear equivalents that remain exact in diagnostic output. Break variants of the same physical shift must not be double selected for an employee. Candidate capacity limits apply when shifts represent specific opening/closing slots; generic candidate time patterns can be assigned to multiple people.

## Hard constraints

1. x_es=0 for any unavailable, absent, ineligible, or otherwise invalid pair. Availability must contain the full clock window, not just paid intervals.
2. For every pair of overlapping or insufficient-rest candidates s,k for employee e: x_es+x_ek ≤ 1. Rest is real elapsed time between timezone-aware instants. Validate against fixed assignments immediately before and after the week.
3. H_e must satisfy employment min/max bounds and verified entitlements. A zero-hour contract does not imply no entitlements; missing legal parameters must be surfaced, not assumed absent.
4. Restrict daily and rolling working-time/rest rules, consecutive days, permitted shift duration, and break timing using a validated effective rule profile. Weekly sums alone do not certify working-time compliance.
5. Enforce m_dt ≤ C_dt and qualified opening/closing requirements using eligible assignments. Mandatory skills may need their own coverage sums.
6. Only validated candidates inside preparation/operating windows are allowed. Their explicit break patterns satisfy the configured policy. Approved absences and relevant employment-rule effective dates override recurring patterns.
7. Existing locked/published assignments remain fixed when the manager chooses a stability-locked run.

Daily labour budgets are never hard ceilings. Desired coverage can be unmet with U_dt reported. Operational mandatory requirements are never silently relaxed. A special diagnostic solve may relax explicitly named assumptions, but its output cannot be presented as a valid publishable roster.

## Objective and normalization

Define reference denominators from the immutable input snapshot, identical across strategies. These must not depend on the selected solution. Let R=max(1,Σ_dt r_dt), B=max(1,Σ_d b_d), P=max(1,Σ_e max(pU_e,1)), A=max(1, number of admissible assignments). All objective terms use common integer coefficient scaling M=1,000,000,000 and documented integer coefficient rounding. Do not normalize each scenario by its own achieved outcome.

Minimize αT_U + βT_B + γT_P + δT_F + εT_N + ζT_K plus a documented small short-shift penalty:

- T_U = Σ_dt U_dt / R: fraction of demanded person-intervals uncovered. Weighted critical intervals can be supported, with the same weights in the denominator.
- T_B = Σ_d (Bplus_d+Bminus_d) / B: absolute paid-labour deviation relative to recommended total. Report overrun and underrun separately. Configurable asymmetric costs require explanation.
- T_P = [Σ_e(Pminus_e+Pplus_e) + Σ_es c_es x_es] / a fixed upper reference bound: preference-range deviations and known day/time dislikes. c_es is converted into documented equivalent-unit costs. Use that same fixed bound for all runs, including zero preferred-hour cases.
- T_F: historical, availability-aware fulfillment imbalance, defined below.
- T_N: evening/weekend burden imbalance relative to explicitly eligible and available opportunity, also below.
- T_K = Σ_es K_es / max(1, count of baseline assignments + admissible new pairs): normalized number of changed baseline/new candidate indicators. A removal plus addition is two indicators; expose actual changed shifts separately for human explanation.
- Short shift term: Σ_es max(0, desiredMinimumPaidUnits−q_s)x_es divided by its fixed reference upper bound. Hard minimum entitlements remain hard rules.

CP-SAT requires integer coefficients. Construct rational coefficients using a fixed shared multiplier and bounded rounding error, record those coefficients in metadata, and check for overflow. Compute exact rational diagnostic values independently after solving. Never claim perfect mathematical normalization if integer approximation is material.

Initial **experimental** strategy weights (U,B,P,F,N,K) can be budget-first=(30,70,10,10,5,10), balanced=(60,30,25,20,10,15), coverage-first=(100,10,15,10,5,10). These are starting hypotheses to validate with the manager, not universal business optima. Hard constraints do not change. Budget-first may leave more soft gaps; coverage-first may exceed soft budgets. If real priorities demand lexicographic optimization, use sequential solves with fixed prior objectives rather than unbounded weight escalation.

## Fairness without equal hours

For each employee choose a documented desired reference g_e from their preferred range, clipped to verified hour limits and feasible availability capacity (never silently lower a legal entitlement). Record original and clipped preferences, with the reason. Define G_e=historical desired reference units+g_e, and Q_e=historical assigned units+H_e over a documented rolling horizon. Exclude G_e=0 from fulfillment-ratio comparisons and report those cases separately.

Use a scaled fulfillment ratio f_e≈M·Q_e/G_e; G_e is a constant, so cross-products or documented fixed coefficients keep the model linear. Penalize pairwise |f_e−f_j| for comparable employees, normalized by a fixed upper bound over pairs. T_F is the mean normalized absolute disparity, not equality of raw paid hours. Show each employee's preferred range, feasible reference, assigned units, historical horizon, and fulfillment alongside any aggregate score.

For evening/weekend distribution, define employee opportunity o_e from eligible, confirmed available candidate opportunities, deduplicated by overlapping opportunities so that extra break variants do not increase opportunity. Let k_e be historical burden and n_s indicate an unpopular shift. Minimize deviations of k_e+Σ_s n_s x_es from an opportunity-proportional target, using a fixed historical horizon and explicitly defined total expected burden. Distinguish people who prefer those shifts; a preference-aware desirability cost and mandatory employment protections take precedence over a simplistic count.

A transparent future fairness score can be 100·max(0,1−weightedNormalizedDisparity), with separate hour fulfillment and unpopular-shift sub-scores and an exposed weighting policy. It must be computed from real assignments and labelled descriptive. It can mislead when preferences are stale, availability is constrained by unrecorded obligations, few people have comparable opportunities, history is incomplete, or everyone is equally underallocated. Show absolute unmet preferences and coverage alongside it. Do not infer consent or satisfaction from a high score.

## Infeasibility, status, and verification

- Preflight missing availability, invalid employment bounds, empty eligible candidate pools, mandatory coverage above available capacity, and contradictory locked assignments.
- Guard hard constraint groups with named assumption literals where supported; translate a sufficient infeasible assumption set into likely causes. A sufficient core need not be minimal or exhaustive.
- Return OPTIMAL, FEASIBLE, INFEASIBLE, UNKNOWN, or MODEL_INVALID distinctly. A time limit with UNKNOWN does not prove infeasibility. FEASIBLE does not mean globally optimal; include bound, gap, and time.
- If only soft coverage is missed, return a hard-valid incomplete draft with explicit intervals, missing headcount, and actions such as asking for additional confirmed availability, changing a verified mandatory requirement, or recruiting eligible cover. Do not suggest violating employment rules.
- Independently validate every returned assignment and recompute paid hours, break coverage, rest, eligibility, absences, hour bounds, mandatory coverage, all penalties, and warnings. Reject a solver response that fails validation even if it says OPTIMAL.

## Output contract and tests

Each alternative returns `inputSnapshotId`, strategy/weight/rule versions, assignments with explicit breaks, solver status, validation report, integer objective and exact diagnostic components, per-day paid hours and target deviations, per-interval actual/desired/mandatory coverage, uncovered intervals, per-employee paid hours and preference deviations, fairness diagnostics, warnings, runtime, solver version, worker count, random seed, best bound, objective gap, and explanation evidence IDs. No explanation may invent causes beyond that evidence.

Milestone 2 acceptance tests include hard-rule invariants, break accounting, incompatible candidates, adjacent-week rest and DST, hard infeasibility, soft shortages, independent metric recomputation, deterministic worker/seed fixtures, time-limit statuses, baseline stability, normalization consistency across strategies, and preference/opportunity fairness edge cases. Backend tests exercise actual solves, independent validation and objective recomputation. Descriptive fairness is not a claim of employee satisfaction or legal compliance.

## Implemented skill-aware constraints

Let K be the restaurant competency catalog. Q_ek ∈ {0,1} is a **manager-verified, effective, non-revoked** qualification parameter at the candidate/interval time; unknown or unreviewed means 0 and a preflight warning. If validity varies within the horizon, use Q_ekt (or prune/split candidate pairs at effective-date boundaries). Do not infer Q from employee title or shift kind. Let R_dtk be mandatory qualified coverage, A_sk be assignment-required duties, V_ek indicate a trainee's required supervisor competency, and c be restaurant maximum concurrent trainees per independent supervisor. All are immutable versioned inputs, independent of strategy weights.

Personal duties: x_es ≤ Q_ek for every k with A_sk=1 (use time-indexed validity when needed). Candidate s includes the union of template, shift-kind, and assignment-specific duty requirements. Colleagues' qualifications cannot discharge personal duties.

Distinct active-worker indicator z_edt = Σ_s a_sdt x_es, binary because employee overlap is already forbidden. Breaks make a_sdt=0, so presence and every relevant qualification disappear during breaks. For all d,t,k:

    Σ_e Q_ekt z_edt ≥ R_dtk

This ensures a qualified closer throughout every required closing interval, qualified opening staff during opening/preparation duties, and arbitrary configurable skills in their required intervals. Meeting headcount alone is insufficient. A multi-skilled person may satisfy multiple skill counts simultaneously under the current explicitly assumed simultaneous-duty policy; tasks requiring different people need an additional disjoint-role allocation model before use.

For each trainee i active in interval d,t introduce binary pairing p_ijdt to independent potential supervisor j. Set p_ijdt=0 if i=j, j requires supervision, or j lacks the competency required by i. Enforce:

    Σ_j p_ijdt = z_idt                 for every trainee i
    p_ijdt ≤ z_jdt
    Σ_i p_ijdt ≤ c · z_jdt             for every supervisor j

For multiple supervision needs per trainee in a future schema, specify whether a single person can cover several needs or separate pairings are mandatory; do not silently reuse this one-need formulation. Capacity is shared across **all** trainee competency groups: separate per-skill ratios could illegally allocate the same supervisor twice. Pairings can vary by interval; continuous mentorship/handovers need extra constraints if required. Supervisors may perform ordinary qualified duties while supervising in the current prototype assumption. If prohibited, allocate supervisor time separately and subtract it from other duty coverage. Obtain the manager's decision before using that policy operationally.

Qualifications, operational skill minima, and supervision are hard constraints across budget-first, balanced and coverage-first. None can be traded away through objective weights. Infeasibility diagnostics name interval, required skill, minimum, available qualified people, missing effective qualifications and supervision capacity. A diagnostic relaxation may show shortfall variables but cannot be labelled a complete feasible schedule or an eligible replacement. Output must include per-interval qualified counts/deficits and actual supervision pairings from a verified solution, not an invented “experienced staff” score.

Qualification-aware replacement validation uses the proposed **post-change** roster: remove the original assignment, insert the replacement, independently recompute interval qualifications and feasible shared-capacity trainee pairing, and check all other hard constraints. Bilateral swaps replace both sides simultaneously. Candidate preferences (distance from desired hours, preference-compatible windows, stability) rank only hard-valid candidates and cannot override a missing closer or supervisor. Recheck at application time against fresh rule, qualification and schedule versions within the transaction. No client preview is an approval token.

Acceptance cases: no qualified closer; unqualified replacement for a personal closing duty; loss of the only qualified colleague; trainee alone; supervisor on break; handover gaps; two staggered qualified colleagues whose union covers the required window; valid qualified replacement; shared capacity across different supervision skills; boundary rest/hour conflicts; revoked/unreviewed qualifications; stale assessment rejected or revalidated before application. Milestone 1 tests the TS diagnostics/replacement preview; the backend suite separately tests actual OR-Tools constraints and independent validation.

## Exact Milestone 2 implementation choices

The implementation uses a 100-point truncated fulfillment ratio, 1e9 integer objective coefficient scale, fixed conservative upper-bound denominators for preference/fairness/burden/stability/short-shift terms, and total recommended units for budget deviation. Unpopular-shift opportunity is deduplicated by available candidate day under the explicit one-shift-per-day policy. Burden disparity is the linear cross-product deviation from the opportunity-proportional share of actual historical-plus-current burden, normalized by a fixed input bound. This avoids a solution-dependent denominator while allowing a linear objective. Fairness reference capacity is an upper bound, not guaranteed jointly attainable hours.

Default candidate starts are hourly; interval coverage/break units are half-hourly, and 30-minute starts are configurable. Large-model solves use a genuine CP-SAT coverage/budget warm start under every hard rule, followed by a full weighted solve. Phase statuses and any warm-incumbent fallback are explicit; no warm-start optimum is described as full-objective optimality. Strict FEASIBLE/OPTIMAL/UNKNOWN/INFEASIBLE handling, independently recomputed objective values and integer-rounding metadata are part of the response. See [Milestone 2](milestone2.md) for limitations.


## Milestone 3 use of the formulation

All three UI alternatives solve the exact same captured snapshot with existing strategy weights. Preview edits invalidate validation, and validation/save check the full proposed assignment set independently. Stale source revisions are rejected. UI comparison metrics refer to original generated assignments; edited preview totals are separate. The mathematical constraints and normalization from Milestone 2 are unchanged.

### Hosted memory bound: aggregate rest intervals

The one-shift-per-employee-per-day equality permits an equivalent compact rest model. For each employee/day, selected UTC start and end are linear sums of candidate starts/ends weighted by assignment binaries. One optional interval uses those selected times, extends the end by mandatory rest, and is present exactly when that employee works that day. `NoOverlap` operates on at most seven such intervals per employee plus fixed boundary assignments, instead of on every candidate/break variant. Fixed boundary conflicts remain explicit preflight findings. No candidate, objective term, qualification, coverage, supervision, availability or working-time rule is relaxed. Spring/fall Amsterdam DST, locked adjacent shifts and invalid boundary rest have regression tests. Capacity exhaustion returns an explicit 503 and never produces a saved/eligible schedule.
