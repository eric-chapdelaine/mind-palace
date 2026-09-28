import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const editorName = process.env.VISUAL ?? process.env.EDITOR ?? "nvim";

/**
 * Open `$VISUAL`/`$EDITOR` (defaults to neovim) on a temp file seeded with `initial`; resolve
 * with the file's contents when the editor exits successfully. The caller is responsible for
 * suspending the TUI's alternate screen around this call (see `App.withSuspended`).
 */
export async function editInEditor(initial: string, hint: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "mind-palace-"));
  const file = join(dir, hint);
  writeFileSync(file, initial, "utf8");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(editorName, [file], { stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${editorName} exited with code ${code}`));
      });
    });
    return readFileSync(file, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}