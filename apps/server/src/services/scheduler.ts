import { randomUUID } from "node:crypto";
import type { OrchestrationRepository, ScheduledJob, TaskContext } from "@opencode-task-manager/database";
import type { JsonObject, StateResult } from "@opencode-task-manager/shared";
import type { AppConfig } from "../config.js";
import type { OpenCodeGateway } from "./opencode-gateway.js";

function statePrompt(task: TaskContext, payload: JsonObject, allowedNextStates: string[]): string {
  const resumedContext = payload.userResponse
    ? `\nThe user supplied this response to continue the task:\n${JSON.stringify(payload.userResponse, null, 2)}\n`
    : "";
  return `You are progressing a managed task through its current workflow state.

Task title: ${task.title}
Original request:
${task.initialPrompt}

Worktree intent: ${task.isNewWorktree ? "Create and use a new task-specific git worktree before making workspace changes. During research, identify the target repository and include worktree setup in the proposed write action." : "Use the existing checkout; do not create a new worktree."}

Current state: ${task.state.key} (${task.state.name})
State instructions: ${task.state.promptTemplate ?? "Complete the current state."}
Completion criteria: ${task.state.completionCriteria ?? "Report the outcome clearly."}
Allowed next state keys: ${allowedNextStates.length > 0 ? allowedNextStates.join(", ") : "none"}
${resumedContext}
Do not advance to later workflow work in this run. Respect the current state's permission boundary. Return the requested structured result. If proposing a next state, proposedNextState must contain only one exact key from the allowed list.`;
}

export class Scheduler {
  private readonly workerId = `scheduler-${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly activeExecutions = new Set<number>();

  constructor(
    private readonly config: AppConfig,
    private readonly repository: OrchestrationRepository,
    private readonly gateway: OpenCodeGateway,
  ) {}

  start(): void {
    this.repository.recoverJobs();
    const recoveredTransitions = this.repository.recoverCompletedTransitions();
    if (recoveredTransitions > 0) console.log(`Recovered ${recoveredTransitions} completed workflow transition(s)`);
    this.timer = setInterval(() => void this.tick(), this.config.schedulerIntervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const job = this.repository.claimJob(this.workerId);
      if (!job) return;
      try {
        await this.process(job);
        this.repository.completeJob(job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Scheduled job ${job.id} failed`, error);
        this.repository.retryJob(job, message, Math.min(60, 2 ** job.attempts));
      }
    } finally {
      this.ticking = false;
    }
  }

  private async process(job: ScheduledJob): Promise<void> {
    if (job.kind === "expire_lease") return;
    if (job.kind === "poll_pull_request") return;
    if (job.kind === "reconcile_session") return;
    if (!job.taskId) throw new Error(`Job ${job.id} requires a task`);
    await this.startState(job.taskId, job.payload);
  }

  private async startState(taskId: number, payload: JsonObject): Promise<void> {
    if (this.activeExecutions.has(taskId)) return;
    const task = this.repository.getTaskContext(taskId);
    if (task.lifecycleStatus !== "active" || task.state.terminal) return;
    if (!task.state.promptTemplate) {
      this.repository.setAgentStatus(taskId, "idle");
      return;
    }
    if (this.repository.isBlocked(taskId)) {
      this.repository.setAgentStatus(taskId, "blocked");
      return;
    }

    if (task.state.requiresApproval && !this.repository.consumeApproval(task.id, task.state.id)) {
      this.repository.createApproval(
        task.id,
        null,
        task.state.id,
        "enter_write_state",
        `Allow the agent to enter ${task.state.name} and modify ${task.workspace.directory}`,
        { state: task.state.key, directory: task.workspace.directory },
      );
      return;
    }

    const session = await this.gateway.ensureSession(task);
    const prompt = statePrompt(task, payload, this.repository.listNextStates(task.id).map((state) => state.key));
    const trigger = typeof payload.trigger === "string" ? payload.trigger : "state_entry";
    const runId = this.repository.createRun(task, session, trigger, prompt);
    const resourcesAcquired = this.repository.acquireResources(
      task.id,
      task.state.id,
      runId,
      this.config.resourceLeaseSeconds,
    );
    if (!resourcesAcquired) {
      this.repository.finishRun(runId, "failed", null, "Required resource is currently leased");
      this.repository.setAgentStatus(task.id, "blocked");
      throw new Error("Required resource is currently leased");
    }

    this.activeExecutions.add(task.id);
    void this.execute(task, session, runId, prompt).finally(() => this.activeExecutions.delete(task.id));
  }

  private async execute(
    task: TaskContext,
    session: Awaited<ReturnType<OpenCodeGateway["ensureSession"]>>,
    runId: number,
    prompt: string,
  ): Promise<void> {
    const heartbeat = setInterval(
      () => this.repository.heartbeatRun(runId, this.config.resourceLeaseSeconds),
      Math.max(1000, Math.floor((this.config.resourceLeaseSeconds * 1000) / 3)),
    );
    try {
      const result = await this.gateway.runState(task, session, prompt);
      await this.applyResult(task, runId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.repository.finishRun(runId, "failed", null, message);
      this.repository.setAgentStatus(task.id, "failed");
      console.error(`Agent run ${runId} failed`, error);
    } finally {
      clearInterval(heartbeat);
      this.repository.releaseResources(runId, "run_finished");
    }
  }

  private async applyResult(task: TaskContext, runId: number, result: StateResult): Promise<void> {
    this.repository.addArtifactsFromResult(task.id, runId, result);

    if (result.outcome === "failed") {
      this.repository.finishRun(runId, "failed", result, result.summary);
      this.repository.setAgentStatus(task.id, "failed");
      return;
    }
    if (result.outcome === "needs_input") {
      this.repository.finishRun(runId, "waiting_input", result);
      this.repository.createInteraction(
        task.id,
        runId,
        "question",
        result.question?.prompt ?? "The agent needs more information.",
        { options: result.question?.options ?? [] },
      );
      return;
    }
    if (result.outcome === "blocked") {
      this.repository.finishRun(runId, "succeeded", result);
      this.repository.setAgentStatus(task.id, "blocked");
      return;
    }
    if (result.outcome === "action_proposed" || result.requestedActions.length > 0) {
      this.repository.finishRun(runId, "waiting_approval", result);
      for (const action of result.requestedActions) {
        this.repository.createApproval(task.id, runId, task.state.id, action.type, action.description, action.details);
      }
      return;
    }

    this.repository.finishRun(runId, "succeeded", result);
    const allowedNextStates = this.repository.listNextStates(task.id);
    const proposedState = result.proposedNextState
      ? allowedNextStates.find((state) => state.key === result.proposedNextState)
      : undefined;
    const nextState = proposedState ?? (allowedNextStates.length === 1 ? allowedNextStates[0] : undefined);
    if (!nextState) {
      if (allowedNextStates.length > 1) {
        this.repository.createInteraction(
          task.id,
          runId,
          "question",
          "The agent completed this state but did not select a valid next workflow state.",
          { allowedNextStates: allowedNextStates.map((state) => state.key) },
        );
        return;
      }
      this.repository.setAgentStatus(task.id, "idle");
      return;
    }
    this.repository.transitionTask(task.id, nextState, "agent_result", "agent", result.summary, runId);
    if (!nextState.terminal && (nextState.autoStart || nextState.requiresApproval)) {
      this.repository.enqueueStart(task.id);
    }
  }
}
