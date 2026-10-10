import type {
  CreateTaskInput,
  GarminSyncResult,
  HealthActivity,
  IntegrationSummary,
  LifecycleStatus,
  Schedule,
  SleepSession,
  Tag,
  TagType,
  TaskDetail,
  TaskSummary,
  TimeBlock,
  UpdateHealthActivityInput,
  UpdateSleepSessionInput,
  UpdateTaskInput,
  UpdateTimeBlockInput,
  WeatherForecast,
} from "@mind-palace/shared";

function withRange(path: string, from?: string, to?: string): string {
  if (!from || !to) return path;
  return `${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
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
  healthObservations: (from?: string, to?: string) => request<SleepSession[]>(withRange("/api/health-observations", from, to)),
  healthObservation: (id: number) => request<SleepSession>(`/api/health-observations/${id}`),
  updateHealthObservation: (id: number, input: UpdateSleepSessionInput) =>
    request<SleepSession>(`/api/health-observations/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  healthActivities: (from?: string, to?: string) => request<HealthActivity[]>(withRange("/api/health-activities", from, to)),
  healthActivity: (id: number) => request<HealthActivity>(`/api/health-activities/${id}`),
  updateHealthActivity: (id: number, input: UpdateHealthActivityInput) =>
    request<HealthActivity>(`/api/health-activities/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  garminSync: () => request<GarminSyncResult>("/api/integrations/garmin/sync", { method: "POST" }),
  integrations: () => request<IntegrationSummary[]>("/api/integrations"),
  task: (id: number) => request<TaskDetail>(`/api/tasks/${id}`),
  timeBlock: (id: number) => request<TimeBlock>(`/api/time-blocks/${id}`),
  updateTimeBlock: (id: number, input: UpdateTimeBlockInput) =>
    request<TimeBlock>(`/api/time-blocks/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  createTask: (input: CreateTaskInput) =>
    request<TaskDetail>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
  updateTask: (id: number, input: UpdateTaskInput) =>
    request<TaskDetail>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  createTag: (input: { title: string; description?: string; parentIds?: number[]; type?: TagType | null }) =>
    request<Tag>("/api/tags", { method: "POST", body: JSON.stringify(input) }),
  updateTag: (id: number, input: { title?: string; description?: string | null; type?: TagType | null; isArchived?: boolean }) =>
    request<Tag>(`/api/tags/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  addTagParent: (id: number, parentId: number) =>
    request<Tag[]>(`/api/tags/${id}/parents`, { method: "POST", body: JSON.stringify({ parentId }) }),
  removeTagParent: (id: number, parentId: number) =>
    request<Tag[]>(`/api/tags/${id}/parents/${parentId}`, { method: "DELETE" }),
  generateSchedule: () => request<Schedule>("/api/schedule/generate", { method: "POST" }),
  acceptTaskSchedule: (id: number) => request<Schedule>(`/api/tasks/${id}/accept-schedule`, { method: "POST" }),
  setTimeBlockStatus: (id: number, status: "completed" | "missed") =>
    request<Schedule>(`/api/time-blocks/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  deleteTimeBlock: (id: number) => request<Schedule>(`/api/time-blocks/${id}`, { method: "DELETE" }),
  refreshWeather: () => request<WeatherForecast[]>("/api/weather/refresh", { method: "POST" }),
  setLifecycle: (id: number, status: LifecycleStatus) =>
    request<TaskDetail>(`/api/tasks/${id}/lifecycle`, { method: "POST", body: JSON.stringify({ status }) }),
  convertTaskToTag: (id: number) => request<Tag>(`/api/tasks/${id}/convert-to-tag`, { method: "POST" }),
};