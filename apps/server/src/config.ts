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
  /**
   * The origin browsers actually reach the server on, used to build OAuth redirect URIs.
   * `HOST` cannot serve this purpose: production binds `0.0.0.0`, which Google rejects as a
   * redirect target. Set `PUBLIC_BASE_URL` (e.g. `http://rpi:4310` or a Tailscale name) when the
   * server is not reached at `127.0.0.1:4310`.
   */
  publicBaseUrl: string;
}

export function loadConfig(): AppConfig {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: positiveInteger(process.env.PORT, 4310),
    databasePath: process.env.DATABASE_PATH
      ? resolve(process.env.DATABASE_PATH)
      : resolve(projectRoot, "data/mind-palace.db"),
    publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:4310").replace(/\/$/, ""),
  };
}