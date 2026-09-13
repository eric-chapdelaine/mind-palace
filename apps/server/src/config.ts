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
}

export function loadConfig(): AppConfig {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: positiveInteger(process.env.PORT, 4310),
    databasePath: process.env.DATABASE_PATH
      ? resolve(process.env.DATABASE_PATH)
      : resolve(projectRoot, "data/mind-palace.db"),
  };
}