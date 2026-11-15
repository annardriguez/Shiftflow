"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  RefreshCw,
  UserRoundCheck,
  ArrowLeftRight,
  ShieldCheck,
  ShieldAlert,
  CircleSlash,
  Construction,
  Send,
  LoaderCircle,
  CalendarClock,
  Clock3,
  KeyRound,
  SearchX,
} from "lucide-react";
import { Avatar, Callout, EmptyState, ErrorBox, Modal, Skeleton } from "./ui";
import { api } from "@/lib/client-api";
import {
  explainCover,
  explainSwap,
  sortByVerdict,
  type CandidateInsight,
  type Verdict,
} from "@/lib/swap-insights";
import { firstName, hours, longDate, paid, shortDate, timeRange } from "@/lib/format";
import type { Shift } from "@/lib/types";
import type { CoverOption, SwapOption } from "@/lib/workforce-types";

type Option = CoverOption | SwapOption;
const keyOf = (o: Option) => ("employeeId" in o ? o.employeeId : o.shift.id);
const nameOfOption = (o: Option) => ("name" in o ? o.name : o.employeeName);

export function ShiftHero({ shift, owner }: { shift: Shift; owner?: string }) {
  return (
    <div className={`shift-hero ${shift.kind.toLowerCase()}`}>
      <span className="sh-date">{longDate(shift.date)}</span>
      <span className="sh-time">{timeRange(shift)}</span>
      <span className="sh-meta">
        <span>
          <Clock3 size={13} /> {hours(paid(shift))} paid
          {shift.breakMinutes ? ` · ${shift.breakMinutes} min break` : ""}
        </span>
        <span>
          <CalendarClock size={13} /> {shift.kind} shift
        </span>
        {shift.kind === "Closing" && (
          <span>
            <KeyRound size={13} /> Needs someone who can close
          </span>
        )}
        {owner && <span>Assigned to {owner}</span>}
      </span>
    </div>
  );
}

const VERDICT_ICON: Record<Verdict, React.ReactNode> = {
  suitable: <ShieldCheck size={13} />,
  unverified: <ShieldAlert size={13} />,
  "roster-blocked": <Construction size={13} />,
  "not-eligible": <CircleSlash size={13} />,
};

