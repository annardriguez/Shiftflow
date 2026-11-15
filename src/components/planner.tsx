"use client";
import { workspaceFetch } from "@/lib/workspace-fetch";
import { useEffect, useState } from "react";
import { useApp } from "./provider";
import { Badge, ErrorBox } from "./ui";
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
export function Planner({ onClose }: { onClose: () => void }) {
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
    setBusy("Generating three alternatives… This can take up to 45 seconds.");
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
        ? "Revalidating and saving the complete draft…"
        : "Checking all mandatory rules…",
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
        notify("Weekly draft saved locally. Strobbo is not connected.");
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
    <section className="panel planner" aria-label="Weekly roster planner">
      <div className="planner-heading">
        <div>
          <div className="eyebrow">SMART SCHEDULING · FICTIONAL DATA</div>
          <h2>Find your week’s best fit.</h2>
          <p>
            {weekLabel(week)} · Suggestions stay separate until you save a
            draft.
          </p>
        </div>
        <button
          className="btn"
          disabled={!!busy}
          onClick={() => {
            if (!dirty || confirm("Discard unsaved preview edits?")) onClose();
          }}
        >
          Close planner
        </button>
      </div>
      <div className="planner-controls">
        <label>
          Search time per strategy{" "}
          <select
            value={seconds}
            disabled={!!busy}
            onChange={(e) => setSeconds(Number(e.target.value))}
          >
            <option value={4}>4 seconds · quick</option>
            <option value={8}>8 seconds · standard</option>
            <option value={15}>15 seconds · extended</option>
          </select>
        </label>
        <button
          className="btn primary"
          disabled={!!busy || dirty}
          onClick={generate}
        >
          Generate 3 alternatives
        </button>
        <label>
          Recent comparisons
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
            <option value="">Choose a saved run</option>
            {runs
              .filter((r) => r.week === week)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.createdAt).toLocaleString()} · revision{" "}
                  {r.revision}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="form-hint">
        Uses this week’s saved labour targets and manager-verified skills.
        Availability, breaks, rest, hours and supervision are mandatory. Demo
        policy: at most 5 days/week, 6 consecutive days; no minimum weekly
        entitlement. Target coverage and hour preferences are ranking goals.
        Search is bounded; alternatives may be identical.
      </p>
      {busy && (
        <p role="status" className="info-box">
          {busy}
        </p>
      )}
      <ErrorBox error={error} />
      {run && (
        <>
          <div className="alternative-grid">
            {run.alternatives.map((a) => (
              <button
                disabled={!!busy}
                key={a.strategy}
                aria-pressed={strategy === a.strategy}
                className={`alternative-card ${strategy === a.strategy ? "selected" : ""}`}
                onClick={() => choose(run, a.strategy)}
              >
                <h3>{a.strategy.replaceAll("-", " ")}</h3>
                <Badge tone={a.validation?.valid ? "sage" : "peach"}>
                  {a.status}
                </Badge>
                {a.metrics ? (
                  <>
                    <strong>
                      {a.metrics.total_paid_hours}h <small>paid</small>
                    </strong>
                    <span>
                      {a.metrics.target_coverage_percent?.toFixed(1) ?? "—"}%
                      target coverage
                    </span>
                    <span>
                      {a.metrics.budget_deviation_hours}h vs total labour target
                    </span>
                    <span>
                      {a.metrics.uncovered_person_hours} person-hours below
                      demand
                    </span>
                    <span>
                      Fairness score {a.metrics.fairness_score.toFixed(2)}
                    </span>
                    <span>
                      {a.metrics.baseline_assignment_changes} assignment changes
                      vs saved roster
                    </span>
                  </>
                ) : (
                  <span>No usable roster found within this search.</span>
                )}
              </button>
            ))}
          </div>
          {selected && (
            <>
              <div className="info-box">
                {selected.status === "OPTIMAL"
                  ? "Optimal for this finite candidate model."
                  : "A bounded search result; global optimality is not established."}{" "}
                Solver phase: {selected.solver_status}.{" "}
                {selected.metadata.used_feasibility_incumbent &&
                  "Uses a validated feasibility incumbent."}{" "}
                Generated metrics above describe the original suggestion at
                workspace revision {run.revision}.{" "}
                {dirty &&
                  "Your preview has edits; validate again before saving."}
              </div>
              {selected.metrics && (
                <details>
                  <summary>
                    Generated interval skill and demand coverage
                  </summary>
                  <div className="table-scroll">
                    <table className="team-table">
                      <thead>
                        <tr>
                          <th>TIME</th>
                          <th>PEOPLE / TARGET</th>
                          <th>REQUIRED SKILLS · QUALIFIED / REQUIRED</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.metrics.coverage.map((c, i) => (
                          <tr key={i}>
                            <td>
                              {c.day} {time(c.minute)}
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
                    Search warnings ({selected.warnings.length})
                  </summary>
                  {selected.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </details>
              )}
              {!usable &&
                selected.diagnostics.map((d, i) => (
                  <p key={i} className="error-box">
                    {d.day} {d.message}
                  </p>
                ))}
              {usable && (
                <>
                  <div className="planner-heading">
                    <div>
                      <h3>
                        {saved
                          ? "Draft saved locally"
                          : dirty
                            ? "Edited preview"
                            : "Suggested roster"}
                      </h3>
                      <p>
                        {shifts.length} shifts ·{" "}
                        {shifts.reduce((n, s) => n + paidHours(s), 0)} paid
                        hours ·{" "}
                        {stale && !saved
                          ? "Workspace has changed. Generate again."
                          : "Not synchronized to Strobbo."}
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
                        Add shift
                      </button>
                      <button
                        className="btn"
                        disabled={!!busy || stale}
                        onClick={() => validate()}
                      >
                        Validate preview
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
                        Save weekly draft
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
                        Export preview CSV
                      </button>
                    </div>
                  </div>
                  {report ? (
                    <div
                      className={report.valid ? "info-box" : "error-box"}
                      role="status"
                    >
                      {stale && !saved
                        ? "This report applies to the original snapshot. The workspace changed; generate again before saving or exporting."
                        : report.valid
                          ? `All mandatory checks passed. ${report.supervision_pairings.length} interval supervision pairings verified.`
                          : `${report.issues.length} mandatory checks failed.`}
                      {report.issues.slice(0, 30).map((i, n) => (
                        <p key={n}>
                          {i.day} {i.message}
                        </p>
                      ))}
                      {report.issues.length > 30 && (
                        <p>
                          Showing the first 30 issues. Repair and validate
                          again.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="info-box">
                      Preview changed. Validate the complete roster to check
                      skills, trainee supervision and working-time rules.
                    </p>
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
                      <h3>Edit preview shift</h3>
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
                          Apply to preview
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
                          <th>EMPLOYEE / SKILLS</th>
                          <th>DATE</th>
                          <th>SHIFT</th>
                          <th>BREAK</th>
                          <th>ACTIONS</th>
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
                                <td>{s.date}</td>
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
                                    className="btn"
                                    disabled={!!busy || saved}
                                    onClick={() => setEditing(s)}
                                  >
                                    Edit
                                  </button>{" "}
                                  <button
                                    className="btn"
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
                      <summary>Verified supervision pairings</summary>
                      {report.supervision_pairings.map((p, i) => (
                        <p key={i}>
                          {p.day} {time(p.minute)} ·{" "}
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
