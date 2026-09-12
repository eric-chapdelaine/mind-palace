import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { GlobalEvent, PermissionRuleset } from "@opencode-ai/sdk/v2/types";
import type { OpenCodeSessionRecord, OrchestrationRepository, TaskContext } from "@opencode-task-manager/database";
import { isStateResult, stateResultJsonSchemaFor, type StateResult } from "@opencode-task-manager/shared";
import type { OpenCodeServer } from "./opencode-server.js";
import type { TmuxManager } from "./tmux.js";

const researchPermissions: PermissionRuleset = [
  { permission: "edit", pattern: "*", action: "deny" },
  { permission: "bash", pattern: "git status*", action: "allow" },
  { permission: "bash", pattern: "git diff*", action: "allow" },
  { permission: "bash", pattern: "git log*", action: "allow" },
  { permission: "bash", pattern: "git show*", action: "allow" },
  { permission: "bash", pattern: "rg *", action: "allow" },
  { permission: "bash", pattern: "ls*", action: "allow" },
  { permission: "bash", pattern: "pwd", action: "allow" },
  { permission: "bash", pattern: "*", action: "ask" },
];

const writePermissions: PermissionRuleset = [
  { permission: "edit", pattern: "*", action: "allow" },
  { permission: "bash", pattern: "*", action: "ask" },
];

function model(value: string | null): { providerID: string; modelID: string } | undefined {
  if (!value) return undefined;
  const separator = value.indexOf("/");
  if (separator < 1 || separator === value.length - 1) throw new Error(`Invalid model identifier: ${value}`);
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) };
}

function eventPayload(event: GlobalEvent): GlobalEvent["payload"] {
  return event.payload;
}

export class OpenCodeGateway {
  private readonly client: OpencodeClient;
  private eventAbortController: AbortController | null = null;

  constructor(
    private readonly server: OpenCodeServer,
    private readonly tmux: TmuxManager,
    private readonly repository: OrchestrationRepository,
  ) {
    this.client = createOpencodeClient({ baseUrl: server.endpoint });
  }

  async ensureSession(task: TaskContext): Promise<OpenCodeSessionRecord> {
    const existing = this.repository.getSessionForTask(task.id);
    if (existing) return existing;

    const result = await this.client.session.create(
      {
        directory: task.workspace.directory,
        title: task.title,
        permission: researchPermissions,
        ...(task.agent ? { agent: task.agent } : {}),
      },
      { throwOnError: true },
    );
    const nativeSession = result.data;
    if (!nativeSession) throw new Error("OpenCode did not return a session");
    const target = this.tmux.ensureTaskWindow(task, nativeSession.id);
    return this.repository.createSession({
      taskId: task.id,
      serverId: this.server.id,
      nativeSessionId: nativeSession.id,
      title: task.title,
      directory: task.workspace.directory,
      model: task.model,
      agent: task.agent,
      tmuxSession: target.session,
      tmuxWindow: target.window,
    });
  }

  async runState(task: TaskContext, session: OpenCodeSessionRecord, prompt: string): Promise<StateResult> {
    const writable = task.state.executionClass === "workspace_write" || task.state.executionClass === "external_write";
    if (writable) {
      await this.client.session.update(
        {
          sessionID: session.nativeSessionId,
          directory: session.directory,
          permission: writePermissions,
        },
        { throwOnError: true },
      );
    }

    const selectedModel = model(task.model);
    const tools = task.state.executionClass === "research" ? await this.researchTools(task) : undefined;
    const response = await this.client.session.prompt(
      {
        sessionID: session.nativeSessionId,
        directory: session.directory,
        parts: [{ type: "text", text: prompt }],
        format: {
          type: "json_schema",
          schema: stateResultJsonSchemaFor(this.repository.listNextStates(task.id).map((state) => state.key)),
          retryCount: 2,
        },
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(task.agent ? { agent: task.agent } : {}),
        ...(tools ? { tools } : {}),
      },
      { throwOnError: true },
    );
    const structured = response.data?.info.structured;
    if (!isStateResult(structured)) throw new Error("OpenCode returned an invalid state result");
    return structured;
  }

