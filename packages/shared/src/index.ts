export const taskTypes = ["bug", "feature", "question"] as const;
export type TaskType = (typeof taskTypes)[number];

export const lifecycleStatuses = [
  "backlog",
  "active",
  "paused",
  "completed",
  "cancelled",
  "archived",
] as const;
export type LifecycleStatus = (typeof lifecycleStatuses)[number];

export const kanbanStatuses = [
  "inbox",
  "ready",
  "in_progress",
  "waiting",
  "in_review",
  "completed",
  "cancelled",
] as const;
export type KanbanStatus = (typeof kanbanStatuses)[number];

export const timeBlockStatuses = ["proposed", "accepted", "completed", "missed", "superseded"] as const;
export type TimeBlockStatus = (typeof timeBlockStatuses)[number];

export const agentStatuses = [
  "not_started",
  "queued",
  "running",
  "idle",
  "waiting_input",
  "waiting_approval",
  "blocked",
  "failed",
  "stopped",
] as const;
export type AgentStatus = (typeof agentStatuses)[number];

export const automationPolicies = [
  "manual",
  "stop_before_writes",
  "through_pr",
  "fully_automatic",
] as const;
export type AutomationPolicy = (typeof automationPolicies)[number];

export const runStatuses = [
  "queued",
  "running",
  "succeeded",
  "waiting_input",
  "waiting_approval",
  "failed",
  "aborted",
  "lost",
] as const;
export type RunStatus = (typeof runStatuses)[number];

export const stateOutcomes = [
  "state_complete",
  "needs_input",
  "blocked",
  "action_proposed",
  "failed",
] as const;
export type StateOutcome = (typeof stateOutcomes)[number];

export const proposedActionTypes = [
  "workspace_change",
  "create_pr",
  "external_change",
  "followup_fix",
] as const;
export type ProposedActionType = (typeof proposedActionTypes)[number];

export type JsonObject = Record<string, unknown>;

export interface Evidence {
  label: string;
  uri?: string;
  detail?: string;
}

export interface ProposedAction {
  type: ProposedActionType;
  description: string;
  details: JsonObject;
}

export interface StateResult {
  outcome: StateOutcome;
  summary: string;
  evidence: Evidence[];
  proposedNextState?: string;
  requestedActions: ProposedAction[];
  question?: {
    prompt: string;
    options?: string[];
  };
}

export const stateResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    outcome: { type: "string", enum: stateOutcomes },
    summary: {
      type: "string",
      description: "Concise durable summary of what was learned or accomplished.",
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          uri: { type: "string" },
          detail: { type: "string" },
        },
        required: ["label"],
      },
    },
    proposedNextState: { type: "string" },
    requestedActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: proposedActionTypes },
          description: { type: "string" },
          details: { type: "object", additionalProperties: true },
        },
        required: ["type", "description", "details"],
      },
    },
    question: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string" },
        options: { type: "array", items: { type: "string" } },
      },
      required: ["prompt"],
    },
  },
  required: ["outcome", "summary", "evidence", "requestedActions"],
} as const;

export function stateResultJsonSchemaFor(nextStateKeys: string[]) {
  return {
    ...stateResultJsonSchema,
    properties: {
      ...stateResultJsonSchema.properties,
      proposedNextState: {
        type: "string",
        enum: nextStateKeys,
        description: "Exact workflow state key to enter next. Do not include explanation or instructions.",
      },
    },
  } as const;
}

export function isStateResult(value: unknown): value is StateResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.summary === "string" &&
    stateOutcomes.includes(result.outcome as StateOutcome) &&
    Array.isArray(result.evidence) &&
    Array.isArray(result.requestedActions)
  );
}

export interface WorkflowState {
  id: number;
  key: string;
  name: string;
  position: number;
  executionClass: "research" | "workspace_write" | "external_write" | "terminal";
  promptTemplate: string | null;
  completionCriteria: string | null;
  autoStart: boolean;
  requiresApproval: boolean;
  terminal: boolean;
}

export interface Workflow {
  id: number;
  key: string;
  version: number;
  name: string;
  taskType: TaskType;
  description: string | null;
  states: WorkflowState[];
}

export interface Workspace {
  id: number;
  name: string;
  directory: string;
  repository: string | null;
  defaultBranch: string | null;
}

export interface TaskSummary {
  id: number;
  publicId: string;
  title: string;
  taskType: TaskType;
  workflowKey: string;
  workflowVersion: number;
  workflowState: string;
  workflowStateName: string;
  lifecycleStatus: LifecycleStatus;
  kanbanStatus: KanbanStatus;
  agentStatus: AgentStatus;
  priority: number;
  rank: number;
  description: string | null;
  durationMinutes: number | null;
  splittable: boolean;
  earliestStart: string | null;
  deadlineAt: string | null;
  fixedStart: string | null;
  fixedEnd: string | null;
  completedAt: string | null;
  parentTaskId: number | null;
  automationEnabled: boolean;
  origin: string;
  tags: Tag[];
  derivedTags: Tag[];
  agentEligible: boolean;
  isNewWorktree: boolean;
  workspaceName: string;
  directory: string;
  updatedAt: string;
  openApprovalCount: number;
  openInteractionCount: number;
  blockedByCount: number;
}

