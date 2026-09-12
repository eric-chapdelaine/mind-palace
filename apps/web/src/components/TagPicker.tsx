import { useState, type KeyboardEvent } from "react";
import type { Tag } from "@opencode-task-manager/shared";

function fuzzyScore(title: string, query: string): number {
  const candidate = title.toLowerCase();
  const needle = query.toLowerCase();
  if (candidate === needle) return 1_000;
  if (candidate.startsWith(needle)) return 750 - candidate.length;
  const includedAt = candidate.indexOf(needle);
  if (includedAt >= 0) return 500 - includedAt - candidate.length;
  let position = -1;
  let gaps = 0;
  for (const character of needle) {
    const next = candidate.indexOf(character, position + 1);
    if (next < 0) return -1;
    gaps += next - position - 1;
    position = next;
  }
  return 250 - gaps - candidate.length;
}

export function TagPicker({ tags, selectedIds, onChange, onCreateTag }: {
  tags: Tag[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  onCreateTag?: (title: string) => Promise<Tag>;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = selectedIds.map((id) => tags.find((tag) => tag.id === id)).filter((tag): tag is Tag => Boolean(tag));
  const matches = query.trim()
    ? tags
      .filter((tag) => !selectedIds.includes(tag.id))
      .map((tag) => ({ tag, score: fuzzyScore(tag.title, query.trim()) }))
      .filter((match) => match.score >= 0)
      .sort((a, b) => b.score - a.score || a.tag.title.localeCompare(b.tag.title))
      .slice(0, 6)
    : [];

  function select(tag: Tag) {
    onChange([...selectedIds, tag.id]);
    setQuery("");
  }

  async function accept(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !query.trim()) return;
    event.preventDefault();
    if (matches[0]) return select(matches[0].tag);
    if (!onCreateTag) return;
    setBusy(true);
    try {
      select(await onCreateTag(query.trim()));
    } finally {
      setBusy(false);
    }
  }

  return <div className="tag-picker">
    {selected.length > 0 && <div className="selected-tags">{selected.map((tag) => <button type="button" key={tag.id} onClick={() => onChange(selectedIds.filter((id) => id !== tag.id))}>{tag.title} <span aria-hidden="true">x</span></button>)}</div>}
    <input role="combobox" aria-expanded={matches.length > 0} aria-controls="tag-results" value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => void accept(event)} placeholder="Type to find or create a tag" />
    {matches.length > 0 && <div className="tag-results" id="tag-results">{matches.map(({ tag }) => <button type="button" key={tag.id} onClick={() => select(tag)}>{tag.title}</button>)}</div>}
  </div>;
}
