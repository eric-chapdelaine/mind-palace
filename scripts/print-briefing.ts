/**
 * Print today's briefing — the one-command version of `GET /api/briefing`.
 *
 *   pnpm briefing                 # today, to the default printer
 *   pnpm briefing --date 2026-10-23
 *   pnpm briefing --out /tmp/x.pdf
 *
 * Talks to the running server over HTTP rather than to the database, so it prints exactly the page
 * the browser would show. `lp` handles the queue; the PDF is written to a temp file first so a CUPS
 * failure does not lose the page.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const base = process.env.MIND_PALACE_URL ?? "http://127.0.0.1:4310";
  const date = arg("date");
  const out = arg("out");
  const printer = arg("printer");
  const query = date === undefined ? "" : `?date=${encodeURIComponent(date)}`;

  const response = await fetch(`${base}/api/briefing${query}`);
  if (!response.ok) throw new Error(`briefing failed: ${response.status} ${await response.text()}`);
  const pdf = Buffer.from(await response.arrayBuffer());

  if (out !== undefined) {
    await writeFile(out, pdf);
    console.log(`wrote ${out} (${response.headers.get("x-briefing-pages") ?? "?"} page)`);
    return;
  }

  const directory = await mkdtemp(join(tmpdir(), "briefing-"));
  const path = join(directory, "briefing.pdf");
  try {
    await writeFile(path, pdf);
    const args = printer === undefined ? [path] : ["-d", printer, path];
    const { stdout } = await run("lp", args);
    console.log(stdout.trim());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
