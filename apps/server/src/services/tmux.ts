import { spawnSync } from "node:child_process";
import type { OpenCodeSessionRecord, TaskContext } from "@opencode-task-manager/database";

function runTmux(args: string[], tolerateFailure = false): string {
  const result = spawnSync("tmux", args, { encoding: "utf8" });
  if (!tolerateFailure && result.status !== 0) {
    throw new Error(result.stderr.trim() || `tmux ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

export class TmuxManager {
  constructor(
    private readonly sessionName: string,
    private readonly openCodeCommand: string,
    private readonly endpoint: string,
  ) {}

  ensureTaskWindow(task: TaskContext, nativeSessionId: string): { session: string; window: string } {
    const window = `task-${task.id}`;
    if (runTmux(["has-session", "-t", this.sessionName], true) === "") {
      const exists = spawnSync("tmux", ["has-session", "-t", this.sessionName]).status === 0;
      if (!exists) runTmux(["new-session", "-d", "-s", this.sessionName, "-n", "manager"]);
    }

    const windows = runTmux(["list-windows", "-t", this.sessionName, "-F", "#{window_name}"], true).split("\n");
    if (!windows.includes(window)) {
      runTmux([
        "new-window", "-d", "-t", this.sessionName, "-n", window,
        this.openCodeCommand, "attach", this.endpoint, "--session", nativeSessionId, "--dir", task.workspace.directory,
      ]);
    }
    return { session: this.sessionName, window };
  }

  attachCommand(session: OpenCodeSessionRecord): string | null {
    if (!session.tmuxSession || !session.tmuxWindow) return null;
    return `tmux attach-session -t ${session.tmuxSession} \\; select-window -t ${session.tmuxSession}:${session.tmuxWindow}`;
  }
}
