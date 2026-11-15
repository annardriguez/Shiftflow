"use client";
import { workspaceFetch } from "@/lib/workspace-fetch";
import { useState } from "react";
import {
  Check,
  ShieldCheck,
  AlertTriangle,
  Plus,
  Trash2,
  KeyRound,
  HelpCircle,
} from "lucide-react";
import { useApp } from "./provider";
import { Badge, Callout, CanClose, ErrorBox, Modal } from "./ui";
import type { Employee, Shift, SkillRules, SkillDefinition } from "@/lib/types";
import {
  qualified,
  skillDiagnostics,
  skillName,
} from "@/lib/skills";
import { DAYS, time } from "@/lib/schedule";

const SHORT: Record<string, string> = {
  open: "Opens",
  close: "Closes",
  train: "Supervises",
  service: "Service",
};

/**
 * Compact capability indicators. Only manager-verified skills are shown as
 * capabilities; an unreviewed profile is shown as unknown, never as competent.
 */
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
        <span className="skill-tag unverified" title="Skills haven’t been verified by a manager yet">
          <HelpCircle size={10} /> Skills unverified
        </span>
      </span>
    );
  const verified = employee.competencies.filter(
    (q) =>
      qualified(employee, q.skillId) &&
      (!compact || (q.skillId !== "service" && q.skillId !== "train")),
  );
  return (
    <span className={`skill-badges ${compact ? "compact-skills" : ""}`}>
      {verified
        .sort((a, b) => (a.skillId === "close" ? -1 : b.skillId === "close" ? 1 : 0))
        .map((q) => (
          <span
            key={q.skillId}
            className={`skill-tag ${q.skillId === "close" ? "skill-closer" : q.skillId === "open" ? "skill-opener" : ""}`}
            title={`${name(q.skillId)} · verified ${new Date(q.verifiedAt).toLocaleDateString("en-GB")}`}
          >
            {q.skillId === "close" && <KeyRound size={10} />}
            {SHORT[q.skillId] ?? name(q.skillId)}
          </span>
        ))}
      {employee.supervisionSkillId && (
        <span className="skill-tag trainee" title={`In training: needs a colleague who can ${name(employee.supervisionSkillId).toLowerCase()}`}>
          In training
        </span>
      )}
      {!verified.length && !employee.supervisionSkillId && (
        <span className="skill-tag">No verified skills</span>
      )}
    </span>
  );
}

/** Larger capability list for profiles. */
export function CapabilityTags({
  employee,
  catalog,
}: {
  employee: Employee;
  catalog: SkillDefinition[];
}) {
  if (!employee.skillsReviewedAt)
    return (
      <Callout tone="caution" title="Skills not verified yet">
        A manager hasn’t reviewed this profile, so ShiftFlow treats every skill as unknown.
      </Callout>
    );
  return (
    <div className="detail-list">
      {catalog.map((k) => {
        const yes = qualified(employee, k.id);
        return (
          <div key={k.id}>
            <span className="k">{k.name}</span>
            <span className="v" style={{ color: yes ? (k.id === "close" ? "var(--closing)" : "var(--positive)") : "var(--faint)" }}>
              {yes ? (k.id === "close" ? <><CanClose /> Verified</> : "Verified") : "Not yet"}
            </span>
          </div>
        );
      })}
      {employee.supervisionSkillId && (
        <div>
          <span className="k">Training</span>
          <span className="v" style={{ color: "var(--accent-ink)" }}>Works with a supervisor</span>
        </div>
      )}
    </div>
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
      title="Verify skills"
      description={`${employee.name} · What they can do on their own`}
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={save}>
        <ErrorBox error={error} />
        <Callout tone="neutral">
          Skills are yes/no qualifications, not ratings. They decide who can be
          asked to cover which shifts. Every change is recorded.
        </Callout>
        <fieldset className="skill-checklist">
          <legend>Verified skills</legend>
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
          Training status
          <select
            value={supervision}
            onChange={(e) => setSupervision(e.target.value)}
          >
            <option value="">Works independently</option>
            {data.restaurant.skillRules.catalog.map((k) => (
              <option value={k.id} key={k.id}>
                In training · needs someone who can: {k.name.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <p className="form-hint">
          A trainee is always scheduled alongside an independent colleague on
          duty. Removing a skill is recorded, and any roster gaps it causes stay
          visible until fixed.
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
            {saving ? "Saving…" : "Save verified skills"}
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
        <strong>Skills on shift</strong>
        <Badge tone={issues.length ? "peach" : "sage"}>
          {issues.length
            ? `${issues.length} to fix`
            : "All covered"}
        </Badge>
      </div>
      {employee && <SkillBadges employee={employee} />}
      <p className="form-hint">
        Checks opening, closing and service cover plus trainee supervision for
        everyone on duty during this shift, including breaks.
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
          Opening, closing, service and supervision are all covered during this shift.
        </p>
      )}
      <details className="supervision-details">
        <summary>Qualified people per half hour</summary>
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
                    <td style={r.actual < r.required ? { color: "var(--negative)", fontWeight: 600 } : undefined}>
                      {r.actual} / {r.required}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <p>No skill minimums apply in this window.</p>
        )}
      </details>
      {pairings.length > 0 && (
        <details className="supervision-details">
          <summary>Who supervises whom</summary>
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
export function SkillRulesPanel() {
  const { data } = useApp(),
    [editing, setEditing] = useState(false);
  if (!data) return null;
  const rules = data.restaurant.skillRules;
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Staffing rules</h2>
          <p>Skills that must be on shift, and how many trainees one person can supervise.</p>
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
      title="Edit staffing rules"
      description="Changes are recorded and may reveal gaps in existing rosters."
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
