import { useState, type FormEvent } from "react";
import { kanbanStatuses, priorities, type Priority, type Tag, type TaskDetail, type UpdateTaskInput } from "@mind-palace/shared";
import { TagPicker } from "./TagPicker";
import { toIsoInstant, toLocalDateTimeInput } from "../lib/datetime";

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
  const [remaining, setRemaining] = useState(task.durationMinutesRemaining === null ? "" : String(task.durationMinutesRemaining));
  const [splittable, setSplittable] = useState(task.splittable);
  const [earliestStart, setEarliestStart] = useState(toLocalDateTimeInput(task.earliestStart));
  const [deadlineAt, setDeadlineAt] = useState(toLocalDateTimeInput(task.deadlineAt));
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
        durationMinutesRemaining: remaining ? Number(remaining) : null,
        splittable,
        earliestStart: toIsoInstant(earliestStart),
        deadlineAt: toIsoInstant(deadlineAt),
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
      <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}>
        {(priorities.includes(task.priority as Priority) ? priorities : [...priorities, task.priority]).map((level) =>
          <option key={level} value={level}>P{level}</option>)}
      </select></label>
    </div>
    <label>Time remaining (minutes)<input type="number" min="0" placeholder="Optional" value={remaining} onChange={(event) => setRemaining(event.target.value)} /></label>
    <label>Tags<TagPicker tags={tags} selectedIds={tagIds} onChange={setTagIds} /></label>
    <div className="form-pair">
      <label>Earliest start<input type="datetime-local" value={earliestStart} onChange={(event) => setEarliestStart(event.target.value)} /></label>
      <label>Deadline<input type="datetime-local" value={deadlineAt} onChange={(event) => setDeadlineAt(event.target.value)} /></label>
    </div>
    <label className="checkbox-field"><input type="checkbox" checked={splittable} onChange={(event) => setSplittable(event.target.checked)} /><span>Can split across sessions</span></label>
    <div className="button-row"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}
