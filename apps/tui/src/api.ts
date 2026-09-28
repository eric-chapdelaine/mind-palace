import type { CreateTaskInput, KanbanStatus, Tag, TaskDetail, TaskSummary } from "@mind-palace/shared";

/**
 * Typed fetch client for the Mind Palace HTTP API — the only network layer in the TUI.
 * Mirrors the web app's `api.ts`: one method per endpoint, server `{ error }` bodies
 * become thrown Errors rendered in the status bar.
 */
async function request<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = (await response.json()) as T | { error?: unknown };
  if (!response.ok) {
    const message = typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : response.statusText;
    throw new Error(message);
  }
  return body as T;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  kanbanStatus?: KanbanStatus;
  rank?: number;
}

export interface TaskClient {
  baseUrl: string;
  tasks(): Promise<TaskSummary[]>;
  tags(): Promise<Tag[]>;
  createTask(input: CreateTaskInput): Promise<TaskDetail>;
  updateTask(id: number, input: UpdateTaskInput): Promise<TaskDetail>;
  createTag(input: { title: string; description?: string }): Promise<Tag>;
  updateTag(id: number, input: { title?: string; description?: string | null }): Promise<Tag>;
}

export function createClient(baseUrl: string): TaskClient {
  const call = <T>(path: string, options?: RequestInit) => request<T>(baseUrl, path, options);
  return {
    baseUrl,
    tasks: () => call<TaskSummary[]>("/api/tasks"),
    tags: () => call<Tag[]>("/api/tags"),
    createTask: (input) => call<TaskDetail>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
    updateTask: (id, input) => call<TaskDetail>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    createTag: (input) => call<Tag>("/api/tags", { method: "POST", body: JSON.stringify(input) }),
    updateTag: (id, input) => call<Tag>(`/api/tags/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  };
}