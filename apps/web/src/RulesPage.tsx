import {
  type RuleCondition,
  type RuleEffect,
  type RuleEffectType,
  type RuleStrength,
  type SchedulerRule,
  type SchedulerRuleInput,
  type Tag,
} from "@mind-palace/shared";
import { useEffect, useState } from "react";
import { api } from "./api";

const EFFECT_TYPES = [
  { value: "assignDays", label: "Assign days" },
  { value: "timeWindow", label: "Time window" },
  { value: "preferTimeOfDay", label: "Prefer time of day" },
  { value: "spread", label: "Spread across days" },
  { value: "dailyBudget", label: "Min/max per day" },
  { value: "weatherGate", label: "Weather conditions" },
  { value: "withinAfter", label: "Within X of prerequisite" },
] as const;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Sentinel for a rule whose `applies` is too complex for the simple tag picker; kept verbatim. */
const KEEP_CONDITION = "__keep__";

function numberText(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function strengthLabel(strength: RuleStrength): string {
  return strength.kind === "hard" ? "hard" : `weight ${strength.weight}`;
}

/** Human summary of a rule's effect, for the list view. */
function describeEffect(effect: RuleEffect): string {
  switch (effect.type) {
    case "assignDays":
      return `days ${effect.days.map((day) => WEEKDAYS[day] ?? day).join(", ") || "none"}`;
    case "timeWindow":
    case "preferTimeOfDay":
      return `${effect.start}–${effect.end}`;
    case "spread":
      return `≤ ${effect.maxPerDayMinutes ?? 120} min/day${effect.minDistinctDays ? ` · ≥${effect.minDistinctDays} days` : ""}`;
    case "dailyBudget":
      return `≤ ${effect.softMaxPerDay ?? 1}/day`;
    case "weatherGate": {
      const parts: string[] = [];
      if (effect.minTemperatureF !== undefined || effect.maxTemperatureF !== undefined) {
        parts.push(`${effect.minTemperatureF ?? "–"}–${effect.maxTemperatureF ?? "–"}°F`);
      }
      if (effect.maxPrecipitationProbability !== undefined) parts.push(`rain ≤${effect.maxPrecipitationProbability}%`);
      if (effect.maxWindMph !== undefined) parts.push(`wind ≤${effect.maxWindMph} mph`);
      if (effect.requireDaytime) parts.push("daytime");
      return parts.length > 0 ? `weather: ${parts.join(", ")}` : "weather (no bounds set)";
    }
    case "withinAfter":
      return `within ${effect.maxMinutes ?? 30} min of prerequisite`;
  }
}

function tagName(tags: Tag[], publicId: string): string {
  return tags.find((entry) => entry.publicId === publicId)?.title ?? publicId;
}

function conditionLabel(condition: RuleCondition | null, tags: Tag[]): string {
  if (!condition || "always" in condition) return "any task";
  if ("taskHasTag" in condition) return `tag ${tagName(tags, condition.taskHasTag)}`;
  if ("taskHasAnyTag" in condition) return `tags ${condition.taskHasAnyTag.map((publicId) => tagName(tags, publicId)).join(", ")}`;
  return "condition";
}

function RuleRow({ rule, tags, onChange, onEdit, onDelete }: {
  rule: SchedulerRule;
  tags: Tag[];
  onChange: (id: number, input: Partial<SchedulerRuleInput>) => void;
  onEdit: () => void;
  onDelete: (id: number) => void;
}) {
  return (
    <li className="rule-row">
      <label className="rule-toggle">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(event) => onChange(rule.id, { enabled: event.target.checked })}
        />
      </label>
      <div className="rule-main">
        <strong>{rule.title}</strong>
        <span className="muted">
          {rule.effect.type} · {describeEffect(rule.effect)} · {conditionLabel(rule.applies, tags)} · {strengthLabel(rule.strength)}
        </span>
        <span className="rule-reason">{rule.reason}</span>
      </div>
      {rule.strength.kind === "soft" && (
        <label className="rule-weight">
          weight
          <input
            type="number"
            min={1}
            value={rule.strength.weight}
            onChange={(event) => onChange(rule.id, {
              strength: { kind: "soft", weight: Number(event.target.value) },
            })}
          />
        </label>
      )}
      <button type="button" className="rule-edit" onClick={onEdit}>Edit</button>
      <button type="button" className="rule-delete" aria-label={`Delete ${rule.title}`} onClick={() => onDelete(rule.id)}>×</button>
    </li>
  );
}

