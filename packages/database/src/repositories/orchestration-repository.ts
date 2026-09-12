import { randomUUID } from "node:crypto";
import type {
  AgentRun,
  AgentStatus,
  ApprovalRequest,
  Artifact,
  AutomationPolicy,
  CreateDependencyInput,
  CreateResourceRequirementInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  InteractionRequest,
  JsonObject,
  KanbanStatus,
  LifecycleStatus,
  RecurrenceRule,
  StateOutcome,
  StateResult,
  StateTransition,
  TaskDependency,
  TaskDetail,
  TaskSummary,
  TaskType,
  TimeBlock,
  Tag,
  Workflow,
  WorkflowState,
  Workspace,
} from "@opencode-task-manager/shared";
import { Database } from "../database.js";
import { boolean, integer, json, nullableText, row, text, type Row } from "../rows.js";

export interface TaskContext {
  id: number;
  publicId: string;
  taskType: TaskType;
  title: string;
  initialPrompt: string;
  workflowId: number;
  state: WorkflowState;
  workspace: Workspace;
  lifecycleStatus: LifecycleStatus;
  agentStatus: AgentStatus;
  automationPolicy: AutomationPolicy;
  model: string | null;
  agent: string | null;
  isNewWorktree: boolean;
}

export interface ScheduledJob {
  id: number;
  taskId: number | null;
  kind: "start_state" | "poll_pull_request" | "reconcile_session" | "expire_lease";
  payload: JsonObject;
  attempts: number;
  maxAttempts: number;
}

export interface OpenCodeSessionRecord {
  id: number;
  taskId: number;
  serverId: number;
  nativeSessionId: string;
  directory: string;
  tmuxSession: string | null;
  tmuxWindow: string | null;
}

export interface AgentRunRecord {
  id: number;
  taskId: number;
  workflowStateId: number;
  sessionRecordId: number;
  status: string;
}

const taskSummarySql = String.raw`
  SELECT
    t.id, t.public_id, t.title, w.task_type, w.key AS workflow_key, w.version AS workflow_version,
    s.key AS workflow_state, s.name AS workflow_state_name,
    t.lifecycle_status, t.kanban_status, t.agent_status, t.priority, t.rank, t.description,
    t.duration_minutes, t.duration_estimated, t.splittable, t.earliest_start, t.deadline_at, t.fixed_start, t.fixed_end, t.completed_at,
    t.parent_task_id, t.automation_enabled, t.origin, t.is_new_worktree,
    ws.name AS workspace_name, ws.directory, t.updated_at,
    COALESCE((SELECT json_group_array(json_object(
      'id', tag.id, 'publicId', tag.public_id, 'title', tag.title, 'description', tag.description,
      'reserved', CASE WHEN tag.public_id LIKE 'mind-palace:%' THEN json('true') ELSE json('false') END
    )) FROM task_tags task_tag JOIN tags tag ON tag.id = task_tag.tag_id WHERE task_tag.task_id = t.id), '[]') AS tags_json,
    COALESCE((WITH RECURSIVE ancestors(id) AS (
      SELECT relation.parent_tag_id FROM task_tags direct JOIN tag_parents relation ON relation.child_tag_id = direct.tag_id WHERE direct.task_id = t.id
      UNION
      SELECT relation.parent_tag_id FROM tag_parents relation JOIN ancestors ON relation.child_tag_id = ancestors.id
    ) SELECT json_group_array(json_object(
      'id', tag.id, 'publicId', tag.public_id, 'title', tag.title, 'description', tag.description,
      'reserved', CASE WHEN tag.public_id LIKE 'mind-palace:%' THEN json('true') ELSE json('false') END
    )) FROM ancestors JOIN tags tag ON tag.id = ancestors.id), '[]') AS derived_tags_json,
    (SELECT COUNT(*) FROM approval_requests a WHERE a.task_id = t.id AND a.status = 'pending') AS open_approval_count,
    (SELECT COUNT(*) FROM interaction_requests i WHERE i.task_id = t.id AND i.status = 'pending') AS open_interaction_count,
    (SELECT COUNT(*) FROM task_dependencies d WHERE d.task_id = t.id AND d.satisfied_at IS NULL) AS blocked_by_count
  FROM tasks t
  JOIN workflow_definitions w ON w.id = t.workflow_id
  JOIN workflow_states s ON s.id = t.current_state_id
  JOIN workspaces ws ON ws.id = t.workspace_id
`;

function now(): string {
  return new Date().toISOString();
}

function insertedId(result: { lastInsertRowid: number | bigint }): number {
  return Number(result.lastInsertRowid);
}

function mapWorkflowState(value: Row): WorkflowState {
  return {
    id: integer(value.id),
    key: text(value.key),
    name: text(value.name),
    position: integer(value.position),
    executionClass: text(value.execution_class) as WorkflowState["executionClass"],
    promptTemplate: nullableText(value.prompt_template),
    completionCriteria: nullableText(value.completion_criteria),
    autoStart: boolean(value.auto_start),
    requiresApproval: boolean(value.requires_approval),
    terminal: boolean(value.terminal),
  };
}

function mapWorkspace(value: Row): Workspace {
  return {
    id: integer(value.id),
    name: text(value.name),
    directory: text(value.directory),
    repository: nullableText(value.repository),
    defaultBranch: nullableText(value.default_branch),
  };
}