export interface TaskDetail extends TaskSummary {
  initialPrompt: string;
  failureReason: string | null;
  automationPolicy: AutomationPolicy;
  model: string | null;
  agent: string | null;
  wikiPath: string | null;
  createdAt: string;
  startedAt: string | null;
  attachCommand: string | null;
  sessionId: string | null;
  transitions: StateTransition[];
  runs: AgentRun[];
  approvals: ApprovalRequest[];
  interactions: InteractionRequest[];
  dependencies: TaskDependency[];
  artifacts: Artifact[];
  minChunkMinutes: number;
  maxChunkMinutes: number;
  timeBlocks: TimeBlock[];
  recurrence: RecurrenceRule | null;
}

export interface Tag {
  id: number;
  publicId: string;
  title: string;
  description: string | null;
  parentIds: number[];
  reserved: boolean;
}

export interface TimeBlock {
  id: number;
  publicId: string;
  taskId: number;
  scheduleRunId: number | null;
  startAt: string;
  endAt: string;
  status: TimeBlockStatus;
  source: "manual" | "solver" | "calendar" | "recurrence";
  notes: string | null;
}

export interface RecurrenceRule {
  id: number;
  taskId: number;
  frequency: "daily" | "weekly";
  intervalCount: number;
  weekdays: number[];
  localStartTime: string | null;
  nextOccurrenceDate: string;
  active: boolean;
}

export interface WeatherForecast {
  forecastAt: string;
  temperatureF: number | null;
  precipitationProbability: number | null;
  shortForecast: string | null;
  expiresAt: string;
}

export interface HealthObservation {
  id: number;
  publicId: string;
  source: string;
  kind: "activity" | "sleep";
  startAt: string;
  endAt: string;
  externalId: string | null;
  details: JsonObject;
}

export interface ScheduleRun {
  id: number;
  publicId: string;
  modelVersion: string;
  horizonStart: string;
  horizonEnd: string;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Schedule {
  runs: ScheduleRun[];
  timeBlocks: TimeBlock[];
  unscheduledTaskIds: number[];
}

export interface StateTransition {
  id: number;
  fromState: string | null;
  toState: string;
  cause: string;
  actorType: string;
  summary: string | null;
  createdAt: string;
}

export interface AgentRun {
  id: number;
  stateKey: string;
  trigger: string;
  status: RunStatus;
  outcome: StateOutcome | null;
  summary: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ApprovalRequest {
  id: number;
  actionType: string;
  scope: "once" | "state";
  description: string;
  proposedAction: JsonObject;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedAt: string;
  resolvedAt: string | null;
}

export interface InteractionRequest {
  id: number;
  kind: "question" | "permission";
  prompt: string;
  request: JsonObject | null;
  status: "pending" | "answered" | "rejected" | "expired";
  createdAt: string;
  resolvedAt: string | null;
}

export interface TaskDependency {
  id: number;
  blockerTaskId: number;
  blockerTitle: string;
  requiredState: string;
  satisfiedAt: string | null;
}

export interface Artifact {
  id: number;
  kind: string;
  label: string;
  uri: string;
  createdAt: string;
}

export interface CreateWorkspaceInput {
  name: string;
  directory: string;
  repository?: string;
  defaultBranch?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  taskType?: TaskType;
  initialPrompt?: string;
  workspaceId?: number;
  isNewWorktree?: boolean;
  priority?: number;
  model?: string;
  agent?: string;
  automationPolicy?: AutomationPolicy;
  startImmediately?: boolean;
  kanbanStatus?: KanbanStatus;
  rank?: number;
  durationMinutes?: number | null;
  splittable?: boolean;
  minChunkMinutes?: number;
  maxChunkMinutes?: number;
  earliestStart?: string;
  deadlineAt?: string;
  fixedStart?: string;
  fixedEnd?: string;
  parentTaskId?: number;
  tagIds?: number[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  kanbanStatus?: KanbanStatus;
  priority?: number;
  rank?: number;
  durationMinutes?: number | null;
  splittable?: boolean;
  minChunkMinutes?: number;
  maxChunkMinutes?: number;
  earliestStart?: string | null;
  deadlineAt?: string | null;
  fixedStart?: string | null;
  fixedEnd?: string | null;
  parentTaskId?: number | null;
  tagIds?: number[];
}

export interface CreateTagInput {
  title: string;
  description?: string;
  parentIds?: number[];
}

export interface CreateTimeBlockInput {
  taskId: number;
  startAt: string;
  endAt: string;
  status?: TimeBlockStatus;
  source?: TimeBlock["source"];
  notes?: string;
}

export interface UpsertRecurrenceInput {
  frequency: RecurrenceRule["frequency"];
  intervalCount?: number;
  weekdays?: number[];
  localStartTime?: string;
  nextOccurrenceDate: string;
}

export interface CreateDependencyInput {
  blockerTaskId: number;
  requiredStateKey: string;
}

export interface CreateResourceRequirementInput {
  resourceId: number;
  stateKey?: string;
}
