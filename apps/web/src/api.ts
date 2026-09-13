import type {
  CreateTaskInput,
  HealthObservation,
  KanbanStatus,
  Schedule,
  Tag,
  TaskDetail,
  TaskSummary,
  WeatherForecast,
} from "@mind-palace/shared";

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
  createTask: (input: CreateTaskInput) =>
    request<TaskDetail>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
  updateTask: (id: number, input: { kanbanStatus?: KanbanStatus; rank?: number; tagIds?: number[]; title?: string; description?: string | null; priority?: number; durationMinutes?: number | null; splittable?: boolean; earliestStart?: string | null; deadlineAt?: string | null; fixedStart?: string | null; fixedEnd?: string | null }) =>
    request<TaskDetail>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  createTag: (input: { title: string; description?: string; parentIds?: number[] }) =>
    request<Tag>("/api/tags", { method: "POST", body: JSON.stringify(input) }),
  generateSchedule: () => request<Schedule>("/api/schedule/generate", { method: "POST" }),
  acceptTaskSchedule: (id: number) => request<Schedule>(`/api/tasks/${id}/accept-schedule`, { method: "POST" }),
  setTimeBlockStatus: (id: number, status: "completed" | "missed") =>
    request<Schedule>(`/api/time-blocks/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  refreshWeather: () => request<WeatherForecast[]>("/api/weather/refresh", { method: "POST" }),
  setLifecycle: (id: number, status: string) =>
    request<TaskDetail>(`/api/tasks/${id}/lifecycle`, { method: "POST", body: JSON.stringify({ status }) }),
};