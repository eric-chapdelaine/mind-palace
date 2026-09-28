import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * TUI-local preferences. The web app keeps tag filters in cookies; the TUI keeps them (plus
 * the tag rank order, which has no database column — tags sort by title upstream) in one JSON
 * file. Override the location with `MP_TUI_CONFIG`, the API base with `MP_API_URL`.
 */
export interface TuiConfig {
  apiUrl: string;
  /** Tag display order: tag ids, first = top of the tags section. Unknown ids append at the end. */
  tagOrder: number[];
  /** Whitelist: when non-empty, only tasks carrying one of these tags show. */
  includedTagIds: number[];
  /** Blacklist: tasks carrying any of these tags are hidden (wins over include). */
  excludedTagIds: number[];
}

const envApiUrl = process.env.MP_API_URL?.trim();

export function configPath(): string {
  if (process.env.MP_TUI_CONFIG) return process.env.MP_TUI_CONFIG;
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "mind-palace", "tui.json");
}

function idList(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
}

export function loadConfig(): TuiConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<TuiConfig>;
    return {
      apiUrl: envApiUrl ?? (typeof raw.apiUrl === "string" && raw.apiUrl ? raw.apiUrl : "http://127.0.0.1:4310"),
      tagOrder: idList(raw.tagOrder),
      includedTagIds: idList(raw.includedTagIds),
      excludedTagIds: idList(raw.excludedTagIds),
    };
  } catch {
    return { apiUrl: envApiUrl ?? "http://127.0.0.1:4310", tagOrder: [], includedTagIds: [], excludedTagIds: [] };
  }
}

/** Best-effort write; a read-only home dir must never crash the TUI. */
export function saveConfig(config: TuiConfig): void {
  try {
    const file = configPath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } catch {
    // ignore
  }
}