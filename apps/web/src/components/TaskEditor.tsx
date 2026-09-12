import { useState, type FormEvent } from "react";
import { kanbanStatuses, type Tag, type TaskDetail, type UpdateTaskInput } from "@opencode-task-manager/shared";
import { TagPicker } from "./TagPicker";

function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function TaskEditor({ task, tags, onSave, onCancel }: {
  task: TaskDetail;
  tags: Tag[];
  onSave: (input: UpdateTaskInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState(task.kanbanStatus);
  const [priority, setPriority] = useState(String(task.priority));
  const [duration, setDuration] = useState(task.durationMinutes === null ? "" : String(task.durationMinutes));
  const [splittable, setSplittable] = useState(task.splittable);
  const [earliestStart, setEarliestStart] = useState(toLocalDateTime(task.earliestStart));
  const [deadlineAt, setDeadlineAt] = useState(toLocalDateTime(task.deadlineAt));
  const [fixedStart, setFixedStart] = useState(toLocalDateTime(task.fixedStart));
  const [fixedEnd, setFixedEnd] = useState(toLocalDateTime(task.fixedEnd));
  const [tagIds, setTagIds] = useState(task.tags.map((tag) => tag.id));
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave({
        title,
        description: description || null,
        kanbanStatus: status,
        priority: Number(priority),
        durationMinutes: duration ? Number(duration) : null,
        splittable,
        earliestStart: toIso(earliestStart),
        deadlineAt: toIso(deadlineAt),
        fixedStart: toIso(fixedStart),
        fixedEnd: toIso(fixedEnd),
        tagIds,
      });
    } finally {
      setBusy(false);
    }
  }

  return <form className="task-editor detail-section" onSubmit={submit}>
    <div className="editor-heading"><h2>Edit task</h2><span>Descriptions support Markdown.</span></div>
    <label>Title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>Description<textarea rows={8} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="form-pair">
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{kanbanStatuses.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}</select></label>
      <label>Priority<input type="number" value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
    </div>
    <label>Time estimate (minutes)<input type="number" min="1" placeholder="Optional" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
    <label>Tags<TagPicker tags={tags} selectedIds={tagIds} onChange={setTagIds} /></label>
    <div className="form-pair">
      <label>Earliest start<input type="datetime-local" value={earliestStart} onChange={(event) => setEarliestStart(event.target.value)} /></label>
      <label>Deadline<input type="datetime-local" value={deadlineAt} onChange={(event) => setDeadlineAt(event.target.value)} /></label>
      <label>Fixed start<input type="datetime-local" value={fixedStart} onChange={(event) => setFixedStart(event.target.value)} /></label>
      <label>Fixed end<input type="datetime-local" value={fixedEnd} onChange={(event) => setFixedEnd(event.target.value)} /></label>
    </div>
    <label className="checkbox-field"><input type="checkbox" checked={splittable} onChange={(event) => setSplittable(event.target.checked)} /><span>Can split across sessions</span></label>
    <div className="button-row"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}
