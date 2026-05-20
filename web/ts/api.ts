import type {
  BootstrapResponse,
  CreateNoteRequest,
  NoteDocument,
  NoteMutationResponse,
  RenameNoteRequest,
  SaveNoteRequest,
  SearchHit,
  ServerEvent,
  SessionState,
  Settings,
} from "./types.generated.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly response: unknown;

  constructor(message: string, status: number, response: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.response = response;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { vault?: number } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Tansu-Vault", String(options.vault ?? activeVault()));
  const response = await fetch(path, { ...options, headers });
  const data = (await response.json().catch(() => null)) as T;
  if (!response.ok) {
    throw new ApiError(`API request failed: ${response.status}`, response.status, data);
  }
  return data;
}

export function bootstrap(vault = activeVault()): Promise<BootstrapResponse> {
  return apiFetch<BootstrapResponse>("/api/bootstrap", { vault });
}

export function openNote(noteId: string, vault = activeVault()): Promise<NoteDocument> {
  return apiFetch<NoteDocument>(`/api/notes/${encodeURIComponent(noteId)}`, { vault });
}

export function createNote(
  request: CreateNoteRequest,
  vault = activeVault(),
): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>("/api/notes", {
    method: "POST",
    body: JSON.stringify(request),
    vault,
  });
}

export function saveNote(
  noteId: string,
  request: SaveNoteRequest,
  vault = activeVault(),
): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: "PUT",
    body: JSON.stringify(request),
    vault,
  });
}

export function renameNote(
  noteId: string,
  request: RenameNoteRequest,
  vault = activeVault(),
): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(`/api/notes/${encodeURIComponent(noteId)}/rename`, {
    method: "POST",
    body: JSON.stringify(request),
    vault,
  });
}

export function deleteNote(noteId: string, vault = activeVault()): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
    vault,
  });
}

export function setPinned(
  noteId: string,
  pinned: boolean,
  vault = activeVault(),
): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/notes/${encodeURIComponent(noteId)}/pin`, {
    method: pinned ? "POST" : "DELETE",
    vault,
  });
}

export function searchNotes(query: string, vault = activeVault()): Promise<SearchHit[]> {
  return apiFetch<SearchHit[]>(`/api/search?q=${encodeURIComponent(query)}`, { vault });
}

export function saveSession(session: SessionState, vault = activeVault()): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>("/api/session", {
    method: "PUT",
    body: JSON.stringify(session),
    vault,
  });
}

export function saveSettings(settings: Settings, vault = activeVault()): Promise<Settings> {
  return apiFetch<Settings>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
    vault,
  });
}

export function activeVault(): number {
  return Number(sessionStorage.getItem("tansu2.activeVault") ?? "0");
}

export function setActiveVault(index: number): void {
  sessionStorage.setItem("tansu2.activeVault", String(index));
}

export function connectEvents(vault = activeVault()): EventSource {
  return new EventSource(`/events?vault=${encodeURIComponent(String(vault))}`);
}

export function parseServerEvent(event: MessageEvent<string>): ServerEvent {
  return JSON.parse(event.data) as ServerEvent;
}