function mapTaskSummary(value: Row): TaskSummary {
  const tags = json<Tag[]>(value.tags_json, []);
  const derivedTags = json<Tag[]>(value.derived_tags_json, []);
  return {
    id: integer(value.id),
    publicId: text(value.public_id),
    title: text(value.title),
    taskType: text(value.task_type) as TaskType,
    workflowKey: text(value.workflow_key),
    workflowVersion: integer(value.workflow_version),
    workflowState: text(value.workflow_state),
    workflowStateName: text(value.workflow_state_name),
    lifecycleStatus: text(value.lifecycle_status) as LifecycleStatus,
    kanbanStatus: text(value.kanban_status) as KanbanStatus,
    agentStatus: text(value.agent_status) as AgentStatus,
    priority: integer(value.priority),
    rank: Number(value.rank),
    description: nullableText(value.description),
    durationMinutes: boolean(value.duration_estimated) ? integer(value.duration_minutes) : null,
    splittable: boolean(value.splittable),
    earliestStart: nullableText(value.earliest_start),
    deadlineAt: nullableText(value.deadline_at),
    fixedStart: nullableText(value.fixed_start),
    fixedEnd: nullableText(value.fixed_end),
    completedAt: nullableText(value.completed_at),
    parentTaskId: value.parent_task_id === null ? null : integer(value.parent_task_id),
    automationEnabled: boolean(value.automation_enabled),
    origin: text(value.origin),
    tags: tags.map((tag) => ({ ...tag, parentIds: [] })),
    derivedTags: derivedTags.map((tag) => ({ ...tag, parentIds: [] })),
    agentEligible: [...tags, ...derivedTags].some((tag) => tag.publicId === "mind-palace:llm-eligible"),
    isNewWorktree: boolean(value.is_new_worktree),
    workspaceName: text(value.workspace_name),
    directory: text(value.directory),
    updatedAt: text(value.updated_at),
    openApprovalCount: integer(value.open_approval_count),
    openInteractionCount: integer(value.open_interaction_count),
    blockedByCount: integer(value.blocked_by_count),
  };
}

export class OrchestrationRepository {
  private defaultWorkspaceId: number | null = null;

  constructor(private readonly database: Database) {}

  listWorkflows(): Workflow[] {
    const workflows = this.database.connection
      .prepare("SELECT * FROM workflow_definitions ORDER BY task_type, version DESC")
      .all();
    const stateStatement = this.database.connection.prepare(
      "SELECT * FROM workflow_states WHERE workflow_id = ? ORDER BY position",
    );

    return workflows.map((value) => {
      const workflow = row(value, "workflow");
      return {
        id: integer(workflow.id),
        key: text(workflow.key),
        version: integer(workflow.version),
        name: text(workflow.name),
        taskType: text(workflow.task_type) as TaskType,
        description: nullableText(workflow.description),
        states: stateStatement.all(integer(workflow.id)).map((state) => mapWorkflowState(row(state, "workflow state"))),
      };
    });
  }

  listWorkspaces(): Workspace[] {
    return this.database.connection
      .prepare("SELECT * FROM workspaces ORDER BY name")
      .all()
      .map((value) => mapWorkspace(row(value, "workspace")));
  }

  createWorkspace(input: CreateWorkspaceInput): Workspace {
    const timestamp = now();
    const result = this.database.connection
      .prepare(
        `INSERT INTO workspaces (name, directory, repository, default_branch, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.name.trim(), input.directory, input.repository ?? null, input.defaultBranch ?? null, timestamp, timestamp);
    return this.getWorkspace(insertedId(result));
  }

  ensureDefaultWorkspace(name: string, directory: string): Workspace {
    const existing = this.database.connection
      .prepare("SELECT * FROM workspaces WHERE directory = ?")
      .get(directory);
    const workspace = existing
      ? mapWorkspace(row(existing, "default workspace"))
      : this.createWorkspace({ name, directory });
    this.defaultWorkspaceId = workspace.id;
    return workspace;
  }

  getWorkspace(id: number): Workspace {
    return mapWorkspace(row(this.database.connection.prepare("SELECT * FROM workspaces WHERE id = ?").get(id), "workspace"));
  }

  listTasks(): TaskSummary[] {
    return this.database.connection
      .prepare(`${taskSummarySql} ORDER BY CASE t.lifecycle_status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, t.priority DESC, t.updated_at DESC`)
      .all()
      .map((value) => mapTaskSummary(row(value, "task summary")));
  }

  createTask(input: CreateTaskInput): TaskDetail {
    const workflow = row(
      this.database.connection
        .prepare("SELECT * FROM workflow_definitions WHERE task_type = ? AND active = 1 ORDER BY version DESC LIMIT 1")
        .get(input.taskType ?? "question"),
      `active ${input.taskType ?? "question"} workflow`,
    );
    const initialState = row(
      this.database.connection
        .prepare("SELECT * FROM workflow_states WHERE workflow_id = ? ORDER BY position LIMIT 1")
        .get(integer(workflow.id)),
      "initial workflow state",
    );
    const workspaceId = input.workspaceId ?? this.defaultWorkspaceId;
    if (workspaceId === null) throw new Error("The default workspace has not been initialized");
    this.getWorkspace(workspaceId);

    const timestamp = now();
    const initialPrompt = input.initialPrompt?.trim() || input.description?.trim() || input.title.trim();
    const title = input.title.trim() || initialPrompt.replace(/\s+/g, " ").slice(0, 150);
    if (!title) throw new Error("A task title is required");

    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.connection
        .prepare(
          `INSERT INTO tasks
            (public_id, workflow_id, current_state_id, workspace_id, title, title_source, initial_prompt,
             priority, lifecycle_status, agent_status, automation_policy, model, agent, is_new_worktree, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(), integer(workflow.id), integer(initialState.id), workspaceId, title,
          "manual", initialPrompt, input.priority ?? 0,
          input.startImmediately === false || input.automationPolicy === "manual" ? "not_started" : "queued",
          input.automationPolicy ?? "stop_before_writes", input.model ?? null, input.agent ?? null,
          input.isNewWorktree ? 1 : 0, timestamp, timestamp,
        );
      const taskId = insertedId(result);
      this.database.connection
        .prepare(
          `INSERT INTO task_state_transitions
            (task_id, from_state_id, to_state_id, cause, actor_type, summary, created_at)
           VALUES (?, NULL, ?, 'created', 'user', 'Task created', ?)`,
        )
        .run(taskId, integer(initialState.id), timestamp);
      this.insertAudit(taskId, "task.created", "user", { taskType: input.taskType ?? "question" });
      if (input.startImmediately !== false && input.automationPolicy !== "manual") {
        this.insertJob(taskId, "start_state", { trigger: "initial" }, timestamp);
      }
      this.database.connection.exec("COMMIT");
      return this.getTask(taskId);
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    }
  }

