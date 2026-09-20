import type { TaskDetail, TimeBlock, UpdateTimeBlockInput } from "@mind-palace/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "./api";

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function TimeBlockPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const [block, setBlock] = useState<TimeBlock | null>(null);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const nextBlock = await api.timeBlock(id);
      setBlock(nextBlock);
      setTask(await api.task(nextBlock.taskId));
      setStartAt(toLocalDateTime(nextBlock.startAt));
      setEndAt(toLocalDateTime(nextBlock.endAt));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const nextStart = toIso(startAt);
      const nextEnd = toIso(endAt);
      if (nextStart && nextEnd && new Date(nextEnd) <= new Date(nextStart)) {
        throw new Error("End time must be after start time");
      }
      const input: UpdateTimeBlockInput = {
        ...(nextStart ? { startAt: nextStart } : {}),
        ...(nextEnd ? { endAt: nextEnd } : {}),
      };
      const saved = await api.updateTimeBlock(id, input);
      setBlock(saved);
      setTask(await api.task(saved.taskId));
      setStartAt(toLocalDateTime(saved.startAt));
      setEndAt(toLocalDateTime(saved.endAt));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function deleteBlock() {
    if (!block) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteTimeBlock(id);
      navigate(`/tasks/${block.taskId}`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      setBusy(false);
    }
  }

  if (!block || !task) {
    return <main className="detail-shell">{error ? <div className="error-banner">{error}</div> : <p>Loading...</p>}</main>;
  }

  return (
    <main className="detail-shell">
      <nav className="detail-nav">
        <Link to={`/tasks/${task.id}`}>Back to {task.title}</Link>
        <span>{block.publicId.slice(0, 8)}</span>
      </nav>
      {error && <div className="error-banner">{error}</div>}
      <header className="detail-header">
        <div>
          <div className="task-card-topline">
            <span className="task-type">{block.type.replace("_", " ")} block · {block.status}</span>
          </div>
          <h1>{task.title}</h1>
          <p className="muted">
            {block.type === "calendar_event"
              ? "A calendar event keeps 0 minutes remaining — this block is the whole commitment."
              : "Editing the window moves time in or out of the task's remaining estimate."}
          </p>
        </div>
        <div className="detail-actions">
          <button className="mini-block-delete" onClick={() => void deleteBlock()} disabled={busy}>Delete block</button>
        </div>
      </header>
      <form className="task-editor detail-section" onSubmit={save}>
        <div className="editor-heading"><h2>Edit time block</h2><span>Start and end are stored as exact instants.</span></div>
        <div className="form-pair">
          <label>Start time<input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} required /></label>
          <label>End time<input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} required /></label>
        </div>
        <div className="button-row">
          <button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button>
          <button type="button" onClick={() => { setStartAt(toLocalDateTime(block.startAt)); setEndAt(toLocalDateTime(block.endAt)); setError(null); }}>Cancel</button>
        </div>
      </form>
    </main>
  );
}