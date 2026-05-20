import type { ApiErrorResponse } from "./types.generated.ts";

const {
  activeVault,
  assetUrl,
  bootstrap,
  connectEvents,
  createNote,
  deleteNote,
  listRevisions,
  openConflictDraft,
  openNote,
  openRevision,
  parseServerEvent,
  renameNote,
  restoreConflictDraft,
  restoreRevision,
  saveNote,
  saveSession,
  saveSettings,
  searchNotes,
  setActiveVault,
  setPinned,
  uploadImage,
} = await import("./api.ts");

describe("generated API error types", () => {
  it("uses the Rust-generated discriminant", () => {
    const response: ApiErrorResponse = {
      error: { code: "path_collision", path: "A.md" },
    };
    expect(response.error.code).toBe("path_collision");
  });
});

describe("API client", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true })),
    );
    vi.stubGlobal(
      "EventSource",
      vi.fn(function EventSource(this: { url: string }, url: string) {
        this.url = url;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists the active vault and uses it by default", async () => {
    setActiveVault(3);

    expect(activeVault()).toBe(3);
    await bootstrap();

    const [, init] = fetchCall(0);
    expect(new Headers(init.headers).get("X-Tansu-Vault")).toBe("3");
  });

  it("builds note routes with encoded note ids and JSON bodies", async () => {
    await openNote("space/id", 2);
    await createNote({ path: "A.md", content: "# A\n", source: null }, 2);
    await saveNote(
      "space/id",
      { content: "# A\n", baseSeq: 1, baseHash: "h", checkpoint: true },
      2,
    );
    await renameNote("space/id", { path: "Renamed.md" }, 2);
    await deleteNote("space/id", 2);

    expect(fetchCall(0)[0]).toBe("/api/notes/space%2Fid");
    expect(fetchCall(1)[0]).toBe("/api/notes");
    expect(fetchCall(2)[0]).toBe("/api/notes/space%2Fid");
    expect(fetchCall(3)[0]).toBe("/api/notes/space%2Fid/rename");
    expect(fetchCall(4)[0]).toBe("/api/notes/space%2Fid");
    expect(JSON.parse(String(fetchCall(2)[1].body))).toMatchObject({ baseSeq: 1 });
  });

  it("throws an error with status and response body for failed JSON requests", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: { code: "bad_request" } }, 400));

    await expect(searchNotes("alpha", 1)).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      response: { error: { code: "bad_request" } },
    });
  });

  it("handles non-JSON failed responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as Response);

    await expect(
      saveSession({ openTabs: [], activeNoteId: null, closedTabs: [] }, 1),
    ).rejects.toMatchObject({
      status: 500,
      response: null,
    });
  });

  it("uploads images with webp headers and explicit vault", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ name: "z-images/a.webp", markdown: "![[a]]" }),
    );

    await expect(uploadImage(new Blob(["x"], { type: "image/png" }), 4)).resolves.toEqual({
      name: "z-images/a.webp",
      markdown: "![[a]]",
    });

    const [, init] = fetchCall(0);
    expect(fetchCall(0)[0]).toBe("/api/images");
    expect(new Headers(init.headers).get("Content-Type")).toBe("image/webp");
    expect(new Headers(init.headers).get("X-Tansu-Vault")).toBe("4");
  });

  it("builds asset, settings, conflict, and event helper requests", async () => {
    await saveSettings(settings(), 2);
    await listRevisions("n/1", 2);
    await openRevision("n/1", 10, 2);
    await restoreRevision("n/1", 10, 2);
    await openConflictDraft("n/1", 7, 2);
    await restoreConflictDraft("n/1", 7, 2);
    await setPinned("n/1", true, 2);
    await setPinned("n/1", false, 2);
    const source = connectEvents(9) as EventSource & { url: string };
    const event = parseServerEvent(new MessageEvent("message", { data: '{"kind":"x"}' }));

    expect(assetUrl("z-images/a b.webp", 2)).toBe("/api/assets?name=z-images%2Fa%20b.webp&vault=2");
    expect(fetchCall(0)[0]).toBe("/api/settings");
    expect(fetchCall(1)[0]).toBe("/api/notes/n%2F1/revisions");
    expect(fetchCall(2)[0]).toBe("/api/notes/n%2F1/revisions/10");
    expect(fetchCall(3)[0]).toBe("/api/notes/n%2F1/revisions/10/restore");
    expect(fetchCall(4)[0]).toBe("/api/notes/n%2F1/conflicts/7");
    expect(fetchCall(5)[0]).toBe("/api/notes/n%2F1/conflicts/7/restore");
    expect(fetchCall(6)[1].method).toBe("POST");
    expect(fetchCall(7)[1].method).toBe("DELETE");
    expect(source.url).toBe("/events?vault=9");
    expect(event).toEqual({ kind: "x" });
  });

  it("throws upload errors with parsed response payloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: { code: "internal" } }, 500));

    await expect(uploadImage(new Blob(["x"]), 1)).rejects.toMatchObject({
      status: 500,
      response: { error: { code: "internal" } },
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function fetchCall(index: number): [string, RequestInit] {
  return vi.mocked(fetch).mock.calls[index] as [string, RequestInit];
}

function settings() {
  return {
    excludedFolders: [],
    searchTitleWeight: 3,
    searchHeadingWeight: 2,
    searchTagWeight: 2,
    searchContentWeight: 1,
    recencyBoost: 0,
    autosaveDelayMs: 900,
    undoStackMax: 100,
    imageWebpQuality: 0.8,
  };
}