  getTask(id: number): TaskDetail {
    const summary = mapTaskSummary(
      row(this.database.connection.prepare(`${taskSummarySql} WHERE t.id = ?`).get(id), "task"),
    );
    const task = row(this.database.connection.prepare("SELECT * FROM tasks WHERE id = ?").get(id), "task");
    const session = this.database.connection
      .prepare("SELECT * FROM opencode_sessions WHERE task_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(id);
    const sessionRow = session ? row(session, "OpenCode session") : null;
    const failure = this.database.connection
      .prepare(
        `SELECT error FROM (
           SELECT error, COALESCE(finished_at, created_at) AS failed_at
             FROM agent_runs WHERE task_id = ? AND status = 'failed' AND error IS NOT NULL
           UNION ALL
           SELECT last_error AS error, COALESCE(finished_at, created_at) AS failed_at
             FROM scheduled_jobs WHERE task_id = ? AND status = 'failed' AND last_error IS NOT NULL
         ) ORDER BY failed_at DESC LIMIT 1`,
      )
      .get(id, id);

    return {
      ...summary,
      initialPrompt: text(task.initial_prompt),
      failureReason: failure ? text(row(failure, "task failure").error) : null,
      automationPolicy: text(task.automation_policy) as AutomationPolicy,
      model: nullableText(task.model),
      agent: nullableText(task.agent),
      wikiPath: nullableText(task.wiki_path),
      createdAt: text(task.created_at),
      startedAt: nullableText(task.started_at),
      completedAt: nullableText(task.completed_at),
      attachCommand:
        sessionRow?.tmux_session && sessionRow.tmux_window
          ? `tmux attach-session -t ${text(sessionRow.tmux_session)} \\; select-window -t ${text(sessionRow.tmux_session)}:${text(sessionRow.tmux_window)}`
          : null,
      sessionId: sessionRow ? text(sessionRow.opencode_session_id) : null,
      transitions: this.listTransitions(id),
      runs: this.listRuns(id),
      approvals: this.listApprovals(id),
      interactions: this.listInteractions(id),
      dependencies: this.listDependencies(id),
      artifacts: this.listArtifacts(id),
      minChunkMinutes: integer(task.min_chunk_minutes),
      maxChunkMinutes: integer(task.max_chunk_minutes),
      timeBlocks: this.listTimeBlocks(id),
      recurrence: this.getRecurrence(id),
    };
  }

  private listTimeBlocks(taskId: number): TimeBlock[] {
    return this.database.connection
      .prepare("SELECT * FROM time_blocks WHERE task_id = ? ORDER BY start_at")
      .all(taskId)
      .map((value) => {
        const item = row(value, "time block");
        return {
          id: integer(item.id),
          publicId: text(item.public_id),
          taskId: integer(item.task_id),
          scheduleRunId: item.schedule_run_id === null ? null : integer(item.schedule_run_id),
          startAt: text(item.start_at),
          endAt: text(item.end_at),
          status: text(item.status) as TimeBlock["status"],
          source: text(item.source) as TimeBlock["source"],
          notes: nullableText(item.notes),
        };
      });
  }

  private getRecurrence(taskId: number): RecurrenceRule | null {
    const value = this.database.connection.prepare("SELECT * FROM recurrence_rules WHERE task_id = ?").get(taskId);
    if (!value) return null;
    const item = row(value, "recurrence rule");
    return {
      id: integer(item.id),
      taskId: integer(item.task_id),
      frequency: text(item.frequency) as RecurrenceRule["frequency"],
      intervalCount: integer(item.interval_count),
      weekdays: item.weekdays_json ? json<number[]>(item.weekdays_json, []) : [],
      localStartTime: nullableText(item.local_start_time),
      nextOccurrenceDate: text(item.next_occurrence_date),
      active: boolean(item.active),
    };
  }

  getTaskContext(id: number): TaskContext {
    const value = row(
      this.database.connection
        .prepare(
          `SELECT t.*, workflow.task_type, s.key AS state_key, s.name AS state_name, s.position AS state_position,
                  s.execution_class, s.prompt_template, s.completion_criteria, s.auto_start,
                  s.requires_approval, s.terminal,
                  ws.name AS workspace_name, ws.directory, ws.repository, ws.default_branch
             FROM tasks t
             JOIN workflow_definitions workflow ON workflow.id = t.workflow_id
             JOIN workflow_states s ON s.id = t.current_state_id
             JOIN workspaces ws ON ws.id = t.workspace_id
            WHERE t.id = ?`,
        )
        .get(id),
      "task context",
    );
    return {
      id: integer(value.id),
      publicId: text(value.public_id),
      taskType: text(value.task_type) as TaskType,
      title: text(value.title),
      initialPrompt: text(value.initial_prompt),
      workflowId: integer(value.workflow_id),
      state: mapWorkflowState({
        id: value.current_state_id,
        key: value.state_key,
        name: value.state_name,
        position: value.state_position,
        execution_class: value.execution_class,
        prompt_template: value.prompt_template,
        completion_criteria: value.completion_criteria,
        auto_start: value.auto_start,
        requires_approval: value.requires_approval,
        terminal: value.terminal,
      }),
      workspace: mapWorkspace({
        id: value.workspace_id,
        name: value.workspace_name,
        directory: value.directory,
        repository: value.repository,
        default_branch: value.default_branch,
      }),
      lifecycleStatus: text(value.lifecycle_status) as LifecycleStatus,
      agentStatus: text(value.agent_status) as AgentStatus,
      automationPolicy: text(value.automation_policy) as AutomationPolicy,
      model: nullableText(value.model),
      agent: nullableText(value.agent),
      isNewWorktree: boolean(value.is_new_worktree),
    };
  }

  setTaskLifecycle(id: number, status: LifecycleStatus): void {
    const timestamp = now();
    this.database.connection
      .prepare(
        `UPDATE tasks
            SET lifecycle_status = ?, agent_status = CASE WHEN ? = 'paused' THEN 'stopped' ELSE agent_status END,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(status, status, timestamp, id);
    this.insertAudit(id, `task.${status}`, "user", {});
  }

  setAgentStatus(id: number, status: AgentStatus): void {
    this.database.connection
      .prepare(
        `UPDATE tasks SET agent_status = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?`,
      )
      .run(status, status === "running" ? now() : null, now(), id);
  }

  addDependency(taskId: number, input: CreateDependencyInput): void {
    const cycle = this.database.connection
      .prepare(
        `WITH RECURSIVE blockers(id) AS (
           SELECT blocker_task_id FROM task_dependencies WHERE task_id = ?
           UNION
           SELECT dependency.blocker_task_id FROM task_dependencies dependency JOIN blockers ON dependency.task_id = blockers.id
         ) SELECT 1 FROM blockers WHERE id = ? LIMIT 1`,
      )
      .get(input.blockerTaskId, taskId);
    if (cycle) throw new Error("Task dependencies cannot contain a cycle");
    const blocker = this.getTaskContext(input.blockerTaskId);
    const requiredState = row(
      this.database.connection
        .prepare("SELECT * FROM workflow_states WHERE workflow_id = ? AND key = ?")
        .get(blocker.workflowId, input.requiredStateKey),
      "dependency state",
    );
    const reached = this.database.connection
      .prepare("SELECT 1 FROM task_state_transitions WHERE task_id = ? AND to_state_id = ? LIMIT 1")
      .get(input.blockerTaskId, integer(requiredState.id));
    this.database.connection
      .prepare(
        `INSERT INTO task_dependencies (task_id, blocker_task_id, required_state_id, satisfied_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(taskId, input.blockerTaskId, integer(requiredState.id), reached ? now() : null, now());
    this.refreshBlockedStatus(taskId);
  }

  addResourceRequirement(taskId: number, input: CreateResourceRequirementInput): void {
    const task = this.getTaskContext(taskId);
    const stateId = input.stateKey
      ? integer(
          row(
            this.database.connection
              .prepare("SELECT id FROM workflow_states WHERE workflow_id = ? AND key = ?")
              .get(task.workflowId, input.stateKey),
            "resource requirement state",
          ).id,
        )
      : null;
    this.database.connection
      .prepare(
        `INSERT INTO task_resource_requirements (task_id, workflow_state_id, resource_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(taskId, stateId, input.resourceId, now());
  }

  isBlocked(taskId: number): boolean {
    const value = row(
      this.database.connection
        .prepare("SELECT COUNT(*) AS count FROM task_dependencies WHERE task_id = ? AND satisfied_at IS NULL")
        .get(taskId),
      "dependency count",
    );
    return integer(value.count) > 0;
  }

  refreshBlockedStatus(taskId: number): void {
    if (this.isBlocked(taskId)) this.setAgentStatus(taskId, "blocked");
  }

  findNextState(
    taskId: number,
    proposedKey?: string,
    trigger: "agent_complete" | "human_selected" = "agent_complete",
  ): WorkflowState | null {
    const task = this.getTaskContext(taskId);
    const value = proposedKey
      ? this.database.connection
          .prepare(
            `SELECT target.* FROM workflow_transitions transition_rule
             JOIN workflow_states target ON target.id = transition_rule.to_state_id
             WHERE transition_rule.from_state_id = ? AND target.key = ? AND transition_rule.trigger = ? LIMIT 1`,
          )
          .get(task.state.id, proposedKey, trigger)
      : this.database.connection
          .prepare(
            `SELECT target.* FROM workflow_transitions transition_rule
             JOIN workflow_states target ON target.id = transition_rule.to_state_id
             WHERE transition_rule.from_state_id = ? AND transition_rule.trigger = ? ORDER BY target.position LIMIT 1`,
          )
          .get(task.state.id, trigger);
    return value ? mapWorkflowState(row(value, "next state")) : null;
  }

  listNextStates(
    taskId: number,
    trigger: "agent_complete" | "human_selected" = "agent_complete",
  ): WorkflowState[] {
    const task = this.getTaskContext(taskId);
    return this.database.connection
      .prepare(
        `SELECT target.* FROM workflow_transitions transition_rule
         JOIN workflow_states target ON target.id = transition_rule.to_state_id
         WHERE transition_rule.from_state_id = ? AND transition_rule.trigger = ?
         ORDER BY target.position`,
      )
      .all(task.state.id, trigger)
      .map((value) => mapWorkflowState(row(value, "next state")));
  }

  transitionTask(taskId: number, nextState: WorkflowState, cause: "agent_result" | "approval" | "manual" | "external_event", actorType: "system" | "agent" | "user", summary: string | null, runId?: number): void {
    const task = this.getTaskContext(taskId);
    const timestamp = now();
    const newlyUnblockedCandidates = this.database.connection
      .prepare("SELECT DISTINCT task_id FROM task_dependencies WHERE blocker_task_id = ? AND required_state_id = ? AND satisfied_at IS NULL")
      .all(taskId, nextState.id)
      .map((value) => integer(row(value, "dependent task").task_id));
    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      this.database.connection
        .prepare(
          `UPDATE tasks
              SET current_state_id = ?, lifecycle_status = ?, kanban_status = CASE WHEN ? THEN 'completed' ELSE kanban_status END,
                  agent_status = ?, completed_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          nextState.id,
          nextState.terminal ? "completed" : "active",
          nextState.terminal ? 1 : 0,
          nextState.terminal ? "stopped" : "idle",
          nextState.terminal ? timestamp : null,
          timestamp,
          taskId,
        );
      this.database.connection
        .prepare(
          `INSERT INTO task_state_transitions
            (task_id, from_state_id, to_state_id, cause, actor_type, agent_run_id, summary, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(taskId, task.state.id, nextState.id, cause, actorType, runId ?? null, summary, timestamp);
      this.database.connection
        .prepare("UPDATE task_dependencies SET satisfied_at = ? WHERE blocker_task_id = ? AND required_state_id = ? AND satisfied_at IS NULL")
        .run(timestamp, taskId, nextState.id);
      this.insertAudit(taskId, "task.state_changed", actorType, { from: task.state.key, to: nextState.key });
      this.database.connection.exec("COMMIT");
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    }
    for (const dependentTaskId of newlyUnblockedCandidates) {
      const dependent = this.getTaskContext(dependentTaskId);
      if (!this.isBlocked(dependentTaskId) && dependent.lifecycleStatus === "active") {
        this.enqueueStart(dependentTaskId, "state_entry", { unblockedByTaskId: taskId });
      }
    }
  }

  enqueueStart(taskId: number, trigger: string = "state_entry", extra: JsonObject = {}): number {
    this.setAgentStatus(taskId, "queued");
    return this.insertJob(taskId, "start_state", { trigger, ...extra }, now());
  }

  claimJob(workerId: string): ScheduledJob | null {
    const timestamp = now();
    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      const value = this.database.connection
        .prepare(
          `SELECT * FROM scheduled_jobs
            WHERE status = 'pending' AND run_after <= ?
            ORDER BY run_after, id LIMIT 1`,
        )
        .get(timestamp);
      if (!value) {
        this.database.connection.exec("COMMIT");
        return null;
      }
      const job = row(value, "scheduled job");
      this.database.connection
        .prepare("UPDATE scheduled_jobs SET status = 'running', locked_at = ?, locked_by = ?, attempts = attempts + 1 WHERE id = ?")
        .run(timestamp, workerId, integer(job.id));
      this.database.connection.exec("COMMIT");
      return {
        id: integer(job.id),
        taskId: job.task_id === null ? null : integer(job.task_id),
        kind: text(job.kind) as ScheduledJob["kind"],
        payload: json<JsonObject>(job.payload_json, {}),
        attempts: integer(job.attempts) + 1,
        maxAttempts: integer(job.max_attempts),
      };
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    }
  }

  completeJob(id: number): void {
    this.database.connection
      .prepare("UPDATE scheduled_jobs SET status = 'succeeded', finished_at = ?, locked_at = NULL, locked_by = NULL WHERE id = ?")
      .run(now(), id);
  }

  retryJob(job: ScheduledJob, error: string, delaySeconds: number): void {
    const failed = job.attempts >= job.maxAttempts;
    const runAfter = new Date(Date.now() + delaySeconds * 1000).toISOString();
    this.database.connection
      .prepare(
        `UPDATE scheduled_jobs
            SET status = ?, run_after = ?, last_error = ?, locked_at = NULL, locked_by = NULL, finished_at = ?
          WHERE id = ?`,
      )
      .run(failed ? "failed" : "pending", runAfter, error, failed ? now() : null, job.id);
    if (failed && job.taskId) this.setAgentStatus(job.taskId, "failed");
  }

  recoverJobs(): void {
    this.database.connection
      .prepare("UPDATE scheduled_jobs SET status = 'pending', locked_at = NULL, locked_by = NULL WHERE status = 'running'")
      .run();
    this.database.connection
      .prepare("UPDATE agent_runs SET status = 'lost', finished_at = ? WHERE status = 'running'")
      .run(now());
    this.database.connection
      .prepare("UPDATE resource_leases SET released_at = ?, release_reason = 'process_restart' WHERE released_at IS NULL")
      .run(now());
  }

  recoverCompletedTransitions(): number {
    const candidates = this.database.connection
      .prepare(
        `SELECT r.id AS run_id, r.task_id, r.summary
           FROM agent_runs r
           JOIN tasks t ON t.id = r.task_id AND t.current_state_id = r.workflow_state_id
          WHERE r.status = 'succeeded'
            AND r.outcome = 'state_complete'
            AND t.lifecycle_status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM task_state_transitions transition_history
               WHERE transition_history.agent_run_id = r.id
            )
          ORDER BY r.id`,
      )
      .all();
    let recovered = 0;
    for (const value of candidates) {
      const candidate = row(value, "recoverable completed run");
      const taskId = integer(candidate.task_id);
      const allowedStates = this.listNextStates(taskId);
      if (allowedStates.length !== 1) continue;
      const nextState = allowedStates[0];
      if (!nextState) continue;
      this.transitionTask(
        taskId,
        nextState,
        "agent_result",
        "system",
        nullableText(candidate.summary),
        integer(candidate.run_id),
      );
      if (!nextState.terminal && (nextState.autoStart || nextState.requiresApproval)) {
        this.enqueueStart(taskId, "recovery");
      }
      recovered += 1;
    }
    return recovered;
  }

  upsertServer(endpoint: string, pid: number | null, version: string | null): number {
    const timestamp = now();
    this.database.connection
      .prepare(
        `INSERT INTO opencode_servers (endpoint, pid, version, status, started_at, last_heartbeat_at, created_at)
         VALUES (?, ?, ?, 'healthy', ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET pid = excluded.pid, version = excluded.version,
           status = 'healthy', last_heartbeat_at = excluded.last_heartbeat_at, stopped_at = NULL`,
      )
      .run(endpoint, pid, version, timestamp, timestamp, timestamp);
    return integer(row(this.database.connection.prepare("SELECT id FROM opencode_servers WHERE endpoint = ?").get(endpoint), "server").id);
  }

  getSessionForTask(taskId: number): OpenCodeSessionRecord | null {
    const value = this.database.connection
      .prepare("SELECT * FROM opencode_sessions WHERE task_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(taskId);
    return value ? this.mapSession(row(value, "OpenCode session")) : null;
  }

  findSessionByNativeId(nativeSessionId: string): OpenCodeSessionRecord | null {
    const value = this.database.connection
      .prepare("SELECT * FROM opencode_sessions WHERE opencode_session_id = ? AND closed_at IS NULL")
      .get(nativeSessionId);
    return value ? this.mapSession(row(value, "OpenCode session")) : null;
  }

  createSession(input: {
    taskId: number;
    serverId: number;
    nativeSessionId: string;
    title: string;
    directory: string;
    model: string | null;
    agent: string | null;
    tmuxSession: string;
    tmuxWindow: string;
  }): OpenCodeSessionRecord {
    const result = this.database.connection
      .prepare(
        `INSERT INTO opencode_sessions
          (task_id, server_id, opencode_session_id, title, directory, model, agent,
           last_known_status, tmux_session, tmux_window, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?)`,
      )
      .run(
        input.taskId, input.serverId, input.nativeSessionId, input.title, input.directory,
        input.model, input.agent, input.tmuxSession, input.tmuxWindow, now(), now(),
      );
    return this.mapSession(
      row(this.database.connection.prepare("SELECT * FROM opencode_sessions WHERE id = ?").get(insertedId(result)), "OpenCode session"),
    );
  }

  updateSessionStatus(nativeSessionId: string, status: string): void {
    this.database.connection
      .prepare("UPDATE opencode_sessions SET last_known_status = ?, last_seen_at = ? WHERE opencode_session_id = ?")
      .run(status, now(), nativeSessionId);
  }

  createRun(task: TaskContext, session: OpenCodeSessionRecord, trigger: string, prompt: string): number {
    const result = this.database.connection
      .prepare(
        `INSERT INTO agent_runs
          (task_id, workflow_state_id, opencode_session_id, trigger, status, prompt, started_at, heartbeat_at, created_at)
         VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
      )
      .run(task.id, task.state.id, session.id, trigger, prompt, now(), now(), now());
    this.setAgentStatus(task.id, "running");
    return insertedId(result);
  }

  getActiveRun(taskId: number): AgentRunRecord | null {
    const value = this.database.connection
      .prepare("SELECT * FROM agent_runs WHERE task_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1")
      .get(taskId);
    if (!value) return null;
    const run = row(value, "agent run");
    return {
      id: integer(run.id),
      taskId: integer(run.task_id),
      workflowStateId: integer(run.workflow_state_id),
      sessionRecordId: integer(run.opencode_session_id),
      status: text(run.status),
    };
  }

  finishRun(runId: number, status: "succeeded" | "waiting_input" | "waiting_approval" | "failed", result: StateResult | null, error?: string): void {
    this.database.connection
      .prepare(
        `UPDATE agent_runs SET status = ?, outcome = ?, summary = ?, result_json = ?, proposed_next_state = ?,
          error = ?, heartbeat_at = ?, finished_at = ? WHERE id = ?`,
      )
      .run(
        status, result?.outcome ?? null, result?.summary ?? null, result ? JSON.stringify(result) : null,
        result?.proposedNextState ?? null, error ?? null, now(), now(), runId,
      );
  }

  createApproval(taskId: number, runId: number | null, stateId: number, actionType: string, description: string, proposedAction: JsonObject): number {
    const existing = this.database.connection
      .prepare(
        `SELECT id FROM approval_requests
          WHERE task_id = ? AND workflow_state_id = ? AND action_type = ? AND status = 'pending'`,
      )
      .get(taskId, stateId, actionType);
    if (existing) return integer(row(existing, "approval").id);
    const result = this.database.connection
      .prepare(
        `INSERT INTO approval_requests
          (task_id, agent_run_id, workflow_state_id, action_type, scope, description, proposed_action_json, status, requested_at)
         VALUES (?, ?, ?, ?, 'once', ?, ?, 'pending', ?)`,
      )
      .run(taskId, runId, stateId, actionType, description, JSON.stringify(proposedAction), now());
    this.setAgentStatus(taskId, "waiting_approval");
    return insertedId(result);
  }

  resolveApproval(id: number, approved: boolean): number {
    const approval = row(this.database.connection.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id), "approval");
    if (text(approval.status) !== "pending") throw new Error("Approval is no longer pending");
    this.database.connection
      .prepare("UPDATE approval_requests SET status = ?, resolved_at = ?, resolved_by = 'local-user' WHERE id = ?")
      .run(approved ? "approved" : "rejected", now(), id);
    const taskId = integer(approval.task_id);
    if (approved) this.enqueueStart(taskId, "user_resume", { approvalId: id });
    else this.setAgentStatus(taskId, "idle");
    return taskId;
  }

  consumeApproval(taskId: number, stateId: number): boolean {
    const value = this.database.connection
      .prepare(
        `SELECT id FROM approval_requests
          WHERE task_id = ? AND workflow_state_id = ? AND status = 'approved' AND consumed_at IS NULL
          ORDER BY id LIMIT 1`,
      )
      .get(taskId, stateId);
    if (!value) return false;
    this.database.connection.prepare("UPDATE approval_requests SET consumed_at = ? WHERE id = ?").run(now(), integer(row(value, "approval").id));
    return true;
  }

  createInteraction(taskId: number, runId: number | null, kind: "question" | "permission", prompt: string, request: JsonObject, nativeRequestId?: string): number {
    if (nativeRequestId) {
      const existing = this.database.connection
        .prepare("SELECT id FROM interaction_requests WHERE opencode_request_id = ?")
        .get(nativeRequestId);
      if (existing) return integer(row(existing, "interaction").id);
    }
    const result = this.database.connection
      .prepare(
        `INSERT INTO interaction_requests
          (task_id, agent_run_id, kind, opencode_request_id, prompt, request_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(taskId, runId, kind, nativeRequestId ?? null, prompt, JSON.stringify(request), now());
    this.setAgentStatus(taskId, "waiting_input");
    return insertedId(result);
  }

  getInteraction(id: number): { id: number; taskId: number; kind: "question" | "permission"; nativeRequestId: string | null; request: JsonObject } {
    const value = row(this.database.connection.prepare("SELECT * FROM interaction_requests WHERE id = ?").get(id), "interaction");
    return {
      id: integer(value.id),
      taskId: integer(value.task_id),
      kind: text(value.kind) as "question" | "permission",
      nativeRequestId: nullableText(value.opencode_request_id),
      request: json<JsonObject>(value.request_json, {}),
    };
  }

  resolveInteraction(id: number, response: unknown): number {
    const interaction = this.getInteraction(id);
    this.database.connection
      .prepare("UPDATE interaction_requests SET status = 'answered', response_json = ?, resolved_at = ? WHERE id = ? AND status = 'pending'")
      .run(JSON.stringify(response), now(), id);
    return interaction.taskId;
  }

  acquireResources(taskId: number, stateId: number, runId: number, leaseSeconds: number): boolean {
    const requirements = this.database.connection
      .prepare(
        `SELECT resource_id FROM task_resource_requirements
          WHERE task_id = ? AND (workflow_state_id IS NULL OR workflow_state_id = ?)`,
      )
      .all(taskId, stateId)
      .map((value) => integer(row(value, "resource requirement").resource_id));
    if (requirements.length === 0) return true;

    const timestamp = now();
    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      this.database.connection
        .prepare("UPDATE resource_leases SET released_at = ?, release_reason = 'expired' WHERE released_at IS NULL AND expires_at <= ?")
        .run(timestamp, timestamp);
      const findLease = this.database.connection.prepare(
        "SELECT 1 FROM resource_leases WHERE resource_id = ? AND released_at IS NULL",
      );
      if (requirements.some((resourceId) => findLease.get(resourceId))) {
        this.database.connection.exec("ROLLBACK");
        return false;
      }
      const insert = this.database.connection.prepare(
        `INSERT INTO resource_leases
          (resource_id, task_id, agent_run_id, acquired_at, heartbeat_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
      for (const resourceId of requirements) insert.run(resourceId, taskId, runId, timestamp, timestamp, expiresAt);
      this.database.connection.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    }
  }

  releaseResources(runId: number, reason: string): void {
    this.database.connection
      .prepare("UPDATE resource_leases SET released_at = ?, release_reason = ? WHERE agent_run_id = ? AND released_at IS NULL")
      .run(now(), reason, runId);
  }

  heartbeatRun(runId: number, leaseSeconds: number): void {
    const timestamp = now();
    const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    this.database.connection
      .prepare("UPDATE agent_runs SET heartbeat_at = ? WHERE id = ? AND status = 'running'")
      .run(timestamp, runId);
    this.database.connection
      .prepare("UPDATE resource_leases SET heartbeat_at = ?, expires_at = ? WHERE agent_run_id = ? AND released_at IS NULL")
      .run(timestamp, expiresAt, runId);
  }

  listResources(): Array<{ id: number; key: string; name: string; description: string | null; leasedByTaskId: number | null }> {
    return this.database.connection
      .prepare(
        `SELECT r.*, l.task_id AS leased_by_task_id FROM resources r
         LEFT JOIN resource_leases l ON l.resource_id = r.id AND l.released_at IS NULL
         ORDER BY r.name`,
      )
      .all()
      .map((value) => {
        const resource = row(value, "resource");
        return {
          id: integer(resource.id),
          key: text(resource.key),
          name: text(resource.name),
          description: nullableText(resource.description),
          leasedByTaskId: resource.leased_by_task_id === null ? null : integer(resource.leased_by_task_id),
        };
      });
  }

  createResource(key: string, name: string, description?: string): number {
    const result = this.database.connection
      .prepare("INSERT INTO resources (key, name, description, created_at) VALUES (?, ?, ?, ?)")
      .run(key, name, description ?? null, now());
    return insertedId(result);
  }

  addArtifactsFromResult(taskId: number, runId: number, result: StateResult): void {
    const insert = this.database.connection.prepare(
      `INSERT OR IGNORE INTO artifacts (task_id, agent_run_id, kind, label, uri, metadata_json, created_at)
       VALUES (?, ?, 'external_url', ?, ?, ?, ?)`,
    );
    for (const evidence of result.evidence) {
      if (evidence.uri) insert.run(taskId, runId, evidence.label, evidence.uri, JSON.stringify({ detail: evidence.detail }), now());
    }
  }

  private insertJob(taskId: number | null, kind: ScheduledJob["kind"], payload: JsonObject, runAfter: string): number {
    const result = this.database.connection
      .prepare(
        `INSERT INTO scheduled_jobs (task_id, kind, payload_json, status, run_after, max_attempts, created_at)
         VALUES (?, ?, ?, 'pending', ?, 3, ?)`,
      )
      .run(taskId, kind, JSON.stringify(payload), runAfter, now());
    return insertedId(result);
  }

  private insertAudit(taskId: number | null, eventType: string, actorType: "system" | "agent" | "user" | "external", payload: JsonObject): void {
    this.database.connection
      .prepare("INSERT INTO audit_events (task_id, event_type, actor_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(taskId, eventType, actorType, JSON.stringify(payload), now());
  }

  private mapSession(value: Row): OpenCodeSessionRecord {
    return {
      id: integer(value.id),
      taskId: integer(value.task_id),
      serverId: integer(value.server_id),
      nativeSessionId: text(value.opencode_session_id),
      directory: text(value.directory),
      tmuxSession: nullableText(value.tmux_session),
      tmuxWindow: nullableText(value.tmux_window),
    };
  }

  private listTransitions(taskId: number): StateTransition[] {
    return this.database.connection
      .prepare(
        `SELECT h.*, f.key AS from_state, t.key AS to_state
           FROM task_state_transitions h
           LEFT JOIN workflow_states f ON f.id = h.from_state_id
           JOIN workflow_states t ON t.id = h.to_state_id
          WHERE h.task_id = ? ORDER BY h.created_at DESC`,
      )
      .all(taskId)
      .map((value) => {
        const transition = row(value, "transition");
        return {
          id: integer(transition.id), fromState: nullableText(transition.from_state), toState: text(transition.to_state),
          cause: text(transition.cause), actorType: text(transition.actor_type), summary: nullableText(transition.summary),
          createdAt: text(transition.created_at),
        };
      });
  }

  private listRuns(taskId: number): AgentRun[] {
    return this.database.connection
      .prepare(
        `SELECT r.*, s.key AS state_key FROM agent_runs r JOIN workflow_states s ON s.id = r.workflow_state_id
          WHERE r.task_id = ? ORDER BY r.created_at DESC`,
      )
      .all(taskId)
      .map((value) => {
        const run = row(value, "run");
        return {
          id: integer(run.id), stateKey: text(run.state_key), trigger: text(run.trigger),
          status: text(run.status) as AgentRun["status"], outcome: nullableText(run.outcome) as StateOutcome | null,
          summary: nullableText(run.summary), error: nullableText(run.error), startedAt: nullableText(run.started_at),
          finishedAt: nullableText(run.finished_at), createdAt: text(run.created_at),
        };
      });
  }

  private listApprovals(taskId: number): ApprovalRequest[] {
    return this.database.connection
      .prepare("SELECT * FROM approval_requests WHERE task_id = ? ORDER BY requested_at DESC")
      .all(taskId)
      .map((value) => {
        const approval = row(value, "approval");
        return {
          id: integer(approval.id), actionType: text(approval.action_type), scope: text(approval.scope) as "once" | "state",
          description: text(approval.description), proposedAction: json<JsonObject>(approval.proposed_action_json, {}),
          status: text(approval.status) as ApprovalRequest["status"], requestedAt: text(approval.requested_at),
          resolvedAt: nullableText(approval.resolved_at),
        };
      });
  }

  private listInteractions(taskId: number): InteractionRequest[] {
    return this.database.connection
      .prepare("SELECT * FROM interaction_requests WHERE task_id = ? ORDER BY created_at DESC")
      .all(taskId)
      .map((value) => {
        const interaction = row(value, "interaction");
        return {
          id: integer(interaction.id), kind: text(interaction.kind) as InteractionRequest["kind"],
          prompt: text(interaction.prompt), request: interaction.request_json ? json<JsonObject>(interaction.request_json, {}) : null,
          status: text(interaction.status) as InteractionRequest["status"], createdAt: text(interaction.created_at),
          resolvedAt: nullableText(interaction.resolved_at),
        };
      });
  }

  private listDependencies(taskId: number): TaskDependency[] {
    return this.database.connection
      .prepare(
        `SELECT d.*, blocker.title AS blocker_title, required.key AS required_state
           FROM task_dependencies d
           JOIN tasks blocker ON blocker.id = d.blocker_task_id
           JOIN workflow_states required ON required.id = d.required_state_id
          WHERE d.task_id = ? ORDER BY d.created_at`,
      )
      .all(taskId)
      .map((value) => {
        const dependency = row(value, "dependency");
        return {
          id: integer(dependency.id), blockerTaskId: integer(dependency.blocker_task_id),
          blockerTitle: text(dependency.blocker_title), requiredState: text(dependency.required_state),
          satisfiedAt: nullableText(dependency.satisfied_at),
        };
      });
  }

  private listArtifacts(taskId: number): Artifact[] {
    return this.database.connection
      .prepare("SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at DESC")
      .all(taskId)
      .map((value) => {
        const artifact = row(value, "artifact");
        return {
          id: integer(artifact.id), kind: text(artifact.kind), label: text(artifact.label), uri: text(artifact.uri),
          createdAt: text(artifact.created_at),
        };
      });
  }
}
