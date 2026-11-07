import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { type MaterializeResult, type RecurrenceTemplate, type Tag, type UpsertRecurrenceInput } from "@mind-palace/shared";
import { api } from "./api";
import { todayLocalDate } from "./lib/datetime";
import { TagPicker } from "./components/TagPicker";

/** Hours are stored 0-23; they are always *spoken* in 12-hour time, on the hour. */
function formatHour(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const clock = hour % 12 === 0 ? 12 : hour % 12;
  return `${clock}:00 ${suffix}`;
}

/** 0-23 in the order a day is read, labelled the way it is said. */
const HOUR_CHOICES = Array.from({ length: 24 }, (_, hour) => ({ value: hour, label: formatHour(hour) }));

/** "every day", "every 3 days", "1 time per week", "3 times every 2 weeks". */
function summarize(template: RecurrenceTemplate): string {
  const period = template.frequency === "weekly"
    ? (template.intervalCount === 1 ? "week" : `${template.intervalCount} weeks`)
    : (template.intervalCount === 1 ? "day" : `${template.intervalCount} days`);
  if (template.frequency === "daily") return `every ${period}`;
  const times = template.timesPerPeriod === 1 ? "1 time" : `${template.timesPerPeriod} times`;
  return `${times} per ${period}`;
}

interface Draft {
  id: number | null;
  title: string;
  durationMinutes: string;
  frequency: "daily" | "weekly";
  intervalCount: string;
  timesPerPeriod: string;
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
    timesPerPeriod: "1",
    nextOccurrenceDate: todayLocalDate(),
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
    timesPerPeriod: String(template.timesPerPeriod),
    nextOccurrenceDate: template.nextOccurrenceDate,
    autoArchiveHour: template.autoArchiveHour === null ? "" : String(template.autoArchiveHour),
    tagIds: template.tagIds,
  };
}

/**
 * Recurrence rules live here rather than on a task page: a recurrence is not a task, it is the rule
 * that says tasks should exist. Keeping it beside the tasks it produces made the task page carry a
 * second, unrelated subject.
 */
function RecurrenceEditor({ draft, tags, onCancel, onSave }: {
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
        timesPerPeriod: form.frequency === "daily" ? 1 : Number(form.timesPerPeriod) || 1,
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
    <form className="detail-section recurrence-editor" onSubmit={submit}>
      <div className="section-label">{form.id === null ? "New recurrence" : "Edit recurrence"}</div>
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
      {form.frequency === "weekly" ? (
        <>
          <label>How many times per period
            <input
              type="number"
              min="1"
              value={form.timesPerPeriod}
              onChange={(event) => setForm({ ...form, timesPerPeriod: event.target.value })}
            />
          </label>
          <p className="form-hint muted">
            1 is a cadence — one card in each period. More than 1 is a quota — interchangeable
            cards that can land on any day of the period. “One every 2 weeks” is 2 weeks with 1;
            “twice in 4 weeks, any day” is 4 weeks with 2.
          </p>
        </>
      ) : (
        <p className="form-hint muted">
          A daily recurrence creates exactly one card per day, dated to that day. For anything
          measured in weeks — “once this week, any day” — choose Weekly.
        </p>
      )}
      <div className="form-pair">
        <label>First period starts
          <input
            type="date"
            value={form.nextOccurrenceDate}
            onChange={(event) => setForm({ ...form, nextOccurrenceDate: event.target.value })}
          />
        </label>
        <label>Vanishes at (last day of the period)
          <select
            value={form.autoArchiveHour}
            onChange={(event) => setForm({ ...form, autoArchiveHour: event.target.value })}
          >
            <option value="">End of day</option>
            {HOUR_CHOICES.map((choice) => (
              <option key={choice.value} value={String(choice.value)}>{choice.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-label">Tags each occurrence carries</div>
      <TagPicker
        tags={tags}
        selectedIds={form.tagIds}
        onChange={(tagIds) => setForm({ ...form, tagIds })}
      />
      <p className="form-hint muted">
        A recurrence answers “how often should a new task appear”, not “which day”. Weekly tasks
        live for their whole period, so the Rules page decides where they land — prefer Sunday, keep
        mornings free, at most one per day. Occurrences that go unticked vanish on their own: set
        the hour to end a daily card with its day (10:00 AM for “wake up”), leave it blank to keep
        the whole day, or use the period's last day for a weekly quota. Editing a recurrence only
        affects the tasks it creates from now on.
      </p>
      <div className="button-row">
        <button className="primary-button" disabled={busy}>
          {busy ? "Saving..." : form.id === null ? "Create recurrence" : "Save recurrence"}
        </button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function RecurrencePage() {
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
    // The materialize job runs at 00:15 and the decay sweep at 23:30, so the list can change
    // without a click; a slow poll keeps it honest without the churn of the task pages.
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  function reportMaterialization(result: MaterializeResult): void {
    const parts = [`created ${result.created.length}`];
    if (result.alreadyPresent > 0) parts.push(`${result.alreadyPresent} already on the board`);
    if (result.idleTemplates.length > 0) parts.push(`no period in this window for ${result.idleTemplates.join(", ")}`);
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

  /** Deleting stops future occurrences; ones already on the board are ordinary tasks and stay. */
  async function remove(template: RecurrenceTemplate): Promise<void> {
    try {
      await api.deleteRecurrenceTemplate(template.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <main className="detail-shell">
      <header className="page-header">
        <div>
          <h1>Recurrence</h1>
          <p className="muted">
            How often a new task should appear. A recurrence is a rule, not a task: it creates
            ordinary tasks, each with a window (a day, or a whole week for a quota), and they decay
            on their own if they go unticked. Where they land in the week is the Rules page's job.
          </p>
        </div>
        <div className="detail-actions">
          <button onClick={() => void materialize()}>Populate Tasks</button>
          <button className="primary-button" onClick={() => setDraft(emptyDraft())}>New recurrence</button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      {status && <p className="muted">{status}</p>}

      {draft && (
        <RecurrenceEditor
          key={draft.id ?? "new"}
          draft={draft}
          tags={tags}
          onCancel={() => setDraft(null)}
          onSave={save}
        />
      )}

      {templates.length === 0
        ? <p className="muted">No recurrences yet.</p>
        : (
          <ul className="recurrence-list">
            {templates.map((template) => (
              <li key={template.id} className="recurrence-row">
                <div>
                  <strong>{template.title}</strong>
                  <span className="muted">
                    {" "}{summarize(template)} · {template.durationMinutes} min ·{" "}
                    {template.autoArchiveHour === null ? "keeps the whole day" : `gone at ${formatHour(template.autoArchiveHour)}`}
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
