import type { Tag } from "@mind-palace/shared";

/**
 * Fuzzy match scoring mirroring the web UI's TagPicker (`apps/web/src/components/TagPicker.tsx`)
 * so "search to show the tag you are looking for" behaves identically in the TUI. Positive
 * scores rank matches (higher = better); `-1` means no match.
 */
export function fuzzyScore(title: string, query: string): number {
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

/**
 * Tags matching `query`, ranked best-first like the web picker. Optionally excludes
 * already-selected ids (the picker hides them) and, for parity with the web, archived tags
 * can be hidden too (the dashboard's own tag browser keeps them visible).
 */
export function matchTags(
  tags: readonly Tag[],
  query: string,
  options: { excludeIds?: ReadonlySet<number>; includeArchived?: boolean } = {},
): Tag[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return tags
    .filter((tag) => (options.includeArchived ? true : !tag.isArchived))
    .filter((tag) => (options.excludeIds === undefined ? true : !options.excludeIds.has(tag.id)))
    .map((tag) => ({ tag, score: fuzzyScore(tag.title, trimmed) }))
    .filter((match) => match.score >= 0)
    .sort((a, b) => b.score - a.score || a.tag.title.localeCompare(b.tag.title))
    .map((match) => match.tag);
}