import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { RecurrenceTemplate, Tag, UpsertRecurrenceInput } from "@mind-palace/shared";
import { api } from "./api";
import { TagPicker } from "./components/TagPicker";

const WEEKDAY_CHOICES = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

function todayLocal(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "every day", "every 3 days", "every Monday, Wednesday", "every 2 weeks on Sunday". */
function summarize(template: RecurrenceTemplate): string {
  const names = template.weekdays.map((day) => WEEKDAY_CHOICES.find((choice) => choice.value === day)?.label ?? "");
  const days = names.length > 0 ? ` on ${names.join(", ")}` : "";
  if (template.frequency === "weekly") {
    return `every ${template.intervalCount === 1 ? "week" : `${template.intervalCount} weeks`}${days}`;
  }
  return `every ${template.intervalCount === 1 ? "day" : `${template.intervalCount} days`}`;
}

interface Draft {
  id: number | null;
  title: string;
  durationMinutes: string;
  frequency: "daily" | "weekly";
  intervalCount: string;
  weekdays: number[];
  nextOccurrenceDate: string;
  autoArchiveHour: string;
  tagIds: number[];
}

function emptyDraft(): Draft {
  return {
    id: null,
    title: "",
    durationMinutes: "30",
    frequency: "daily",
    intervalCount: "1",
    weekdays: [],
    nextOccurrenceDate: todayLocal(),
    autoArchiveHour: "",
    tagIds: [],
  };
}

function draftFrom(template: RecurrenceTemplate): Draft {
  return {
    id: template.id,
    title: template.title,
    durationMinutes: String(template.durationMinutes),
    frequency: template.frequency,
    intervalCount: String(template.intervalCount),
    weekdays: template.weekdays,
    nextOccurrenceDate: template.nextOccurrenceDate,
    autoArchiveHour: template.autoArchiveHour === null ? "" : String(template.autoArchiveHour),
    tagIds: template.tagIds,
  };
}

/**
 * Routines live here rather than on a task page: a routine is not a task, it is the rule that says
 * tasks should exist. Keeping it beside the tasks it produces made the task page carry a second,
 * unrelated subject.
 */
function RoutineEditor({ draft, tags, onCancel, onSave }: {
  draft: Draft;
  tags: Tag[];
  onCancel: () => void;
  onSave: (input: UpsertRecurrenceInput) => Promise<void>;
}) {
  const [form, setForm] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: form.title,
        durationMinutes: Number(form.durationMinutes) || 30,
        frequency: form.frequency,
        intervalCount: Number(form.intervalCount) || 1,
        weekdays: form.weekdays,
        nextOccurrenceDate: form.nextOccurrenceDate,
        autoArchiveHour: form.autoArchiveHour === "" ? null : Number(form.autoArchiveHour),
        tagIds: form.tagIds,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="detail-section routine-editor" onSubmit={submit}>
      <div className="section-label">{form.id === null ? "New routine" : "Edit routine"}</div>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-pair">
        <label>Title
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </label>
        <label>Minutes
          <input
            type="number"
            min="0"
            value={form.durationMinutes}
            onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })}
          />
        </label>
      </div>
      <div className="form-pair">
        <label>Repeats
          <select
            value={form.frequency}
            onChange={(event) => setForm({ ...form, frequency: event.target.value as Draft["frequency"] })}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <label>{form.frequency === "daily" ? "Every N days" : "Every N weeks"}
          <input
            type="number"
            min="1"
            value={form.intervalCount}
            onChange={(event) => setForm({ ...form, intervalCount: event.target.value })}
          />
        </label>
      </div>
      {form.frequency === "weekly" && (
        <label>On these days
          <span className="weekday-choices">
            {WEEKDAY_CHOICES.map((choice) => (
              <label key={choice.value} className="checkbox-field">
                <input
                  type="checkbox"
                  checked={form.weekdays.includes(choice.value)}
                  onChange={(event) => setForm({
                    ...form,
                    weekdays: event.target.checked
                      ? [...form.weekdays, choice.value]
                      : form.weekdays.filter((day) => day !== choice.value),
                  })}
                />
                <span>{choice.label}</span>
              </label>
            ))}
          </span>
        </label>
      )}
      <div className="form-pair">
        <label>First occurrence
          <input
            type="date"
            value={form.nextOccurrenceDate}
            onChange={(event) => setForm({ ...form, nextOccurrenceDate: event.target.value })}
          />
        </label>
        <label>Vanishes at (hour)
          <input
            type="number"
            min="0"
            max="23"
            placeholder="End of day"
            value={form.autoArchiveHour}
            onChange={(event) => setForm({ ...form, autoArchiveHour: event.target.value })}
          />
        </label>
      </div>
      <div className="field-label">Tags each occurrence carries</div>
      <TagPicker
        tags={tags}
        selectedIds={form.tagIds}
        onChange={(tagIds) => setForm({ ...form, tagIds })}
      />
      <p className="form-hint muted">
        Occurrences that go unticked vanish on their own, so a missed routine does not pile up. Set the
        hour to end a routine with its day (10 for “wake up”); leave it blank to keep the whole day.
        Editing a routine only affects the occurrences it creates from now on.
      </p>
      <div className="button-row">
        <button className="primary-button" disabled={busy}>
          {busy ? "Saving..." : form.id === null ? "Create routine" : "Save routine"}
        </button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function RoutinesPage() {
  const [templates, setTemplates] = useState<RecurrenceTemplate[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    try {
      const [nextTemplates, nextTags] = await Promise.all([api.recurrenceTemplates(), api.tags()]);
      setTemplates(nextTemplates);
      setTags(nextTags);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function reportMaterialization(result: { created: number[]; alreadyPresent: number; idleTemplates: string[] }): void {
    const parts = [`created ${result.created.length}`];
    if (result.alreadyPresent > 0) parts.push(`${result.alreadyPresent} already on the board`);
    if (result.idleTemplates.length > 0) parts.push(`no firing date this week for ${result.idleTemplates.join(", ")}`);
    setStatus(parts.join(" · "));
  }

  async function save(input: UpsertRecurrenceInput): Promise<void> {
    const result = draft?.id == null
      ? await api.createRecurrenceTemplate(input)
      : await api.updateRecurrenceTemplate(draft.id, input);
    reportMaterialization(result.materialized);
    setDraft(null);
    await load();
  }

  async function materialize(): Promise<void> {
    try {
      reportMaterialization(await api.materializeRecurrences());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function remove(template: RecurrenceTemplate): Promise<void> {
    if (!window.confirm(`Delete the “${template.title}” routine? Tasks it already created stay on the board.`)) return;
    try {
      await api.deleteRecurrenceTemplate(template.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <h1>Routines</h1>
          <p className="muted">
            A routine is a rule, not a task: it creates an ordinary task on each of its days, and
            that task decays on its own if it goes unticked.
          </p>
        </div>
        <div className="detail-actions">
          <button onClick={() => void materialize()}>Top up this week</button>
          <button className="primary-button" onClick={() => setDraft(emptyDraft())}>New routine</button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      {status && <p className="muted">{status}</p>}

      {draft && (
        <RoutineEditor
          key={draft.id ?? "new"}
          draft={draft}
          tags={tags}
          onCancel={() => setDraft(null)}
          onSave={save}
        />
      )}

      {templates.length === 0
        ? <p className="muted">No routines yet.</p>
        : (
          <ul className="routine-list">
            {templates.map((template) => (
              <li key={template.id} className="routine-row">
                <div>
                  <strong>{template.title}</strong>
                  <span className="muted">
                    {" "}{summarize(template)} · {template.durationMinutes} min ·{" "}
                    {template.autoArchiveHour === null ? "keeps the whole day" : `gone at ${template.autoArchiveHour}:00`}
                  </span>
                  {template.routineTagId !== null && (
                    <span className="muted">
                      {" "}·{" "}
                      <Link to={`/tags/${template.routineTagId}`}>history</Link>
                    </span>
                  )}
                </div>
                <div className="detail-actions">
                  <button onClick={() => setDraft(draftFrom(template))}>Edit</button>
                  <button onClick={() => void remove(template)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
    </main>
  );
}
