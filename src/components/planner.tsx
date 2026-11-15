"use client";
import { workspaceFetch } from "@/lib/workspace-fetch";
import { useEffect, useState } from "react";
import { useApp } from "./provider";
import {
  Badge,
  Callout,
  ErrorBox,
  LoadGuard,
  PageTitle,
  StatusPill,
  WeekPicker,
} from "./ui";
import {
  Sparkles,
  ShieldCheck,
  Cpu,
  LoaderCircle,
  Check,
  Save,
  Download,
  Plus,
} from "lucide-react";
import { longDate, shortDate, relativeTime } from "@/lib/format";
import type { Alternative } from "@/lib/planning-types";
import {
  dateAt,
  DAYS,
  getWeek,
  paidHours,
  time,
  weekLabel,
} from "@/lib/schedule";
import { toShifts, type PlanningRun, type Report } from "@/lib/planning-types";
import type { Shift } from "@/lib/types";
import { exportRoster } from "@/lib/download";
import { SkillBadges } from "./skills";
async function request(body: unknown) {
  const r = await workspaceFetch("/api/planning", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error);
  return value;
}
/** Plain-language strategy descriptions (weights in docs/optimization-model.md). */
const STRATEGY: Record<string, { name: string; why: string }> = {
  "budget-first": {
    name: "Stay on budget",
    why: "Keeps paid hours close to your labour targets. May leave more half-hours below the ideal headcount.",
  },
  balanced: {
    name: "Balanced",
    why: "Weighs staffing coverage, labour targets and people’s preferred hours together.",
  },
  "coverage-first": {
    name: "Best coverage",
    why: "Fills as many half-hours as possible, even if that goes over the labour target.",
  },
};
const strategyName = (s: string) => STRATEGY[s]?.name ?? s.replaceAll("-", " ");
function statusText(a: Alternative) {
  if (!a.metrics || !a.validation?.valid) return { label: "No valid roster", tone: "negative" as const };
  if (a.status === "OPTIMAL") return { label: "Best possible", tone: "positive" as const };
  return { label: "Valid · time limit reached", tone: "accent" as const };
}
function bestOf(run: PlanningRun, pick: (a: Alternative) => number | null | undefined, high: boolean) {
  const values = run.alternatives
    .filter((a) => a.metrics && a.validation?.valid)
    .map((a) => pick(a))
    .filter((v): v is number => typeof v === "number");
  if (values.length < 2 || values.every((v) => v === values[0])) return null;
  return high ? Math.max(...values) : Math.min(...values);
}

export function Intelligence() {
  return (
    <LoadGuard>
      <PageTitle
        title="Schedule Intelligence"
        description="Generate a complete week that respects every availability, skill, supervision and working-time rule, then compare three approaches side by side."
      >
        <WeekPicker />
      </PageTitle>
      <div className="how-it-works">
        <div>
          <b>1</b>
          <h3>Rules are never traded away</h3>
          <p>Availability, time off, skills, closing cover, trainee supervision, rest, breaks and hour limits must all hold. A roster that breaks one is never offered.</p>
        </div>
        <div>
          <b>2</b>
          <h3>Three priorities, compared</h3>
          <p>The optimiser searches for the best roster under three different priorities, so you can see the trade-off between coverage and labour cost.</p>
        </div>
        <div>
          <b>3</b>
          <h3>Checked twice, saved by you</h3>
          <p>Every suggestion is re-checked by an independent validator. Nothing replaces your roster until you review and save it.</p>
        </div>
      </div>
      <Planner />
    </LoadGuard>
  );
}

