import { useState, type FormEvent } from "react";
import type { CreateTaskInput, Tag } from "@opencode-task-manager/shared";
import { TagPicker } from "./TagPicker";

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
  const [busy, setBusy] = useState(false);

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onCreateTask({ title, description, priority, durationMinutes: durationMinutes ? Number(durationMinutes) : null, splittable, tagIds, startImmediately: false });
      setTitle("");
      setDescription("");
      setDurationMinutes("");
      setTagIds([]);
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
        <div className="form-pair"><label>Priority<input type="number" value={priority} onChange={(event) => setPriority(Number(event.target.value))} /></label><label>Time estimate (minutes)<input type="number" min="1" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} placeholder="Optional" /></label></div>
        <label>Tags<TagPicker tags={tags} selectedIds={tagIds} onChange={setTagIds} onCreateTag={onCreateTag} /></label>
        <label className="checkbox-field"><input type="checkbox" checked={splittable} onChange={(event) => setSplittable(event.target.checked)} /><span>Can split across sessions</span></label>
        <button className="primary-button" disabled={busy}>{busy ? "Creating..." : "Add task"}</button>
      </form>
    </aside>
  );
}
