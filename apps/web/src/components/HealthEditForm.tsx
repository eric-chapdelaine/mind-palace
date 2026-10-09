import type { FormEvent } from "react";

/**
 * Owner-editing form shared by the health detail pages. Activities expose a title override
 * (Garmin's name stays as the placeholder) plus notes; sleep only exposes notes.
 */
export function HealthEditForm({ heading, hint, title, onTitleChange, titlePlaceholder, notes, onNotesChange, notesPlaceholder, onSubmit, busy }: {
  heading: string;
  hint: string;
  title?: string;
  onTitleChange?: (value: string) => void;
  titlePlaceholder?: string;
  notes: string;
  onNotesChange: (value: string) => void;
  notesPlaceholder: string;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
}) {
  return <form className="task-editor detail-section" onSubmit={onSubmit}>
    <div className="editor-heading"><h2>{heading}</h2><span>{hint}</span></div>
    {onTitleChange && <label>
      Title
      <input value={title ?? ""} placeholder={titlePlaceholder} onChange={(event) => onTitleChange(event.target.value)} />
    </label>}
    <label>
      Notes
      <textarea rows={6} value={notes} placeholder={notesPlaceholder} onChange={(event) => onNotesChange(event.target.value)} />
    </label>
    <div className="button-row">
      <button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button>
    </div>
  </form>;
}