function RuleForm({ tags, initial, onSubmit, onCancel }: {
  tags: Tag[];
  initial?: SchedulerRule;
  onSubmit: (input: SchedulerRuleInput) => void;
  onCancel?: () => void;
}) {
  const effect = initial?.effect;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [tag, setTag] = useState(() => {
    const applies = initial?.applies;
    if (!applies || "always" in applies) return "";
    if ("taskHasTag" in applies) return applies.taskHasTag;
    return KEEP_CONDITION;
  });
  const [effectType, setEffectType] = useState<RuleEffectType>(effect?.type ?? "preferTimeOfDay");
  const [days, setDays] = useState<number[]>(effect?.type === "assignDays" ? effect.days : []);
  const [start, setStart] = useState(
    effect?.type === "timeWindow" || effect?.type === "preferTimeOfDay" ? effect.start : "07:00",
  );
  const [end, setEnd] = useState(
    effect?.type === "timeWindow" || effect?.type === "preferTimeOfDay" ? effect.end : "11:00",
  );
  const [maxPerDay, setMaxPerDay] = useState(effect?.type === "spread" ? effect.maxPerDayMinutes ?? 120 : 120);
  const [minDays, setMinDays] = useState(effect?.type === "spread" ? effect.minDistinctDays ?? 0 : 0);
  const [avoidConsecutive, setAvoidConsecutive] = useState(effect?.type === "spread" ? effect.avoidConsecutive ?? false : false);
  const [budgetMax, setBudgetMax] = useState(effect?.type === "dailyBudget" ? effect.softMaxPerDay ?? 1 : 1);
  const [minTemp, setMinTemp] = useState(effect?.type === "weatherGate" ? numberText(effect.minTemperatureF) : "50");
  const [maxTemp, setMaxTemp] = useState(effect?.type === "weatherGate" ? numberText(effect.maxTemperatureF) : "80");
  const [maxPrecip, setMaxPrecip] = useState(effect?.type === "weatherGate" ? numberText(effect.maxPrecipitationProbability) : "20");
  const [maxWind, setMaxWind] = useState(effect?.type === "weatherGate" ? numberText(effect.maxWindMph) : "15");
  const [requireDaytime, setRequireDaytime] = useState(effect?.type === "weatherGate" ? effect.requireDaytime ?? false : true);
  const [withinMinutes, setWithinMinutes] = useState(effect?.type === "withinAfter" ? effect.maxMinutes ?? 30 : 30);
  const [hard, setHard] = useState(initial?.strength.kind === "hard");
  const [weight, setWeight] = useState(initial?.strength.kind === "soft" ? initial.strength.weight : 3);
  const [reason, setReason] = useState(initial?.reason ?? "");

  // Day pins, time windows, weather gates, and prerequisite gaps can be hard constraints.
  const hardCapable = effectType === "assignDays" || effectType === "timeWindow"
    || effectType === "weatherGate" || effectType === "withinAfter";

  // Preserve a placement-scoped `when` when the effect type is unchanged; the form does not edit it.
  const preserveWhen = effect && effect.type === effectType && "when" in effect ? effect.when : undefined;
  const when = preserveWhen ? { when: preserveWhen } : {};

  function buildEffect(): RuleEffect {
    switch (effectType) {
      case "assignDays": return { type: "assignDays", days, ...when };
      case "timeWindow": return { type: "timeWindow", start, end, ...when };
      case "preferTimeOfDay": return { type: "preferTimeOfDay", start, end, ...when };
      case "spread": return {
        type: "spread",
        maxPerDayMinutes: maxPerDay,
        ...(minDays > 0 ? { minDistinctDays: minDays } : {}),
        ...(avoidConsecutive ? { avoidConsecutive: true } : {}),
        ...when,
      };
      case "dailyBudget": return { type: "dailyBudget", softMaxPerDay: budgetMax, ...when };
      case "weatherGate": {
        // Blank inputs mean "no bound on this dimension" — the worker applies only what you set.
        const optionalNumber = (value: string): number | undefined => value.trim() === "" ? undefined : Number(value);
        const min = optionalNumber(minTemp);
        const max = optionalNumber(maxTemp);
        const precipitation = optionalNumber(maxPrecip);
        const wind = optionalNumber(maxWind);
        return {
          type: "weatherGate",
          ...(min !== undefined ? { minTemperatureF: min } : {}),
          ...(max !== undefined ? { maxTemperatureF: max } : {}),
          ...(precipitation !== undefined ? { maxPrecipitationProbability: precipitation } : {}),
          ...(wind !== undefined ? { maxWindMph: wind } : {}),
          ...(requireDaytime ? { requireDaytime: true } : {}),
          ...when,
        };
      }
      case "withinAfter": return { type: "withinAfter", maxMinutes: withinMinutes };
    }
  }

  function submit() {
    const strength: RuleStrength = hard ? { kind: "hard" } : { kind: "soft", weight };
    const applies: RuleCondition = tag === ""
      ? { always: true }
      : tag === KEEP_CONDITION
        ? initial?.applies ?? { always: true }
        : { taskHasTag: tag };
    onSubmit({
      title: title.trim() || effectType,
      applies,
      effect: buildEffect(),
      strength,
      reason: reason.trim() || title.trim() || effectType,
    });
    if (!initial) {
      setTitle("");
      setReason("");
    }
  }

  return (
    <section className="rule-form">
      <h2>{initial ? `Edit “${initial.title}”` : "New rule"}</h2>
      <div className="rule-form-grid">
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Morning deep work" /></label>
        <label>Tag
          <select value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="">(any task)</option>
            {tag === KEEP_CONDITION && <option value={KEEP_CONDITION}>(keep current condition)</option>}
            {tag !== "" && tag !== KEEP_CONDITION && !tags.some((entry) => entry.publicId === tag) && (
              <option value={tag}>{tag}</option>
            )}
            {tags.map((entry) => <option key={entry.id} value={entry.publicId}>{entry.title}</option>)}
          </select>
        </label>
        <label>Effect
          <select value={effectType} onChange={(event) => {
            const next = event.target.value as RuleEffectType;
            setEffectType(next);
            if (next !== "assignDays" && next !== "timeWindow" && next !== "weatherGate" && next !== "withinAfter") setHard(false);
          }}>
            {EFFECT_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>
        {effectType === "assignDays" && (
          <div className="rule-days">
            {WEEKDAYS.map((label, day) => (
              <label key={label}>
                <input
                  type="checkbox"
                  checked={days.includes(day)}
                  onChange={(event) => setDays(event.target.checked ? [...days, day] : days.filter((value) => value !== day))}
                />
                {label}
              </label>
            ))}
          </div>
        )}
        {(effectType === "timeWindow" || effectType === "preferTimeOfDay") && <>
          <label>Start<input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label>End<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        </>}
        {effectType === "spread" && <>
          <label>Max minutes/day<input type="number" min={30} step={30} value={maxPerDay} onChange={(event) => setMaxPerDay(Number(event.target.value))} /></label>
          <label>Min distinct days<input type="number" min={0} max={7} value={minDays} onChange={(event) => setMinDays(Number(event.target.value))} /></label>
          <label>
            <input type="checkbox" checked={avoidConsecutive} onChange={(event) => setAvoidConsecutive(event.target.checked)} />
            Avoid consecutive days
          </label>
        </>}
        {effectType === "dailyBudget" && (
          <label>Max per day<input type="number" min={1} value={budgetMax} onChange={(event) => setBudgetMax(Number(event.target.value))} /></label>
        )}
        {effectType === "weatherGate" && <>
          <label>Min temp °F<input type="number" value={minTemp} onChange={(event) => setMinTemp(event.target.value)} placeholder="any" /></label>
          <label>Max temp °F<input type="number" value={maxTemp} onChange={(event) => setMaxTemp(event.target.value)} placeholder="any" /></label>
          <label>Max rain %<input type="number" min={0} max={100} value={maxPrecip} onChange={(event) => setMaxPrecip(event.target.value)} placeholder="any" /></label>
          <label>Max wind mph<input type="number" min={0} value={maxWind} onChange={(event) => setMaxWind(event.target.value)} placeholder="any" /></label>
          <label>
            <input type="checkbox" checked={requireDaytime} onChange={(event) => setRequireDaytime(event.target.checked)} />
            Daytime only
          </label>
        </>}
        {effectType === "withinAfter" && (
          <label>Max minutes after<input type="number" min={0} step={15} value={withinMinutes} onChange={(event) => setWithinMinutes(Number(event.target.value))} /></label>
        )}
        <label>Strength
          <select
            value={hard ? "hard" : "soft"}
            disabled={!hardCapable}
            onChange={(event) => setHard(event.target.value === "hard")}
          >
            <option value="soft">soft</option>
            {hardCapable && <option value="hard">hard</option>}
          </select>
        </label>
        {!hard && (
          <label>Weight<input type="number" min={1} value={weight} onChange={(event) => setWeight(Number(event.target.value))} /></label>
        )}
        <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mornings are for deep work" /></label>
      </div>
      <div className="button-row">
        <button className="primary-button" type="button" onClick={submit}>{initial ? "Save rule" : "Add rule"}</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </section>
  );
}

export function RulesPage() {
  const [rules, setRules] = useState<SchedulerRule[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  async function load() {
    try {
      const [nextRules, nextTags] = await Promise.all([api.schedulerRules(), api.tags()]);
      setRules(nextRules);
      setTags(nextTags);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(input: SchedulerRuleInput) {
    try {
      await api.createSchedulerRule(input);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  async function save(id: number, input: SchedulerRuleInput) {
    try {
      await api.updateSchedulerRule(id, input);
      setEditingId(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  async function change(id: number, input: Partial<SchedulerRuleInput>) {
    try {
      await api.updateSchedulerRule(id, input);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  async function remove(id: number) {
    try {
      setRules(await api.deleteSchedulerRule(id));
      setError(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  return (
    <main className="detail-shell">
      {error && <div className="error-banner">{error}</div>}
      <header className="detail-header">
        <div>
          <div className="task-card-topline"><span className="task-type">scheduler</span></div>
          <h1>Rules</h1>
          <p className="muted">
            Rules are data. Each enabled rule becomes a hard constraint or a weighted soft
            preference, and the scheduler optimizes one objective across all of them. Tags are
            selectors: a rule can reference any tag, seeded or your own.
          </p>
        </div>
      </header>
      <ul className="rules-list">
        {rules.map((rule) => editingId === rule.id ? (
          <li key={rule.id} className="rule-row rule-row-editing">
            <RuleForm
              key={`edit-${rule.id}`}
              tags={tags}
              initial={rule}
              onSubmit={(input) => void save(rule.id, input)}
              onCancel={() => setEditingId(null)}
            />
          </li>
        ) : (
          <RuleRow
            key={rule.id}
            rule={rule}
            tags={tags}
            onEdit={() => setEditingId(rule.id)}
            onChange={(id, input) => void change(id, input)}
            onDelete={(id) => void remove(id)}
          />
        ))}
      </ul>
      {editingId === null && <RuleForm tags={tags} onSubmit={(input) => void create(input)} />}
    </main>
  );
}
