"use client";
import { workspaceFetch } from "@/lib/workspace-fetch";
import { useEffect, useState } from "react";
import {
  Check,
  ShieldCheck,
  UserRoundSearch,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trash2,
} from "lucide-react";
import { useApp } from "./provider";
import { Avatar, Badge, ErrorBox, Modal } from "./ui";
import type { Employee, Shift, SkillRules, SkillDefinition } from "@/lib/types";
import {
  qualified,
  skillDiagnostics,
  skillName,
  type CoverAssessment,
} from "@/lib/skills";
import { DAYS, time } from "@/lib/schedule";

export function SkillBadges({
  employee,
  compact = false,
  catalog,
}: {
  employee: Employee;
  compact?: boolean;
  catalog?: SkillDefinition[];
}) {
  const { data } = useApp();
  const definitions = catalog ?? data?.restaurant.skillRules.catalog;
  if (!definitions) return null;
  const name = (id: string) => definitions.find((k) => k.id === id)?.name ?? id;
  if (!employee.skillsReviewedAt)
    return (
      <span className="skill-badges">
        <Badge tone="peach">Skills need review</Badge>
      </span>
    );
  const names: Record<string, string> = {
    open: "Opener",
    close: "Closer",
    train: employee.supervisionSkillId ? "Training qualified" : "Supervisor",
    service: "Service",
  };
  return (
    <span className={`skill-badges ${compact ? "compact-skills" : ""}`}>
      {employee.competencies
        .filter(
          (q) =>
            qualified(employee, q.skillId) &&
            (!compact || q.skillId !== "service"),
        )
        .map((q) => (
          <span
            key={q.skillId}
            className={`skill-tag ${q.skillId === "close" ? "skill-closer" : ""}`}
            title={`${name(q.skillId)} · Verified by ${q.verifiedBy} on ${q.verifiedAt}`}
          >
            <ShieldCheck size={10} />
            {names[q.skillId] ?? name(q.skillId)}
          </span>
        ))}
      {employee.supervisionSkillId && (
        <span
          className="skill-tag trainee"
          title={`Requires ${name(employee.supervisionSkillId)} supervision`}
        >
          Needs supervision
        </span>
      )}
      {!employee.competencies.length && !employee.supervisionSkillId && (
        <span className="skill-tag trainee">No verified skills</span>
      )}
    </span>
  );
}
export function SkillProfileDialog({
  employee,
  onClose,
}: {
  employee: Employee;
  onClose: () => void;
}) {
  const { data, mutate, saving } = useApp(),
    [ids, setIds] = useState(employee.competencies.map((q) => q.skillId)),
    [supervision, setSupervision] = useState(employee.supervisionSkillId ?? ""),
    [error, setError] = useState("");
  if (!data) return null;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutate({
        type: "competencies",
        employeeId: employee.id,
        skillIds: ids,
        supervisionSkillId: supervision || null,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title="Skills you can count on"
      description={`${employee.name} · Task-specific manager review`}
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={save}>
        <ErrorBox error={error} />
        <div className="info-box">
          Local demo manager only. These objective qualifications are not
          ratings. Real manager authorization is required before a pilot.
        </div>
        <fieldset className="skill-checklist">
          <legend>Confirm verified competencies</legend>
          {data.restaurant.skillRules.catalog.map((k) => (
            <label className="checkbox-label" key={k.id}>
              <input
                type="checkbox"
                checked={ids.includes(k.id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, k.id]
                      : ids.filter((id) => id !== k.id),
                  )
                }
              />
              {k.name}
            </label>
          ))}
        </fieldset>
        <label>
          Supervision requirement
          <select
            value={supervision}
            onChange={(e) => setSupervision(e.target.value)}
          >
            <option value="">Independent · no supervision required</option>
            {data.restaurant.skillRules.catalog.map((k) => (
              <option value={k.id} key={k.id}>
                Needs a colleague qualified in: {k.name}
              </option>
            ))}
          </select>
        </label>
        <p className="form-hint">
          Supervisors must be independent and on duty. Breaks interrupt
          coverage. Revoking a skill is always recorded; any resulting roster
          gaps stay visible.
        </p>
        {employee.skillsReviewedAt && (
          <p className="form-hint">
            Last reviewed:{" "}
            {new Date(employee.skillsReviewedAt).toLocaleString("en-GB", {
              timeZone: "Europe/Amsterdam",
            })}{" "}
            · Amsterdam time
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            <Check size={15} />
            {saving ? "Saving…" : "Verify and save skills"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function SkillCoverage({ shift }: { shift: Shift }) {
  const { data } = useApp(),
    [expanded, setExpanded] = useState(false);
  if (!data) return null;
  const all = data.weeks
    .flatMap((w) => w.shifts)
    .filter((s) => s.id !== shift.id)
    .concat(shift);
  const d = skillDiagnostics(data, all, [shift.date]);
  const issues = d.issues.filter((i) =>
    i.code === "qualification" || i.code === "unreviewed"
      ? all.some(
          (s) =>
            s.employeeId === i.employeeId &&
            s.date === shift.date &&
            s.start < shift.end &&
            s.end > shift.start,
        )
      : i.minute < shift.end && i.minute + 30 > shift.start,
  );
  const employee = data.employees.find((e) => e.id === shift.employeeId);
  const names = (id: string) =>
    data.employees.find((e) => e.id === id)?.name ?? id;
  const pairings = d.pairings.filter(
    (p) => p.minute >= shift.start && p.minute < shift.end,
  );
  return (
    <div className="skill-coverage">
      <div className="skill-coverage-heading">
        <ShieldCheck size={17} />
        <strong>Team skills during this shift</strong>
        <Badge tone={issues.length ? "peach" : "sage"}>
          {issues.length
            ? `${issues.length} checks need attention`
            : "Configured skill checks met"}
        </Badge>
      </div>
      {employee && <SkillBadges employee={employee} />}
      <p>
        Includes the proposed worker, overlapping colleagues, unpaid breaks, and
        shared supervision capacity.
      </p>
      {issues.length ? (
        <>
          <div className="skill-warning">
            <AlertTriangle size={15} />
            <span>{issues[0].message}</span>
          </div>
          {issues.length > 1 && (
            <button
              type="button"
              className="text-link"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Hide details" : `See all ${issues.length} findings`}
            </button>
          )}
          {expanded && (
            <ul className="skill-issue-list">
              {issues.slice(1).map((i) => (
                <li key={i.key}>{i.message}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="skill-clear">
          All configured skill and supervision checks pass within this window.
        </p>
      )}
      <details className="supervision-details">
        <summary>Qualified coverage by interval</summary>
        {d.coverage.filter(
          (r) => r.minute < shift.end && r.minute + 30 > shift.start,
        ).length ? (
          <table className="skill-interval-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Required task</th>
                <th>Qualified / minimum</th>
              </tr>
            </thead>
            <tbody>
              {d.coverage
                .filter(
                  (r) => r.minute < shift.end && r.minute + 30 > shift.start,
                )
                .map((r) => (
                  <tr key={`${r.minute}-${r.skillId}`}>
                    <td>{time(r.minute)}</td>
                    <td>{skillName(data.restaurant.skillRules, r.skillId)}</td>
                    <td className={r.actual < r.required ? "orange-text" : ""}>
                      {r.actual} / {r.required}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <p>
            No interval skill requirements apply in this window. Personal duty
            and supervision checks still apply.
          </p>
        )}
      </details>
      {pairings.length > 0 && (
        <details className="supervision-details">
          <summary>Supervision pairings by interval</summary>
          <ul className="skill-issue-list">
            {pairings.map((p) => (
              <li key={`${p.minute}-${p.traineeId}`}>
                {time(p.minute)}–{time(p.minute + 30)} · {names(p.traineeId)}{" "}
                with {names(p.supervisorId)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
export function CoverDialog({
  shift,
  onClose,
}: {
  shift: Shift;
  onClose: () => void;
}) {
  const { data, week, reload } = useApp(),
    [assessment, setAssessment] = useState<CoverAssessment | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0),
    [showBlocked, setShowBlocked] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setAssessment(null);
    setError("");
    fetch(
      `/api/shift-cover?week=${encodeURIComponent(week)}&shiftId=${encodeURIComponent(shift.id)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        if (active) setAssessment(body);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [week, shift.id, data?.revision, retry]);
  if (!data) return null;
  const stale = assessment && assessment.revision !== data.revision;
  const candidates = stale ? [] : (assessment?.candidates ?? []),
    eligible = candidates.filter((c) => c.eligible),
    blocked = candidates.filter((c) => !c.eligible),
    savedShift =
      data.weeks
        .find((w) => w.start === week)
        ?.shifts.find((s) => s.id === shift.id) ?? shift,
    source = data.employees.find((e) => e.id === savedShift.employeeId);
  return (
    <Modal
      title="Find Shift Cover"
      description={`${source?.name} · ${savedShift.date} · ${time(savedShift.start)}–${time(savedShift.end)}`}
      onClose={onClose}
    >
      <div className="help-content cover-content">
        <div className="cover-preview-note">
          <UserRoundSearch size={18} />
          <span>
            <strong>Eligibility preview · no change is applied</strong>
            <small>
              Checks the saved shift. Employee offers and manager approval are
              planned for milestone 4. Strobbo is not connected.
            </small>
          </span>
        </div>
        <ErrorBox error={error} />
        {loading ? (
          <p role="status">Checking all configured mandatory rules…</p>
        ) : error ? (
          <button className="btn" onClick={() => setRetry((v) => v + 1)}>
            <RefreshCw size={14} />
            Retry checks
          </button>
        ) : (
          <>
            <button
              className="text-link"
              onClick={() => {
                reload();
                setRetry((v) => v + 1);
              }}
            >
              <RefreshCw size={13} />
              Refresh eligibility checks
            </button>
            <div className="cover-section-heading">
              <h3>{eligible.length} eligible for configured rules</h3>
              <Badge tone="neutral">
                Roster revision {assessment?.revision}
              </Badge>
            </div>
            <p className="form-hint">
              Hard checks: availability, overlaps, duties, team skills,
              supervision, rest, and individual hour limits. Eligible people are
              ranked by closeness to preferred weekly hours.
            </p>
            {stale && (
              <ErrorBox error="The workspace changed. Refresh checks before using any result." />
            )}
            {eligible.length === 0 && (
              <div className="cover-no-match">
                <AlertTriangle size={19} />
                <p>
                  No eligible cover found. Review the reasons below; preferences
                  never override mandatory rules.
                </p>
              </div>
            )}
            {eligible.map((c) => {
              const e = data.employees.find((e) => e.id === c.employeeId)!;
              return (
                <article className="cover-candidate" key={c.employeeId}>
                  <div className="person-cell">
                    <Avatar employee={e} />
                    <div>
                      <strong>{e.name}</strong>
                      <SkillBadges employee={e} compact />
                    </div>
                    <Badge>Eligible</Badge>
                  </div>
                  <p>
                    {c.scheduledHours}h scheduled → {c.proposedHours}h with this
                    shift · {c.preferredHours}h preferred
                  </p>
                  <span className="skill-clear">
                    All affected configured mandatory checks passed.
                  </span>
                </article>
              );
            })}
            <button
              className="blocked-toggle"
              onClick={() => setShowBlocked(!showBlocked)}
              aria-expanded={showBlocked}
            >
              {showBlocked ? "Hide" : "Show"} {blocked.length} ineligible
              candidates <AlertTriangle size={14} />
            </button>
            {showBlocked &&
              blocked.map((c) => {
                const e = data.employees.find((e) => e.id === c.employeeId)!;
                return (
                  <article
                    className="cover-candidate blocked"
                    key={c.employeeId}
                  >
                    <div className="person-cell">
                      <Avatar employee={e} small />
                      <strong>{e.name}</strong>
                      <Badge tone="peach">Ineligible</Badge>
                    </div>
                    <p>
                      {c.scheduledHours}h scheduled · {c.preferredHours}h
                      preferred
                    </p>
                    <details>
                      <summary>
                        {c.reasons[0]}
                        {c.reasons.length > 1
                          ? ` (+${c.reasons.length - 1} more)`
                          : ""}
                      </summary>
                      <ul className="skill-issue-list">
                        {c.reasons.slice(1).map((reason, i) => (
                          <li key={i}>{reason}</li>
                        ))}
                      </ul>
                    </details>
                  </article>
                );
              })}
            <p className="form-hint">
              Assessment uses current saved data. A future approval must
              revalidate fresh schedule, qualifications and rules atomically.
              This preview is not approval or legal compliance certification.
            </p>
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close preview
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function SkillRulesPanel() {
  const { data } = useApp(),
    [editing, setEditing] = useState(false);
  if (!data) return null;
  const rules = data.restaurant.skillRules;
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>The skills every good shift needs</h2>
          <p>Restaurant-level mandatory coverage and supervision rules.</p>
        </div>
        <button className="btn small" onClick={() => setEditing(true)}>
          Edit skill rules
        </button>
      </div>
      <div className="skill-rules-summary">
        <div className="skill-badges">
          {rules.catalog.map((k) => (
            <span className="skill-tag" key={k.id}>
              {k.name}
            </span>
          ))}
        </div>
        <p>
          One independent qualified supervisor per {rules.supervisionCapacity}{" "}
          concurrent trainees. Capacity is shared across supervision tasks.
        </p>
        {rules.requirements.map((r) => (
          <p key={r.id}>
            <strong>{skillName(rules, r.skillId)}</strong> · {time(r.start)}–
            {time(r.end)} · {r.minimum} qualified ·{" "}
            {r.days.map((d) => DAYS[d]).join(", ")}
          </p>
        ))}
        <p className="form-hint">
          A worker may cover multiple skills while supervising. Confirm this
          policy with the manager; separate simultaneous-duty allocation is not
          implemented.
        </p>
      </div>
      {editing && <SkillRulesDialog onClose={() => setEditing(false)} />}
    </section>
  );
}
function SkillRulesDialog({ onClose }: { onClose: () => void }) {
  const { data, mutate, saving } = useApp(),
    [rules, setRules] = useState<SkillRules>(() =>
      structuredClone(data!.restaurant.skillRules),
    ),
    [error, setError] = useState(""),
    [name, setName] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutate({ type: "skill-rules", rules });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function setMinute(index: number, key: "start" | "end", text: string) {
    const [h, m] = text.split(":").map(Number);
    setRules({
      ...rules,
      requirements: rules.requirements.map((r, i) =>
        i === index ? { ...r, [key]: h * 60 + m } : r,
      ),
    });
  }
  return (
    <Modal
      title="Skills, with clear ground rules"
      description="Local demo manager · Changes are audited and may reveal draft gaps."
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={save}>
        <ErrorBox error={error} />
        <label>
          Maximum concurrent trainees per independent supervisor
          <input
            type="number"
            min={1}
            max={10}
            required
            value={rules.supervisionCapacity}
            onChange={(e) =>
              setRules({
                ...rules,
                supervisionCapacity: Number(e.target.value),
              })
            }
          />
        </label>
        <h3>Task-specific competency catalog</h3>
        <div className="skill-catalog-editor">
          {rules.catalog.map((k) => (
            <label key={k.id}>
              <span>{k.id}</span>
              <input
                aria-label={`Name for ${k.id}`}
                value={k.name}
                maxLength={80}
                minLength={2}
                required
                onChange={(e) =>
                  setRules({
                    ...rules,
                    catalog: rules.catalog.map((s) =>
                      s.id === k.id ? { ...s, name: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
          ))}
        </div>
        <div className="form-row">
          <input
            placeholder="e.g. Food safety lead"
            aria-label="New skill name"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn"
            type="button"
            disabled={name.trim().length < 2 || rules.catalog.length >= 40}
            onClick={() => {
              setRules({
                ...rules,
                catalog: [
                  ...rules.catalog,
                  { id: crypto.randomUUID(), name: name.trim() },
                ],
              });
              setName("");
            }}
          >
            <Plus size={14} />
            Add skill
          </button>
        </div>
        <h3 className="rule-subtitle">Mandatory interval coverage</h3>
        <p className="form-hint">
          Overlapping rules for the same skill use the highest minimum, rather
          than adding the counts.
        </p>
        {rules.requirements.map((r, i) => (
          <div className="requirement-editor" key={r.id}>
            <div className="requirement-title">
              <label>
                Required skill
                <select
                  value={r.skillId}
                  onChange={(e) =>
                    setRules({
                      ...rules,
                      requirements: rules.requirements.map((v, j) =>
                        j === i ? { ...v, skillId: e.target.value } : v,
                      ),
                    })
                  }
                >
                  {rules.catalog.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove requirement ${i + 1}`}
                onClick={() =>
                  setRules({
                    ...rules,
                    requirements: rules.requirements.filter((_, j) => j !== i),
                  })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="requirement-window">
              <label>
                From
                <input
                  type="time"
                  step="1800"
                  required
                  value={time(r.start)}
                  onChange={(e) => setMinute(i, "start", e.target.value)}
                />
              </label>
              <label>
                Until
                <input
                  type="time"
                  step="1800"
                  required
                  value={time(r.end)}
                  onChange={(e) => setMinute(i, "end", e.target.value)}
                />
              </label>
              <label>
                Qualified staff
                <input
                  type="number"
                  min={1}
                  max={20}
                  required
                  value={r.minimum}
                  onChange={(e) =>
                    setRules({
                      ...rules,
                      requirements: rules.requirements.map((v, j) =>
                        j === i ? { ...v, minimum: Number(e.target.value) } : v,
                      ),
                    })
                  }
                />
              </label>
            </div>
            <div className="rule-days">
              {DAYS.map((d, day) => (
                <label className="checkbox-label" key={d}>
                  <input
                    type="checkbox"
                    checked={r.days.includes(day)}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        requirements: rules.requirements.map((v, j) =>
                          j === i
                            ? {
                                ...v,
                                days: e.target.checked
                                  ? [...v.days, day]
                                  : v.days.filter((x) => x !== day),
                              }
                            : v,
                        ),
                      })
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>
        ))}
        <button
          className="btn small"
          type="button"
          onClick={() =>
            setRules({
              ...rules,
              requirements: [
                ...rules.requirements,
                {
                  id: crypto.randomUUID(),
                  skillId: rules.catalog[0].id,
                  days: [0, 1, 2, 3, 4, 5, 6],
                  start: 600,
                  end: 660,
                  minimum: 1,
                },
              ],
            })
          }
        >
          <Plus size={14} />
          Add interval rule
        </button>
        <h3 className="rule-subtitle">Personal duties by shift type</h3>
        <p className="form-hint">
          These must be held by the assigned employee, even if a colleague is
          qualified.
        </p>
        {(["Opening", "Midday", "Closing"] as const).map((kind) => (
          <fieldset className="skill-checklist" key={kind}>
            <legend>{kind}</legend>
            {rules.catalog.map((k) => (
              <label className="checkbox-label" key={k.id}>
                <input
                  type="checkbox"
                  checked={rules.requiredByKind[kind].includes(k.id)}
                  onChange={(e) =>
                    setRules({
                      ...rules,
                      requiredByKind: {
                        ...rules.requiredByKind,
                        [kind]: e.target.checked
                          ? [...rules.requiredByKind[kind], k.id]
                          : rules.requiredByKind[kind].filter(
                              (id) => id !== k.id,
                            ),
                      },
                    })
                  }
                />
                {k.name}
              </label>
            ))}
          </fieldset>
        ))}
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            Save skill rules
          </button>
        </div>
      </form>
    </Modal>
  );
}