function CandidateCard({
  option,
  insight,
  selected,
  onSelect,
  disabled,
  swap,
}: {
  option: Option;
  insight: CandidateInsight;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
  swap: boolean;
}) {
  const sendable = insight.verdict === "suitable";
  const name = nameOfOption(option);
  const content = (
    <>
      <Avatar employee={{ name, color: undefined }} />
      <div className="c-body">
        <div className="c-top">
          <span className="c-name">{name}</span>
          <span className={`verdict ${insight.verdict}`}>
            {VERDICT_ICON[insight.verdict]} {insight.label}
          </span>
        </div>
        {swap && "shift" in option && (
          <span className="c-sub">
            Their shift: {shortDate(option.shift.date)} · {timeRange(option.shift)} · {option.shift.kind}
          </span>
        )}
        {!swap && "scheduledHours" in option && (
          <span className="c-sub">
            {hours(option.scheduledHours)} scheduled this week · prefers {hours(option.preferredHours)}
          </span>
        )}
        <p className="c-why">{insight.summary}</p>
        {insight.chips.length > 0 && (
          <div className="c-chips">
            {insight.chips.map((c) => (
              <span key={c.label} className={`chip ${c.tone}`}>
                {c.label === "Can close" && <KeyRound size={11} />}
                {c.label}
              </span>
            ))}
          </div>
        )}
        {!sendable && insight.blockers.length > 1 && (
          <ul className="c-blockers">
            {insight.blockers.slice(1, 4).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
      </div>
      {sendable ? (
        <span className="c-select" aria-hidden="true">
          <Check size={12} strokeWidth={3} />
        </span>
      ) : (
        <span />
      )}
    </>
  );
  if (!sendable) return <div className="candidate disabled">{content}</div>;
  return (
    <label className={`candidate ${selected ? "selected" : ""}`}>
      <input
        type="radio"
        name="candidate"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        aria-label={`${name}: ${insight.label}`}
      />
      {content}
    </label>
  );
}

/**
 * Find and request a replacement for a shift. Eligibility comes only from the
 * server's engine validation. Employees send a request to one colleague;
 * managers can instead record an agreement both colleagues already made.
 */
export function ReplacementFinder({
  shift,
  week,
  ownerName,
  onClose,
  onDone,
  recording,
}: {
  shift: Shift;
  week: string;
  ownerName?: string;
  onClose: () => void;
  onDone: (message: string) => void;
  recording?: { requesterId: string };
}) {
  const [mode, setMode] = useState<"cover" | "swap">("cover"),
    [options, setOptions] = useState<Option[]>([]),
    [selected, setSelected] = useState(""),
    [checkedRevision, setCheckedRevision] = useState<number | null>(null),
    [current, setCurrent] = useState(shift),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [note, setNote] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [attempt, setAttempt] = useState(0),
    [sent, setSent] = useState<string | null>(null),
    [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let live = true;
    setOptions([]);
    setSelected("");
    setCheckedRevision(null);
    setLoading(true);
    setError("");
    api(
      `/api/workforce?view=candidates&mode=${mode}&week=${week}&shiftId=${encodeURIComponent(shift.id)}`,
    )
      .then((r) => {
        if (!live) return;
        setOptions(r.options);
        setCheckedRevision(r.revision);
        setCurrent(r.offeredShift);
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [mode, week, shift.id, attempt]);

  const ranked = useMemo(() => {
    const withInsight = options.map((o) => ({
      option: o,
      insight: "employeeId" in o ? explainCover(o, current) : explainSwap(o),
    }));
    return sortByVerdict(withInsight, (x) => x.insight.verdict);
  }, [options, current]);
  const suitable = ranked.filter((x) => x.insight.verdict === "suitable"),
    review = ranked.filter((x) => x.insight.verdict === "unverified"),
    others = ranked.filter(
      (x) => x.insight.verdict !== "suitable" && x.insight.verdict !== "unverified",
    ),
    rosterBlocked = others.filter((x) => x.insight.verdict === "roster-blocked");
  const choice = ranked.find((x) => keyOf(x.option) === selected);
  const choiceName = choice ? nameOfOption(choice.option) : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!choice || choice.insight.verdict !== "suitable" || checkedRevision === null) return;
    setSaving(true);
    setError("");
    try {
      const o = choice.option;
      const targetEmployeeId = "employeeId" in o ? o.employeeId : o.shift.employeeId;
      await api("/api/workforce", {
        action: recording ? "record-agreement" : "create-shift",
        revision: checkedRevision,
        kind: mode,
        week,
        shiftId: shift.id,
        targetEmployeeId,
        ...("shift" in o ? { counterWeek: o.week, counterShiftId: o.shift.id } : {}),
        note,
        ...(recording
          ? { requesterId: recording.requesterId, agreementConfirmed: confirmed }
          : {}),
      });
      if (recording) onDone(`Agreed change applied. ${choiceName} is now on the roster.`);
      else setSent(choiceName);
    } catch (e) {
      setError((e as Error).message);
      // The roster may have moved on; refresh the assessment.
      setAttempt((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  if (sent)
    return (
      <Modal title="Request sent" onClose={() => onDone(`Request sent to ${sent}`)} variant="drawer">
        <div className="modal-body" style={{ display: "grid", gap: 16 }}>
          <EmptyState icon={<Send size={20} />} title={`We’ve asked ${firstName(sent)}`}>
            {firstName(sent)} can accept or decline in ShiftFlow. If they accept, your manager reviews it before
            anything changes. Until then, this shift is still yours.
          </EmptyState>
          <ShiftHero shift={current} />
          <div className="modal-actions">
            <button className="btn primary" onClick={() => onDone(`Request sent to ${sent}`)}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    );

  const visibleOthers = showAll ? others : others.slice(0, 3);

  return (
    <Modal
      title={recording ? "Record an agreed change" : "Find a replacement"}
      description={
        recording
          ? "For a swap both colleagues already agreed, for example in person. It’s checked and applied immediately."
          : "Only colleagues who pass every requirement can be asked. Nothing changes until they accept and a manager approves."
      }
      onClose={onClose}
      variant="drawer"
      wide
    >
      <form className="editor-form" onSubmit={submit}>
        <ShiftHero shift={current} owner={ownerName} />
        <div className="segmented" role="tablist" aria-label="Replacement type">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "cover"}
            disabled={saving}
            onClick={() => setMode("cover")}
          >
            <UserRoundCheck size={15} /> Someone takes it
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "swap"}
            disabled={saving}
            onClick={() => setMode("swap")}
          >
            <ArrowLeftRight size={15} /> Swap shifts
          </button>
        </div>
        <ErrorBox error={error} />
        {loading ? (
          <div className="section">
            <p className="form-hint" role="status">
              <LoaderCircle size={13} className="spin" style={{ verticalAlign: -2 }} /> Checking each colleague’s
              availability, skills, rest and hours…
            </p>
            <div className="panel">
              <Skeleton rows={4} />
            </div>
          </div>
        ) : (
          <>
            {suitable.length > 0 ? (
              <div className="section" role="radiogroup" aria-label="Suitable replacements">
                <div className="group-label">
                  {mode === "cover" ? "Can take this shift" : "Shifts you could swap"} · {suitable.length}
                </div>
                <div className="candidate-list">
                  {suitable.map((x) => (
                    <CandidateCard
                      key={keyOf(x.option)}
                      option={x.option}
                      insight={x.insight}
                      selected={selected === keyOf(x.option)}
                      onSelect={() => setSelected(keyOf(x.option))}
                      disabled={saving}
                      swap={mode === "swap"}
                    />
                  ))}
                </div>
              </div>
            ) : (
              !error && (
                <div className="panel">
                  <EmptyState
                    icon={<SearchX size={20} />}
                    title={
                      options.length === 0
                        ? mode === "swap"
                          ? "No shifts to swap with nearby"
                          : "No colleagues to ask"
                        : "No one can take this shift right now"
                    }
                    action={
                      <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
                        <RefreshCw size={14} /> Check again
                      </button>
                    }
                  >
                    {rosterBlocked.length > 0 && rosterBlocked.length === others.length
                      ? "The current roster already has a staffing or skills gap in this period, so no change can be approved until a manager fixes it."
                      : mode === "cover"
                        ? "Everyone is either unavailable, already working, or missing a required skill. Try a swap instead, or talk to your manager."
                        : "No nearby shift passes the checks in both directions. Try asking someone to take it instead."}
                  </EmptyState>
                </div>
              )
            )}
            {review.length > 0 && (
              <div className="section">
                <div className="group-label">Needs manager review · {review.length}</div>
                <Callout tone="caution">
                  These colleagues might be able to help, but their skills haven’t been verified. They can’t be
                  asked until a manager confirms them.
                </Callout>
                <div className="candidate-list">
                  {review.map((x) => (
                    <CandidateCard
                      key={keyOf(x.option)}
                      option={x.option}
                      insight={x.insight}
                      selected={false}
                      onSelect={() => {}}
                      disabled
                      swap={mode === "swap"}
                    />
                  ))}
                </div>
              </div>
            )}
            {others.length > 0 && (
              <div className="section">
                <div className="group-label">Not available · {others.length}</div>
                <div className="candidate-list">
                  {visibleOthers.map((x) => (
                    <CandidateCard
                      key={keyOf(x.option)}
                      option={x.option}
                      insight={x.insight}
                      selected={false}
                      onSelect={() => {}}
                      disabled
                      swap={mode === "swap"}
                    />
                  ))}
                </div>
                {others.length > 3 && (
                  <button type="button" className="btn ghost small" onClick={() => setShowAll(!showAll)}>
                    {showAll ? "Show fewer" : `Show ${others.length - 3} more`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {(suitable.length > 0 || recording) && !loading && (
          <label>
            {recording ? "How was this agreed? (required)" : `Message to ${choiceName ? firstName(choiceName) : "your colleague"} (optional)`}
            <textarea
              value={note}
              maxLength={500}
              required={!!recording}
              minLength={recording ? 5 : 0}
              onChange={(e) => setNote(e.target.value)}
              placeholder={recording ? "e.g. Both agreed in person on Saturday." : "e.g. I have a family dinner. Could you take this one?"}
            />
          </label>
        )}
        {recording && !loading && (
          <label className="checkbox-label">
            <input type="checkbox" required checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I’ve confirmed this change with both colleagues.
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {!loading && suitable.length > 0 && (
            <button
              className="btn primary"
              disabled={saving || !choice || (recording && !confirmed) || checkedRevision === null}
              aria-busy={saving}
            >
              {saving ? (
                <>
                  <LoaderCircle size={15} className="spin" /> Checking again…
                </>
              ) : !choice ? (
                "Choose someone"
              ) : recording ? (
                `Apply change with ${firstName(choiceName)}`
              ) : (
                <>
                  <Send size={15} /> Ask {firstName(choiceName)}
                </>
              )}
            </button>
          )}
        </div>
        <p className="form-hint">
          Checked against the latest saved roster
          {checkedRevision !== null ? ` (version ${checkedRevision})` : ""}. Everything is checked again when you send,
          when your colleague accepts, and before approval.
        </p>
      </form>
    </Modal>
  );
}
