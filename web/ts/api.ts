import {
  toVaultIndex,
  type AssetName,
  type ConflictDraftId,
  type ContentHash,
  type NoteId,
  type RevisionEventId,
  type VaultIndex,
} from "./state.ts";
import type {
  BootstrapResponse,
  CreateNoteRequest,
  ApiErrorResponse,
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

export type SaveConflictError = Extract<ApiErrorResponse["error"], { code: "save_conflict" }>;

function apiErrorResponse(error: unknown): ApiErrorResponse | null {
  if (!(error instanceof ApiError) || !isApiErrorResponse(error.response)) {
    return null;
  }
  return error.response;
}

export function saveConflictError(error: unknown): SaveConflictError | null {
  const response = apiErrorResponse(error);
  return response?.error.code === "save_conflict" ? response.error : null;
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (value === null || typeof value !== "object" || !("error" in value)) {
    return false;
  }
  const error = (value as { error: unknown }).error;
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

export type ApiClient = {
  bootstrap: (vault?: VaultIndex) => Promise<BootstrapResponse>;
  openNote: (noteId: NoteId, vault?: VaultIndex) => Promise<NoteDocument>;
  createNote: (request: CreateNoteRequest, vault?: VaultIndex) => Promise<NoteMutationResponse>;
  saveNote: (
    noteId: NoteId,
    request: SaveNoteRequest & { baseHash: ContentHash },
    vault?: VaultIndex,
  ) => Promise<NoteMutationResponse>;
  saveNoteDelta: (
    noteId: NoteId,
    request: SaveNoteDeltaRequest & {
      baseHash: ContentHash;
      contentHash: ContentHash;
    },
    vault?: VaultIndex,
  ) => Promise<NoteMutationResponse>;
  renameNote: (
    noteId: NoteId,
    request: RenameNoteRequest,
    vault?: VaultIndex,
  ) => Promise<NoteMutationResponse>;
  deleteNote: (noteId: NoteId, vault?: VaultIndex) => Promise<NoteMutationResponse>;
  listRevisions: (noteId: NoteId, vault?: VaultIndex) => Promise<RevisionMeta[]>;
  openRevision: (
    noteId: NoteId,
    eventId: RevisionEventId,
    vault?: VaultIndex,
  ) => Promise<RevisionDocument>;
  restoreRevision: (
    noteId: NoteId,
    eventId: RevisionEventId,
    vault?: VaultIndex,
  ) => Promise<NoteMutationResponse>;
  openConflictDraft: (
    noteId: NoteId,
    draftId: ConflictDraftId,
    vault?: VaultIndex,
  ) => Promise<ConflictDraftDocument>;
  restoreConflictDraft: (
    noteId: NoteId,
    draftId: ConflictDraftId,
    vault?: VaultIndex,
  ) => Promise<NoteMutationResponse>;
  setPinned: (noteId: NoteId, pinned: boolean, vault?: VaultIndex) => Promise<{ ok: true }>;
  searchNotes: (query: string, vault?: VaultIndex) => Promise<SearchHit[]>;
  saveSession: (session: SessionState, vault?: VaultIndex) => Promise<{ ok: true }>;
  saveSettings: (settings: Settings, vault?: VaultIndex) => Promise<Settings>;
  uploadImage: (blob: Blob, vault?: VaultIndex) => Promise<ImageUploadResponse>;
  assetUrl: (name: AssetName, vault?: VaultIndex) => string;
  activeVault: () => VaultIndex;
  setActiveVault: (index: VaultIndex) => void;
  connectEvents: (vault?: VaultIndex) => EventSource;
  parseServerEvent: (event: MessageEvent<string>) => ServerEvent;
};

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

export function openNote(noteId: NoteId, vault = activeVault()): Promise<NoteDocument> {
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
  noteId: NoteId,
  request: SaveNoteRequest & { baseHash: ContentHash },
  vault = activeVault(),
): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: "PUT",
    body: JSON.stringify(request),
    vault,
  });
}

export function saveNoteDelta(
  noteId: NoteId,
  request: SaveNoteDeltaRequest & { baseHash: ContentHash; contentHash: ContentHash },
  vault = activeVault(),
): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: "PATCH",
    body: JSON.stringify(request),
    vault,
  });
}

export function renameNote(
  noteId: NoteId,
  request: RenameNoteRequest,
  vault = activeVault(),
): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(`/api/notes/${encodeURIComponent(noteId)}/rename`, {
    method: "POST",
    body: JSON.stringify(request),
    vault,
  });
}

export function deleteNote(noteId: NoteId, vault = activeVault()): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
    vault,
  });
}

export function listRevisions(noteId: NoteId, vault = activeVault()): Promise<RevisionMeta[]> {
  return apiFetch<RevisionMeta[]>(`/api/notes/${encodeURIComponent(noteId)}/revisions`, { vault });
}

export function openRevision(
  noteId: NoteId,
  eventId: RevisionEventId,
  vault = activeVault(),
): Promise<RevisionDocument> {
  return apiFetch<RevisionDocument>(
    `/api/notes/${encodeURIComponent(noteId)}/revisions/${eventId}`,
    { vault },
  );
}

export function restoreRevision(
  noteId: NoteId,
  eventId: RevisionEventId,
  vault = activeVault(),
): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(
    `/api/notes/${encodeURIComponent(noteId)}/revisions/${eventId}/restore`,
    { method: "POST", vault },
  );
}

export function openConflictDraft(
  noteId: NoteId,
  draftId: ConflictDraftId,
  vault = activeVault(),
): Promise<ConflictDraftDocument> {
  return apiFetch<ConflictDraftDocument>(
    `/api/notes/${encodeURIComponent(noteId)}/conflicts/${draftId}`,
    { vault },
  );
}

export function restoreConflictDraft(
  noteId: NoteId,
  draftId: ConflictDraftId,
  vault = activeVault(),
): Promise<NoteMutationResponse> {
  return apiFetch<NoteMutationResponse>(
    `/api/notes/${encodeURIComponent(noteId)}/conflicts/${draftId}/restore`,
    { method: "POST", vault },
  );
}

export function setPinned(
  noteId: NoteId,
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

export function assetUrl(name: AssetName, vault = activeVault()): string {
  return `/api/assets?name=${encodeURIComponent(name)}&vault=${encodeURIComponent(String(vault))}`;
}

export function activeVault(): VaultIndex {
  return toVaultIndex(Number(sessionStorage.getItem("tansu2.activeVault") ?? "0"));
}

export function setActiveVault(index: VaultIndex): void {
  sessionStorage.setItem("tansu2.activeVault", String(index));
}

export function connectEvents(vault = activeVault()): EventSource {
  return new EventSource(`/events?vault=${encodeURIComponent(String(vault))}`);
}

export function parseServerEvent(event: MessageEvent<string>): ServerEvent {
  return JSON.parse(event.data) as ServerEvent;
}

function createApiClient(): ApiClient {
  return {
    bootstrap,
    openNote,
    createNote,
    saveNote,
    saveNoteDelta,
    renameNote,
    deleteNote,
    listRevisions,
    openRevision,
    restoreRevision,
    openConflictDraft,
    restoreConflictDraft,
    setPinned,
    searchNotes,
    saveSession,
    saveSettings,
    uploadImage,
    assetUrl,
    activeVault,
    setActiveVault,
    connectEvents,
    parseServerEvent,
  };
}

export const apiClient = createApiClient();
