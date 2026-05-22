import type {
  BootstrapResponse,
  CreateNoteRequest,
  ConflictDraftDocument,
  ImageUploadResponse,
  NoteDocument,
  NoteMutationResponse,
  RenameNoteRequest,
  RevisionDocument,
  RevisionMeta,
  SaveNoteDeltaRequest,
  SaveNoteRequest,
  SearchHit,
  ServerEvent,
  SessionState,
  Settings,
} from "./types.generated.ts";

class ApiError extends Error {
  readonly status: number;
  readonly response: unknown;

  constructor(message: string, status: number, response: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.response = response;
  }
}

async function apiFetch<T>(
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

export function saveNoteDelta(
  noteId: string,
  request: SaveNoteDeltaRequest,
  vault = activeVault(),
): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: "PATCH",
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

export function listRevisions(noteId: string, vault = activeVault()): Promise<RevisionMeta[]> {
  return apiFetch<RevisionMeta[]>(`/api/notes/${encodeURIComponent(noteId)}/revisions`, { vault });
}

export function openRevision(
  noteId: string,
  eventId: number,
  vault = activeVault(),
): Promise<RevisionDocument> {
  return apiFetch<RevisionDocument>(
    `/api/notes/${encodeURIComponent(noteId)}/revisions/${eventId}`,
    { vault },
  );
}

export function restoreRevision(
  noteId: string,
  eventId: number,
  vault = activeVault(),
): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(
    `/api/notes/${encodeURIComponent(noteId)}/revisions/${eventId}/restore`,
    { method: "POST", vault },
  );
}

export function openConflictDraft(
  noteId: string,
  draftId: number,
  vault = activeVault(),
): Promise<ConflictDraftDocument> {
  return apiFetch<ConflictDraftDocument>(
    `/api/notes/${encodeURIComponent(noteId)}/conflicts/${draftId}`,
    { vault },
  );
}

export function restoreConflictDraft(
  noteId: string,
  draftId: number,
  vault = activeVault(),
): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(
    `/api/notes/${encodeURIComponent(noteId)}/conflicts/${draftId}/restore`,
    { method: "POST", vault },
  );
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

export async function uploadImage(blob: Blob, vault = activeVault()): Promise<ImageUploadResponse> {
  const response = await fetch("/api/images", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "image/webp",
      "X-Tansu-Vault": String(vault),
    },
    body: blob,
  });
  const data = (await response.json().catch(() => null)) as ImageUploadResponse;
  if (!response.ok) {
    throw new ApiError(`API request failed: ${response.status}`, response.status, data);
  }
  return data;
}

export function assetUrl(name: string, vault = activeVault()): string {
  return `/api/assets?name=${encodeURIComponent(name)}&vault=${encodeURIComponent(String(vault))}`;
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
