import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received ${value}`);
  return parsed;
}

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  openCodeHost: string;
  openCodePort: number;
  openCodeCommand: string;
  tmuxSession: string;
  schedulerIntervalMs: number;
  resourceLeaseSeconds: number;
  prPollIntervalSeconds: number;
}

export function loadConfig(): AppConfig {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: positiveInteger(process.env.PORT, 4310),
    databasePath: process.env.DATABASE_PATH
      ? resolve(process.env.DATABASE_PATH)
      : resolve(projectRoot, "data/opencode-task-manager.db"),
    openCodeHost: process.env.OPENCODE_HOST ?? "127.0.0.1",
    openCodePort: positiveInteger(process.env.OPENCODE_PORT, 4096),
    openCodeCommand: process.env.OPENCODE_COMMAND ?? "opencode",
    tmuxSession: process.env.TMUX_SESSION ?? "opencode-manager",
    schedulerIntervalMs: positiveInteger(process.env.SCHEDULER_INTERVAL_MS, 1000),
    resourceLeaseSeconds: positiveInteger(process.env.RESOURCE_LEASE_SECONDS, 90),
    prPollIntervalSeconds: positiveInteger(process.env.PR_POLL_INTERVAL_SECONDS, 300),
  };
}
