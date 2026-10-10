import { spawn } from "node:child_process";
import { resolve } from "node:path";

interface PythonWorkerOptions {
  /** Directory of the `uv` project that owns the worker. */
  directory: string;
  /** Script path relative to `directory`. */
  script: string;
  input: unknown;
  timeoutMs: number;
  /** Shown in errors when the worker fails without a parseable JSON message. */
  label: string;
  /** Extra environment variables merged over `process.env` for the worker process. */
  env?: NodeJS.ProcessEnv;
}

/** Pull `{"error": "..."}` out of a worker's stdout, or null when it isn't that shape. */
function workerError(stdout: string): string | null {
  try {
    return (JSON.parse(stdout) as { error?: string }).error ?? null;
  } catch {
    return null;
  }
}

/**
 * Run a Python worker that follows the repo's process protocol: one JSON request on stdin, one
 * JSON object on stdout, and `{"error": "..."}` + a non-zero exit on failure. Shared by the
 * CP-SAT and Garmin workers so spawn, timeout, and error handling live in one place.
 */
export function runPythonWorker<T>({ directory, script, input, timeoutMs, label, env }: PythonWorkerOptions): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "uv",
      ["run", "--project", directory, "python", resolve(directory, script)],
      { stdio: ["pipe", "pipe", "pipe"], env: env ? { ...process.env, ...env } : process.env },
    );
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        // Prefer the worker's own JSON error message over stderr/stdout noise.
        reject(new Error(workerError(stdout) ?? (stderr.trim() || stdout.trim() || `${label} exited with ${code}`)));
        return;
      }
      try {
        const result = JSON.parse(stdout) as T & { error?: string };
        if (result.error) reject(new Error(result.error));
        else resolvePromise(result);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
