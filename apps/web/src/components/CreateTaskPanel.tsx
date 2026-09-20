import { useEffect, useState, type FormEvent } from "react";
import { reservedTagPublicIds, type CreateTaskInput, type Tag, type TimeBlockType } from "@mind-palace/shared";
import { TagPicker } from "./TagPicker";

// ---- Tag-driven Quick-capture modes (the expandable registry) ----
//
// Selecting a reserved tag can unlock extra fields in Quick capture. Each mode declares the
// tag it keys off and the time block kind it produces; the panel renders its fields and the
// task-creation payload carries the block. Add a mode here and teach the backend about its
// time block type to grow into new commitment kinds.
interface QuickCaptureMode {
  tagPublicId: string;
  /** "time-range": author the task's block window directly (linked start / end / duration fields). */
  kind: "time-range";
  timeBlockType: TimeBlockType;
}

const QUICK_CAPTURE_MODES: QuickCaptureMode[] = [
  { tagPublicId: reservedTagPublicIds.calendarEvent, kind: "time-range", timeBlockType: "calendar_event" },
];

/** datetime-local input value for a Date. */
function toInputValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

function minutesBetween(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
}

function addMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return toInputValue(date);
}

interface Props {
  tags: Tag[];
  onCreateTask: (input: CreateTaskInput) => Promise<void>;
  onCreateTag: (title: string) => Promise<Tag>;
}

export function CreateTaskPanel({ tags, onCreateTask, onCreateTag }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [splittable, setSplittable] = useState(false);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedTagIds = new Set(tagIds);
  const activeMode = QUICK_CAPTURE_MODES.find((mode) =>
    tags.some((tag) => selectedTagIds.has(tag.id) && tag.publicId === mode.tagPublicId),
  );

  // A deselected mode's range fields are cleared so a later task never inherits a stale window.
  useEffect(() => {
    if (!activeMode) {
      setTimeStart("");
      setTimeEnd("");
    }
  }, [activeMode]);

  function changeStart(value: string) {
    setTimeStart(value);
    if (timeEnd) {
      setDurationMinutes(String(minutesBetween(value, timeEnd)));
    } else if (durationMinutes) {
      setTimeEnd(addMinutes(value, Number(durationMinutes)));
    }
  }

  function changeEnd(value: string) {
    setTimeEnd(value);
    if (timeStart) setDurationMinutes(String(minutesBetween(timeStart, value)));
  }

  function changeDuration(value: string) {
    setDurationMinutes(value);
    // Keep the end time in sync: typing a duration derives the window's other edge.
    if (timeStart && value) setTimeEnd(addMinutes(timeStart, Number(value)));
  }

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      if (activeMode) {
        if (!timeStart || !timeEnd) throw new Error("Pick a start and end time for the calendar event");
        if (new Date(timeEnd) <= new Date(timeStart)) throw new Error("End time must be after start time");
      }
      await onCreateTask({
        title,
        description,
        priority,
        // A calendar event's whole window becomes its time block, so no time remains on the task.
        durationMinutesRemaining: activeMode ? 0 : durationMinutes ? Number(durationMinutes) : null,
        splittable,
        tagIds,
        ...(activeMode ? { timeBlock: { startAt: toIso(timeStart), endAt: toIso(timeEnd), type: activeMode.timeBlockType } } : {}),
      });
      setTitle("");
      setDescription("");
      setDurationMinutes("");
      setTagIds([]);
      setTimeStart("");
      setTimeEnd("");
    } catch (nextError) {
      setFormError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="create-panel">
      <div className="section-label">Quick capture</div>
      <h2>Add to the palace.</h2>
      <form onSubmit={submitTask}>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to happen?" required /></label>
        <label>Notes<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Context, outcome, or constraints" /></label>
        <div className="form-pair">
          <label>Priority<input type="number" value={priority} onChange={(event) => setPriority(Number(event.target.value))} /></label>
          <label>{activeMode ? "Duration (minutes)" : "Time remaining (minutes)"}
            <input
              type="number"
              min="1"
              value={durationMinutes}
              onChange={(event) => (activeMode ? changeDuration(event.target.value) : setDurationMinutes(event.target.value))}
              placeholder={activeMode ? "Auto-fills from the window" : "Optional"}
            />
          </label>
        </div>
        {activeMode && (
          <div className="form-section">
            <div className="form-pair form-pair-stack">
              <label>Start time<input type="datetime-local" value={timeStart} onChange={(event) => changeStart(event.target.value)} required /></label>
              <label>End time<input type="datetime-local" value={timeEnd} onChange={(event) => changeEnd(event.target.value)} required /></label>
            </div>
            <p className="muted form-hint">This window becomes the task's calendar time block; the task itself keeps 0 minutes remaining.</p>
          </div>
        )}
        <label>Tags<TagPicker tags={tags} selectedIds={tagIds} onChange={setTagIds} onCreateTag={onCreateTag} /></label>
        <label className="checkbox-field"><input type="checkbox" checked={splittable} onChange={(event) => setSplittable(event.target.checked)} /><span>Can split across sessions</span></label>
        {formError && <div className="form-error">{formError}</div>}
        <button className="primary-button" disabled={busy}>{busy ? "Creating..." : "Add task"}</button>
      </form>
    </aside>
  );
}