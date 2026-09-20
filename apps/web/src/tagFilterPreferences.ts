// Dashboard tag-filter persistence: the included/excluded tag selections live in
// cookies so they survive browser sessions. Storage format is one cookie per list,
// holding a comma-separated list of numeric tag ids. All parsing/serialization
// lives here as small pure functions; pages read on mount and write on change.

const INCLUDED_COOKIE = "mind-palace-included-tag-ids";
const EXCLUDED_COOKIE = "mind-palace-excluded-tag-ids";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

function parseIds(value: string | null): number[] {
  if (!value) return [];
  const ids: number[] = [];
  for (const part of value.split(",")) {
    const id = Number(part);
    if (Number.isInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split("; ")) {
    const equals = part.indexOf("=");
    if (equals < 0) continue;
    if (part.slice(0, equals) === name) return decodeURIComponent(part.slice(equals + 1));
  }
  return null;
}

function writeCookie(name: string, ids: number[]) {
  document.cookie = `${name}=${encodeURIComponent(ids.join(","))}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

export function readTagFilterPreferences(): { includedTagIds: number[]; excludedTagIds: number[] } {
  return {
    includedTagIds: parseIds(readCookie(INCLUDED_COOKIE)),
    excludedTagIds: parseIds(readCookie(EXCLUDED_COOKIE)),
  };
}

export function writeTagFilterPreferences(includedTagIds: number[], excludedTagIds: number[]) {
  writeCookie(INCLUDED_COOKIE, includedTagIds);
  writeCookie(EXCLUDED_COOKIE, excludedTagIds);
}