export function Planner({ onClose }: { onClose?: () => void }) {
  const { data, week, reload, notify } = useApp();
  const [runs, setRuns] = useState<PlanningRun[]>([]),
    [run, setRun] = useState<PlanningRun | null>(null),
    [strategy, setStrategy] = useState(""),
    [shifts, setShifts] = useState<Shift[]>([]),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [seconds, setSeconds] = useState(8),
    [editing, setEditing] = useState<Shift | null>(null),
    [dirty, setDirty] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    workspaceFetch("/api/planning")
      .then(async (r) => {
        const v = await r.json();
        if (!r.ok) throw new Error(v.error);
        if (active) setRuns(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  if (!data) return null;
  const workspace = data,
    selected = run?.alternatives.find((a) => a.strategy === strategy),
    stale = !!run && run.revision !== data.revision;
  function choose(r: PlanningRun, s: string) {
    if (dirty && !confirm("Discard your unsaved preview edits?")) return;
    const a = r.alternatives.find((a) => a.strategy === s);
    setRun(r);
    setStrategy(s);
    setShifts(toShifts(a?.assignments ?? []));
    setReport(a?.validation ?? null);
    setEditing(null);
    setDirty(false);
    setSaved(false);
    setError("");
  }
  async function generate() {
    setBusy("Building three rosters and checking each one… this can take up to 45 seconds.");
    setError("");
    try {
      const r: PlanningRun = await request({
        action: "generate",
        week,
        revision: workspace.revision,
        seconds,
      });
      setRuns((old) => [r, ...old].slice(0, 20));
      choose(
        r,
        r.alternatives.find((a) => a.validation?.valid)?.strategy ??
          r.alternatives[0].strategy,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function validate(save = false) {
    if (!run) return;
    setBusy(
      save
        ? "Checking again and saving your roster…"
        : "Checking every rule…",
    );
    setError("");
    try {
      const result = await request({
        action: save ? "save" : "validate",
        id: run.id,
        strategy,
        shifts,
      });
      if (save) {
        setSaved(true);
        setDirty(false);
        reload();
        notify("Roster saved for this week");
      } else setReport(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function change(next: Shift[]) {
    setShifts(next);
    setDirty(true);
    setReport(null);
    setSaved(false);
  }
  const usable =
    !!selected &&
    ["FEASIBLE", "OPTIMAL"].includes(selected.status) &&
    !!selected.validation?.valid;
  return (
    <section className="panel planner" aria-label="Generate my week">
      <div className="planner-heading">
        <div>
          <h2>
            <Sparkles size={17} style={{ verticalAlign: -3, color: "var(--accent)" }} /> Generate my week
          </h2>
          <p>
            {weekLabel(week)} · uses this week’s labour targets and your team’s verified skills and availability.
          </p>
        </div>
        {onClose && (
          <button
            className="btn"
            disabled={!!busy}
            onClick={() => {
              if (!dirty || confirm("Discard unsaved preview edits?")) onClose();
            }}
          >
            Close
          </button>
        )}
      </div>
      <div className="planner-controls">
        <label>
          How long to search
          <select
            value={seconds}
            disabled={!!busy}
            onChange={(e) => setSeconds(Number(e.target.value))}
          >
            <option value={4}>Quick · about 15 s</option>
            <option value={8}>Standard · about 30 s</option>
            <option value={15}>Thorough · about 45 s</option>
          </select>
        </label>
        <button
          className="btn primary"
          disabled={!!busy || dirty}
          onClick={generate}
          aria-busy={!!busy}
        >
          {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
          Generate 3 options
        </button>
        {runs.filter((r) => r.week === week).length > 0 && (
          <label>
            Earlier results
            <select
              disabled={!!busy}
              value={run?.id ?? ""}
              onChange={(e) => {
                const r = runs.find((r) => r.id === e.target.value);
                if (r)
                  choose(
                    r,
                    r.alternatives.find((a) => a.validation?.valid)?.strategy ??
                      r.alternatives[0].strategy,
                  );
              }}
            >
              <option value="">Choose an earlier run</option>
              {runs
                .filter((r) => r.week === week)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {relativeTime(r.createdAt)} · roster v{r.revision}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <div className="engine-strip">
        <span><Cpu size={12} /> Constraint optimiser (OR-Tools CP-SAT)</span>
        <span><ShieldCheck size={12} /> Independent rule validator</span>
        <span>Max 5 working days per person, 6 in a row</span>
      </div>
      {!run && !busy && (
        <div className="empty-state" style={{ border: "1px dashed var(--line-2)", borderRadius: 12 }}>
          <div className="empty-icon">
            <Sparkles size={20} />
          </div>
          <h3>No options generated for this week yet</h3>
          <p>Generate three complete rosters and compare them. Your current roster stays as it is until you save one.</p>
        </div>
      )}
      {busy && (
        <Callout tone="accent" icon={<LoaderCircle size={16} className="spin" />}>
          <span role="status">{busy}</span>
        </Callout>
      )}
      <ErrorBox error={error} />
      {run && (
        <>
          <div className="alternative-grid">
            {run.alternatives.map((a) => {
              const st = statusText(a),
                m = a.metrics,
                bestCov = bestOf(run, (x) => x.metrics?.target_coverage_percent, true),
                bestDev = bestOf(run, (x) => (x.metrics ? Math.abs(x.metrics.budget_deviation_hours) : null), false),
                bestGap = bestOf(run, (x) => x.metrics?.uncovered_person_hours, false),
                bestFair = bestOf(run, (x) => x.metrics?.fairness_score, true),
                bestStable = bestOf(run, (x) => x.metrics?.baseline_assignment_changes, false);
              return (
                <button
                  disabled={!!busy}
                  key={a.strategy}
                  aria-pressed={strategy === a.strategy}
                  className={`alternative-card ${strategy === a.strategy ? "selected" : ""}`}
                  onClick={() => choose(run, a.strategy)}
                >
                  <div className="alt-head">
                    <h3>{strategyName(a.strategy)}</h3>
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                  </div>
                  <p className="alt-why">{STRATEGY[a.strategy]?.why}</p>
                  {m && a.validation?.valid ? (
                    <div className="alt-metrics">
                      <div>
                        <span>Staffing target covered</span>
                        <b className={m.target_coverage_percent === bestCov ? "best" : ""}>
                          {m.target_coverage_percent?.toFixed(1) ?? "–"}%
                        </b>
                      </div>
                      <div>
                        <span>Paid hours</span>
                        <b>{m.total_paid_hours}h</b>
                      </div>
                      <div>
                        <span>vs labour target</span>
                        <b className={Math.abs(m.budget_deviation_hours) === bestDev ? "best" : ""}>
                          {m.budget_deviation_hours > 0 ? "+" : ""}
                          {m.budget_deviation_hours}h
                        </b>
                      </div>
                      <div>
                        <span>Understaffed person-hours</span>
                        <b className={m.uncovered_person_hours === bestGap ? "best" : ""}>{m.uncovered_person_hours}h</b>
                      </div>
                      <div>
                        <span title="Descriptive 0–100 score of how evenly preferred hours are met. Not a measure of satisfaction.">Hour fairness</span>
                        <b className={m.fairness_score === bestFair ? "best" : ""}>{m.fairness_score.toFixed(0)}/100</b>
                      </div>
                      <div>
                        <span>Shifts changed vs saved roster</span>
                        <b className={m.baseline_assignment_changes === bestStable ? "best" : ""}>{m.baseline_assignment_changes}</b>
                      </div>
                    </div>
                  ) : (
                    <span className="form-hint">No roster passing every rule was found in this search.</span>
                  )}
                </button>
              );
            })}
          </div>
          {run.alternatives.filter((a) => a.validation?.valid).length > 1 &&
            new Set(
              run.alternatives
                .filter((a) => a.validation?.valid)
                .map((a) => JSON.stringify([...a.assignments].map((x) => [x.employee_id, x.day, x.start, x.end]).sort())),
            ).size === 1 && (
              <Callout tone="neutral" title="All three priorities found the same roster">
                With this team’s availability and rules there was little room to trade coverage against cost. A
                longer search may find differences.
              </Callout>
            )}
          {selected && (
            <>
              {selected.metrics && selected.validation?.valid && (
                <Callout tone="positive" title={`${strategyName(selected.strategy)}: what this roster does`}>
                  Covers {selected.metrics.target_coverage_percent?.toFixed(0) ?? "–"}% of your half-hourly staffing
                  targets using {selected.metrics.total_paid_hours} paid hours (
                  {selected.metrics.budget_deviation_hours > 0 ? "+" : ""}
                  {selected.metrics.budget_deviation_hours}h against the labour target). Every availability, skill,
                  supervision, rest and working-hours rule passes.{" "}
                  {selected.status === "OPTIMAL"
                    ? "No better roster exists for this priority under these rules."
                    : "The search stopped at its time limit, so a slightly better roster may exist."}
                  {dirty && " You’ve edited it since, so check it again before saving."}
                </Callout>
              )}
              {selected.metrics && (
                <details>
                  <summary>
                    Generated interval skill and demand coverage
                  </summary>
                  <div className="table-scroll">
                    <table className="team-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>People / target</th>
                          <th>Required skills · qualified / needed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.metrics.coverage.map((c, i) => (
                          <tr key={i}>
                            <td>
                              {shortDate(c.day)} {time(c.minute)}
                            </td>
                            <td>
                              {c.actual} / {c.target}
                            </td>
                            <td>
                              {c.skills
                                .map(
                                  (s) =>
                                    `${workspace.restaurant.skillRules.catalog.find((k) => k.id === s.skill_id)?.name ?? s.skill_id}: ${s.actual}/${s.required}`,
                                )
                                .join(" · ") || "No interval skill minimum"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              {selected.warnings.length > 0 && (
                <details>
                  <summary>
                    Optimiser notes ({selected.warnings.length})
                  </summary>
                  {selected.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </details>
              )}
              {!usable &&
                selected.diagnostics.map((d, i) => (
                  <p key={i} className="error-box">
                    {d.day ? `${shortDate(d.day)}: ` : ""}
                    {d.message}
                  </p>
                ))}
              {usable && (
                <>
                  <div className="planner-heading">
                    <div>
                      <h3>
                        {saved
                          ? "Saved as this week’s roster"
                          : dirty
                            ? "Your edited version"
                            : "Suggested roster"}
                      </h3>
                      <p>
                        {shifts.length} shifts ·{" "}
                        {shifts.reduce((n, s) => n + paidHours(s), 0)} paid
                        hours ·{" "}
                        {stale && !saved
                          ? "The roster changed since this was generated. Generate again."
                          : "Not saved until you choose Save."}
                      </p>
                    </div>
                    <div className="flex-row">
                      <button
                        className="btn"
                        disabled={!!busy || saved}
                        onClick={() =>
                          setEditing({
                            id: crypto.randomUUID(),
                            employeeId: workspace.employees[0].id,
                            date: week,
                            start: 600,
                            end: 960,
                            kind: "Opening",
                            breakStart: 780,
                            breakMinutes: 30,
                          })
                        }
                      >
                        <Plus size={14} /> Add shift
                      </button>
                      <button
                        className="btn"
                        disabled={!!busy || stale}
                        onClick={() => validate()}
                      >
                        <ShieldCheck size={14} /> Check rules
                      </button>
                      <button
                        className="btn primary"
                        disabled={
                          !!busy ||
                          stale ||
                          !report?.valid ||
                          saved ||
                          !!editing
                        }
                        onClick={() => validate(true)}
                      >
                        <Save size={14} /> Save as roster
                      </button>
                      <button
                        className="btn"
                        disabled={
                          !!editing || !report?.valid || (stale && !saved)
                        }
                        onClick={() =>
                          exportRoster(
                            {
                              ...workspace,
                              weeks: [
                                ...workspace.weeks.filter(
                                  (w) => w.start !== week,
                                ),
                                {
                                  ...getWeek(workspace, week),
                                  shifts,
                                  provenance: {
                                    runId: run.id,
                                    strategy,
                                    savedAt: run.createdAt,
                                    edited:
                                      JSON.stringify(shifts) !==
                                      JSON.stringify(
                                        toShifts(selected.assignments),
                                      ),
                                    snapshotId: "preview",
                                  },
                                },
                              ],
                            },
                            week,
                          )
                        }
                      >
                        <Download size={14} /> CSV
                      </button>
                    </div>
                  </div>
                  {report ? (
                    <div
                      className={report.valid ? "info-box" : "error-box"}
                      role="status"
                    >
                      {stale && !saved
                        ? "This check was made before the roster changed. Generate again before saving or exporting."
                        : report.valid
                          ? `Every rule passes.${report.supervision_pairings.length ? ` Trainees have a supervisor in all ${report.supervision_pairings.length} half-hours they work.` : ""}`
                          : `${report.issues.length} rule${report.issues.length === 1 ? "" : "s"} broken. Fix and check again.`}
                      {report.issues.slice(0, 30).map((i, n) => (
                        <p key={n}>
                          {i.day ? `${shortDate(i.day)}: ` : ""}
                          {i.message}
                        </p>
                      ))}
                      {report.issues.length > 30 && (
                        <p>
                          Showing the first 30. Fix these and check again.
                        </p>
                      )}
                    </div>
                  ) : (
                    <Callout tone="caution">
                      You’ve changed the suggestion. Check the rules again before saving.
                    </Callout>
                  )}
                  {editing && (
                    <form
                      className="editor-form preview-editor"
                      onSubmit={(e) => {
                        e.preventDefault();
                        change([
                          ...shifts.filter((s) => s.id !== editing.id),
                          editing,
                        ]);
                        setEditing(null);
                      }}
                    >
                      <h3>Edit shift in suggestion</h3>
                      <div className="planner-controls">
                        <label>
                          Employee
                          <select
                            value={editing.employeeId}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                employeeId: e.target.value,
                              })
                            }
                          >
                            {workspace.employees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Day
                          <select
                            value={editing.date}
                            onChange={(e) =>
                              setEditing({ ...editing, date: e.target.value })
                            }
                          >
                            {DAYS.map((d, i) => (
                              <option key={d} value={dateAt(week, i)}>
                                {d}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Type
                          <select
                            value={editing.kind}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                kind: e.target.value as Shift["kind"],
                              })
                            }
                          >
                            {["Opening", "Midday", "Closing"].map((k) => (
                              <option key={k}>{k}</option>
                            ))}
                          </select>
                        </label>
                        {(["start", "end"] as const).map((k) => (
                          <label key={k}>
                            {k}
                            <input
                              required
                              type="time"
                              step="1800"
                              value={time(editing[k])}
                              onChange={(e) => {
                                const [h, m] = e.target.value
                                  .split(":")
                                  .map(Number);
                                setEditing({ ...editing, [k]: h * 60 + m });
                              }}
                            />
                          </label>
                        ))}
                        <label>
                          Break minutes
                          <select
                            value={editing.breakMinutes}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                breakMinutes: Number(e.target.value),
                                breakStart: Number(e.target.value)
                                  ? (editing.breakStart ?? editing.start + 180)
                                  : null,
                              })
                            }
                          >
                            <option value={0}>0</option>
                            <option value={30}>30</option>
                            <option value={60}>60</option>
                          </select>
                        </label>
                        {editing.breakMinutes > 0 && (
                          <label>
                            Break starts
                            <input
                              type="time"
                              required
                              step="1800"
                              value={time(editing.breakStart ?? editing.start)}
                              onChange={(e) => {
                                const [h, m] = e.target.value
                                  .split(":")
                                  .map(Number);
                                setEditing({
                                  ...editing,
                                  breakStart: h * 60 + m,
                                });
                              }}
                            />
                          </label>
                        )}
                      </div>
                      <div className="flex-row">
                        <button className="btn primary">
                          Apply
                        </button>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setEditing(null)}
                        >
                          Cancel edit
                        </button>
                      </div>
                    </form>
                  )}
                  <div className="table-scroll">
                    <table className="team-table">
                      <thead>
                        <tr>
                          <th>Person</th>
                          <th>Day</th>
                          <th>Shift</th>
                          <th>Break</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {[...shifts]
                          .sort(
                            (a, b) =>
                              a.date.localeCompare(b.date) || a.start - b.start,
                          )
                          .map((s) => {
                            const e = workspace.employees.find(
                              (e) => e.id === s.employeeId,
                            );
                            return (
                              <tr key={s.id}>
                                <td>
                                  {e?.name}
                                  {e && <SkillBadges employee={e} compact />}
                                </td>
                                <td>{shortDate(s.date)}</td>
                                <td>
                                  {time(s.start)}–{time(s.end)} · {s.kind}
                                </td>
                                <td>
                                  {s.breakMinutes
                                    ? `${time(s.breakStart!)} · ${s.breakMinutes}m`
                                    : "None"}
                                </td>
                                <td>
                                  <button
                                    className="btn small"
                                    disabled={!!busy || saved}
                                    onClick={() => setEditing(s)}
                                  >
                                    Edit
                                  </button>{" "}
                                  <button
                                    className="btn small ghost"
                                    disabled={!!busy || saved}
                                    onClick={() =>
                                      change(
                                        shifts.filter((x) => x.id !== s.id),
                                      )
                                    }
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  {report?.valid && (
                    <details>
                      <summary>Who supervises whom</summary>
                      {report.supervision_pairings.map((p, i) => (
                        <p key={i}>
                          {shortDate(p.day)} {time(p.minute)} ·{" "}
                          {
                            workspace.employees.find(
                              (e) => e.id === p.trainee_id,
                            )?.name
                          }{" "}
                          with{" "}
                          {
                            workspace.employees.find(
                              (e) => e.id === p.supervisor_id,
                            )?.name
                          }
                        </p>
                      ))}
                    </details>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
