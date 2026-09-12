import type {
  CreateTaskInput,
  HealthObservation,
  KanbanStatus,
  Schedule,
  Tag,
  TaskDetail,
  TaskSummary,
  Workflow,
  Workspace,
  WeatherForecast,
} from "@opencode-task-manager/shared";

export interface Resource {
  id: number;
  key: string;
  name: string;
  description: string | null;
  leasedByTaskId: number | null;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = (await response.json()) as T | { error: string };
  if (!response.ok) throw new Error("error" in (body as object) ? (body as { error: string }).error : response.statusText);
  return body as T;
}

export const api = {
  tasks: () => request<TaskSummary[]>("/api/tasks"),
  tags: () => request<Tag[]>("/api/tags"),
  schedule: () => request<Schedule>("/api/schedule"),
  weather: () => request<WeatherForecast[]>("/api/weather"),
  healthObservations: () => request<HealthObservation[]>("/api/health-observations"),
  task: (id: number) => request<TaskDetail>(`/api/tasks/${id}`),
  workflows: () => request<Workflow[]>("/api/workflows"),
  workspaces: () => request<Workspace[]>("/api/workspaces"),
  resources: () => request<Resource[]>("/api/resources"),
  createWorkspace: (input: { name: string; directory: string; repository?: string }) =>
    request<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify(input) }),
  createTask: (input: CreateTaskInput) =>
    request<TaskDetail>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
  updateTask: (id: number, input: { kanbanStatus?: KanbanStatus; rank?: number; tagIds?: number[]; title?: string; description?: string | null; priority?: number; durationMinutes?: number | null; splittable?: boolean; earliestStart?: string | null; deadlineAt?: string | null; fixedStart?: string | null; fixedEnd?: string | null }) =>
    request<TaskDetail>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  createTag: (input: { title: string; description?: string; parentIds?: number[] }) =>
    request<Tag>("/api/tags", { method: "POST", body: JSON.stringify(input) }),
  startAgent: (id: number) => request<TaskDetail>(`/api/tasks/${id}/start-agent`, { method: "POST" }),
  generateSchedule: () => request<Schedule>("/api/schedule/generate", { method: "POST" }),
  acceptTaskSchedule: (id: number) => request<Schedule>(`/api/tasks/${id}/accept-schedule`, { method: "POST" }),
  setTimeBlockStatus: (id: number, status: "completed" | "missed") =>
    request<Schedule>(`/api/time-blocks/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  refreshWeather: () => request<WeatherForecast[]>("/api/weather/refresh", { method: "POST" }),
  pauseTask: (id: number) => request<TaskDetail>(`/api/tasks/${id}/pause`, { method: "POST" }),
  resumeTask: (id: number) => request<TaskDetail>(`/api/tasks/${id}/resume`, { method: "POST" }),
  runTask: (id: number) => request<TaskDetail>(`/api/tasks/${id}/run`, { method: "POST" }),
  setLifecycle: (id: number, status: string) =>
    request<TaskDetail>(`/api/tasks/${id}/lifecycle`, { method: "POST", body: JSON.stringify({ status }) }),
  transitionTask: (id: number, stateKey: string) =>
    request<TaskDetail>(`/api/tasks/${id}/transition`, { method: "POST", body: JSON.stringify({ stateKey }) }),
  decideApproval: (id: number, decision: "approve" | "reject") =>
    request<TaskDetail>(`/api/approvals/${id}/${decision}`, { method: "POST" }),
  replyInteraction: (id: number, response: unknown) =>
    request<TaskDetail>(`/api/interactions/${id}/reply`, { method: "POST", body: JSON.stringify({ response }) }),
  addDependency: (taskId: number, blockerTaskId: number, requiredStateKey: string) =>
    request<TaskDetail>(`/api/tasks/${taskId}/dependencies`, {
      method: "POST",
      body: JSON.stringify({ blockerTaskId, requiredStateKey }),
    }),
  addResource: (taskId: number, resourceId: number, stateKey?: string) =>
    request<TaskDetail>(`/api/tasks/${taskId}/resources`, {
      method: "POST",
      body: JSON.stringify({ resourceId, stateKey }),
    }),
};