  private async researchTools(task: TaskContext): Promise<Record<string, boolean>> {
    const response = await this.client.tool.ids(
      { directory: task.workspace.directory },
      { throwOnError: true },
    );
    const available = response.data ?? [];
    const prompt = task.initialPrompt.toLowerCase();
    const needsData = /\b(how (many|often)|count|rate|percent|data|database|sql|snowflake|metabase|production|patients?|customers?|records?|claims?)\b/.test(prompt);
    const needsObservability = /\b(datadog|logs?|traces?|metrics?|monitors?|incidents?|errors?|apm|rum)\b/.test(prompt);
    const needsLaunchDarkly = /\b(launchdarkly|feature flags?|session replay)\b/.test(prompt);
    const needsNotion = /\b(notion|meeting notes?)\b/.test(prompt);

    return Object.fromEntries(
      available.map((tool) => {
        const core = ["question", "read", "glob", "grep", "bash", "webfetch", "skill"].includes(tool);
        const qmd = tool.startsWith("qmd_") || tool.startsWith("mcp__qmd__");
        const data = needsData && (tool.startsWith("snowflake_") || tool.startsWith("metabase_"));
        const observability = needsObservability && tool.startsWith("datadog_");
        const launchDarkly = needsLaunchDarkly && tool.startsWith("launchdarkly_");
        const notion = needsNotion && tool.startsWith("notion_");
        return [tool, core || qmd || data || observability || launchDarkly || notion];
      }),
    );
  }

  async replyToInteraction(interaction: {
    kind: "question" | "permission";
    nativeRequestId: string | null;
    request: Record<string, unknown>;
  }, directory: string, response: unknown): Promise<boolean> {
    if (!interaction.nativeRequestId) return false;
    if (interaction.kind === "permission") {
      const reply = response === "always" || response === "reject" ? response : "once";
      await this.client.permission.reply(
        { requestID: interaction.nativeRequestId, directory, reply },
        { throwOnError: true },
      );
      return true;
    }
    const answers = Array.isArray(response)
      ? response.map((answer) => (Array.isArray(answer) ? answer.map(String) : [String(answer)]))
      : [[String(response)]];
    await this.client.question.reply(
      { requestID: interaction.nativeRequestId, directory, answers },
      { throwOnError: true },
    );
    return true;
  }

  async abort(session: OpenCodeSessionRecord): Promise<void> {
    await this.client.session.abort(
      { sessionID: session.nativeSessionId, directory: session.directory },
      { throwOnError: true },
    );
  }

  startEventListener(): void {
    if (this.eventAbortController) return;
    this.eventAbortController = new AbortController();
    void this.listen(this.eventAbortController.signal);
  }

  stopEventListener(): void {
    this.eventAbortController?.abort();
    this.eventAbortController = null;
  }

  private async listen(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const events = await this.client.global.event({ signal });
        for await (const event of events.stream) {
          if (signal.aborted) break;
          this.handleEvent(event);
        }
      } catch (error) {
        if (signal.aborted) return;
        console.error("OpenCode event stream disconnected", error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private handleEvent(event: GlobalEvent): void {
    const payload = eventPayload(event);
    if (payload.type === "session.status") {
      this.repository.updateSessionStatus(payload.properties.sessionID, payload.properties.status.type);
      return;
    }
    if (payload.type !== "question.asked" && payload.type !== "permission.asked") return;

    const session = this.repository.findSessionByNativeId(payload.properties.sessionID);
    if (!session) return;
    const run = this.repository.getActiveRun(session.taskId);
    if (payload.type === "question.asked") {
      this.repository.createInteraction(
        session.taskId,
        run?.id ?? null,
        "question",
        payload.properties.questions.map((question) => question.question).join("\n"),
        payload.properties as unknown as Record<string, unknown>,
        payload.properties.id,
      );
      return;
    }
    this.repository.createInteraction(
      session.taskId,
      run?.id ?? null,
      "permission",
      `Permission requested: ${payload.properties.permission}`,
      payload.properties as unknown as Record<string, unknown>,
      payload.properties.id,
    );
  }
}
