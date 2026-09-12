import { spawn, type ChildProcess } from "node:child_process";
import type { OrchestrationRepository } from "@opencode-task-manager/database";
import type { AppConfig } from "../config.js";

interface HealthResponse {
  healthy: boolean;
  version: string;
}

export class OpenCodeServer {
  readonly endpoint: string;
  private child: ChildProcess | null = null;
  private serverId: number | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly repository: OrchestrationRepository,
  ) {
    this.endpoint = `http://${config.openCodeHost}:${config.openCodePort}`;
  }

  async ensureRunning(): Promise<number> {
    const existingHealth = await this.health();
    if (existingHealth) {
      this.serverId = this.repository.upsertServer(this.endpoint, null, existingHealth.version);
      return this.serverId;
    }

    this.child = spawn(
      this.config.openCodeCommand,
      ["serve", "--hostname", this.config.openCodeHost, "--port", String(this.config.openCodePort)],
      { stdio: "ignore", detached: false },
    );

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const health = await this.health();
      if (health) {
        this.serverId = this.repository.upsertServer(this.endpoint, this.child.pid ?? null, health.version);
        return this.serverId;
      }
      if (this.child.exitCode !== null) break;
    }

    throw new Error(`OpenCode server did not become healthy at ${this.endpoint}`);
  }

  get id(): number {
    if (this.serverId === null) throw new Error("OpenCode server has not been started");
    return this.serverId;
  }

  stop(): void {
    this.child?.kill("SIGTERM");
    this.child = null;
  }

  private async health(): Promise<HealthResponse | null> {
    try {
      const response = await fetch(`${this.endpoint}/global/health`, { signal: AbortSignal.timeout(750) });
      if (!response.ok) return null;
      const body = (await response.json()) as HealthResponse;
      return body.healthy ? body : null;
    } catch {
      return null;
    }
  }
}
