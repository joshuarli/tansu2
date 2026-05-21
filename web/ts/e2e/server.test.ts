import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, firefox, webkit, type Browser, type BrowserType } from "playwright";

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let baseUrl = "";
let vaultOnePath = "";
const e2eBrowser = browserTypeFromEnv();

type TestFixture = {
  configHome: string;
  vaultOne: string;
  vaultTwo: string;
};

type TestNoteMeta = {
  noteId: string;
  path: string;
  title: string;
};

type TestNoteDocument = {
  meta: TestNoteMeta;
  content: string;
};

describe("real server harness", () => {
  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "tansu2-e2e-"));
    const fixture = JSON.parse(
      execFileSync(process.execPath, ["scripts/test-fixture.mjs", root], {
        cwd: process.cwd(),
        encoding: "utf8",
      }),
    ) as TestFixture;
    vaultOnePath = fixture.vaultOne;
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn("cargo", ["run", "--quiet", "--bin", "tansu2", "--", "--port", String(port)], {
      cwd: process.cwd(),
      env: { ...process.env, XDG_CONFIG_HOME: fixture.configHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForReady(`${baseUrl}/api/health`);
    browser = await e2eBrowser.launch();
  });

  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  it("starts with two seeded vaults and loads the static app", async () => {
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { "X-Tansu-Vault": "1" },
    }).then((response) => response.json());
    expect(bootstrap.vaults).toHaveLength(2);
    expect(bootstrap.activeVault).toBe(1);
    expect(bootstrap.notes[0].title).toBe("Two");
    const vaultOneBootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { "X-Tansu-Vault": "0" },
    }).then((response) => response.json() as Promise<{ notes: TestNoteMeta[] }>);
    const notesByPath = new Map(vaultOneBootstrap.notes.map((note) => [note.path, note]));
    expect([...notesByPath.keys()]).toEqual(
      expect.arrayContaining(["one.md", "search.md", "visual.md"]),
    );
    const seededDocuments = new Map<string, string>();
    for (const path of ["one.md", "search.md", "visual.md"]) {
      const note = notesByPath.get(path);
      if (note === undefined) {
        throw new Error(`missing seeded note: ${path}`);
      }
      const document = await fetch(`${baseUrl}/api/notes/${encodeURIComponent(note.noteId)}`, {
        headers: { "X-Tansu-Vault": "0" },
      }).then((response) => response.json() as Promise<TestNoteDocument>);
      seededDocuments.set(note.path, document.content);
    }
    expect(new Set(seededDocuments.values()).size).toBe(3);
    expect(seededDocuments.get("one.md")).toContain("# One");
    expect(seededDocuments.get("search.md")).toContain("# Search Fixture");
    expect(seededDocuments.get("visual.md")).toContain("![[z-images/sample.webp|132]]");
    const sample = await fetch(
      `${baseUrl}/api/assets?name=${encodeURIComponent("z-images/sample.webp")}&vault=0`,
    );
    expect(sample.ok).toBe(true);
    expect((await sample.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const page = await browser!.newPage();
    const startupRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || url.pathname === "/events") {
        startupRequests.push(`${request.method()} ${url.pathname}${url.search}`);
      }
    });
    const sessionRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "PUT" && url.pathname === "/api/session";
    });
    await page.goto(baseUrl);
    await page.waitForSelector(".main");
    await sessionRequest;
    expect(startupRequests[0]).toBe("GET /api/bootstrap");
    expect(startupRequests).toContain("GET /events?vault=0");
    expect(startupRequests).toContain("PUT /api/session");
    expect(
      startupRequests.filter((request) => request.startsWith("GET /api/notes/")).length,
    ).toBeLessThanOrEqual(3);
    await page.locator(".note-row", { hasText: "Visual Checkseeded note" }).first().click();
    await page.waitForSelector('.app-editor img[data-wiki-image="z-images/sample.webp"]');
    await page.close();
  });

  it("locks in modal, search, toolbar, and note management UX", async () => {
    const page = await browser!.newPage();
    page.on("dialog", (dialog) => {
      throw new Error(`unexpected native dialog: ${dialog.type()} ${dialog.message()}`);
    });
    await page.goto(baseUrl);
    await page.waitForSelector(".main");
    await page.locator('.note-row[title="one.md"]').first().click();
    await page.waitForSelector(".workspace > .toolbar");
    expect(await page.locator(".workspace > .toolbar").count()).toBe(1);
    expect(await page.locator(".section-title", { hasText: "Notes" }).count()).toBe(0);
    expect(await page.locator('.toolbar [title="Source"] svg').count()).toBe(1);
    expect(await page.locator('.toolbar [title="Save"] svg').count()).toBe(1);
    expect(await page.locator('.toolbar [title="Highlight"] svg').count()).toBe(1);
    expect(await page.locator('.toolbar [title="Strikethrough"] svg').count()).toBe(1);
    expect(await page.locator('.toolbar [title="Highlight"] svg [fill="#ffe16a"]').count()).toBe(1);
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector(".tabs")!).scrollbarWidth),
    ).toBe("none");

    await page.locator('.sidebar-controls [title="New note"]').click();
    await page.waitForSelector(".note-dialog-panel");
    await page.locator(".overlay-backdrop").click({ position: { x: 4, y: 4 } });
    await page.waitForSelector(".note-dialog-panel", { state: "detached" });

    await page.locator('.sidebar-controls [title="New note"]').click();
    await page.locator(".note-dialog-panel input").fill("Meeting Notes");
    await page.locator(".note-dialog-panel .primary-button").click();
    await page.waitForFunction(() =>
      document.querySelector(".tab.active")?.textContent?.includes("Meeting Notes"),
    );
    const chromeAlignment = await page.evaluate(() => {
      const vaultText = document.querySelector(".vault-label")?.getBoundingClientRect();
      const tabText = document
        .querySelector(".tab.active span:first-child")
        ?.getBoundingClientRect();
      const vaultControl = document.querySelector(".vault-control")?.getBoundingClientRect();
      const tabControl = document.querySelector(".tab.active")?.getBoundingClientRect();
      if (
        vaultText === undefined ||
        tabText === undefined ||
        vaultControl === undefined ||
        tabControl === undefined
      ) {
        return undefined;
      }
      return {
        textDelta: tabText.top - vaultText.top,
        controlDelta: tabControl.top - vaultControl.top,
      };
    });
    expect(chromeAlignment).toBeDefined();
    expect(Math.abs(chromeAlignment!.textDelta)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(chromeAlignment!.controlDelta)).toBeLessThanOrEqual(0.5);

    await page.locator('.sidebar-controls [title="Search notes"]').click();
    await page.locator(".search-panel input").fill("alpha");
    await page.waitForSelector(".search-snippet b");
    expect(
      (await page.locator(".search-snippet b").first().textContent())?.toLowerCase(),
    ).toContain("alpha");
    expect(await page.locator(".search-score").first().textContent()).toContain("content");
    await page.locator(".overlay-backdrop").click({ position: { x: 4, y: 4 } });
    await page.waitForSelector(".search-panel", { state: "detached" });

    await page.locator(".tab.active").click({ button: "right" });
    await page.waitForSelector(".context-menu");
    const menuText = await page.locator(".context-menu").textContent();
    expect(menuText).toContain("Rename");
    expect(menuText).toContain("Pin");
    expect(menuText).toContain("Delete");

    await page.locator(".context-menu", { hasText: "Pin" }).getByText("Pin").click();
    await page.waitForSelector(".context-menu", { state: "detached" });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".sidebar-section")]
          .find((section) => section.textContent?.includes("Pinned"))
          ?.textContent?.includes("Meeting Notes") === true,
    );

    await page.locator(".tab.active").click({ button: "right" });
    await page.locator(".context-menu", { hasText: "Rename" }).getByText("Rename").click();
    await page.locator(".note-dialog-panel input").fill("Renamed Note");
    const renameResponse = page.waitForResponse(
      (response) => response.url().includes("/rename") && response.status() === 200,
    );
    await page.locator(".note-dialog-panel .primary-button").click();
    await renameResponse;
    await page.waitForSelector(".note-dialog-panel", { state: "detached" });

    await page.locator(".tab.active").click({ button: "right" });
    await page.locator(".context-menu", { hasText: "Delete" }).getByText("Delete").click();
    await page.waitForFunction(() =>
      document.querySelector(".note-dialog-panel")?.textContent?.includes("renamed-note.md"),
    );
    await page.locator(".note-dialog-panel .danger-button").click();
    await page.waitForSelector(".note-dialog-panel", { state: "detached" });
    const afterDelete = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { "X-Tansu-Vault": "0" },
    }).then((response) => response.json());
    expect(
      afterDelete.notes.some((note: { path: string }) => note.path === "renamed-note.md"),
    ).toBe(false);
    await page.close();
  });

  it("keeps note bodies isolated when switching notes before saving", async () => {
    const page = await browser!.newPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");
    const searchBefore = await openSeededDocument("search.md");

    await page.locator('.note-row[title="one.md"]').first().click();
    await page.waitForFunction(() =>
      document.querySelector(".app-editor")?.textContent?.includes("alpha"),
    );

    await page.locator('.note-row[title="search.md"]').first().click();
    await page.waitForFunction(() =>
      document.querySelector(".app-editor")?.textContent?.includes("Search Fixture"),
    );
    await page.locator('.toolbar [title="Save"]').click();
    await page.waitForTimeout(500);

    const searchAfter = await openSeededDocument("search.md");
    expect(searchAfter.content).toBe(searchBefore.content);
    expect(searchAfter.content).toContain("# Search Fixture");
    expect(searchAfter.content).not.toBe("# One\n\nalpha\n");
    await page.close();
  });

  it("streams vault-scoped note changes over SSE", async () => {
    const page = await browser!.newPage();
    await page.goto(baseUrl);
    const eventPromise = page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const source = new EventSource("/events?vault=0");
        source.addEventListener(
          "open",
          () => {
            void fetch("/api/notes", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Tansu-Vault": "0",
              },
              body: JSON.stringify({ path: "sse.md", content: "# SSE\n\nbody\n", source: null }),
            });
          },
          { once: true },
        );
        source.addEventListener("message", (event) => {
          const payload = JSON.parse((event as MessageEvent<string>).data) as {
            kind: string;
            notes: Array<{ title: string }>;
          };
          if (
            payload.kind === "note_changed" &&
            payload.notes.some((note) => note.title === "SSE")
          ) {
            source.close();
            resolve(payload.kind);
          }
        });
      });
    });
    await expect(eventPromise).resolves.toBe("note_changed");
    await page.close();
  });

  it("reconciles external filesystem edits for the active vault", async () => {
    const page = await browser!.newPage();
    await page.goto(baseUrl);
    const eventPromise = page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const source = new EventSource("/events?vault=0");
        source.addEventListener("message", (event) => {
          const payload = JSON.parse((event as MessageEvent<string>).data) as {
            kind: string;
            notes: Array<{ title: string }>;
          };
          if (
            payload.kind === "vault_changed" &&
            payload.notes.some((note) => note.title === "Outside")
          ) {
            source.close();
            resolve(payload.kind);
          }
        });
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 900));
    await writeFile(join(vaultOnePath, "outside.md"), "# Outside\n\nedit\n", "utf8");
    await expect(eventPromise).resolves.toBe("vault_changed");
    await page.close();
  });

  it("restores revisions and serves vault-scoped image assets", async () => {
    const created = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tansu-Vault": "0",
      },
      body: JSON.stringify({ path: "recover.md", content: "# Recover\n\nold\n", source: null }),
    }).then((response) => response.json());
    await fetch(`${baseUrl}/api/notes/${created.meta.noteId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Tansu-Vault": "0",
      },
      body: JSON.stringify({
        content: "# Recover\n\nnew\n",
        baseSeq: created.meta.seq,
        baseHash: created.meta.contentHash,
        checkpoint: true,
      }),
    });
    const revisions = await fetch(`${baseUrl}/api/notes/${created.meta.noteId}/revisions`, {
      headers: { "X-Tansu-Vault": "0" },
    }).then((response) => response.json());
    const oldest = revisions.at(-1);
    const restored = await fetch(
      `${baseUrl}/api/notes/${created.meta.noteId}/revisions/${oldest.eventId}/restore`,
      {
        method: "POST",
        headers: { "X-Tansu-Vault": "0" },
      },
    ).then((response) => response.json());
    expect(restored.document.content).toContain("old");

    const uploaded = await fetch(`${baseUrl}/api/images`, {
      method: "POST",
      headers: {
        "Content-Type": "image/webp",
        "X-Tansu-Vault": "0",
      },
      body: new Uint8Array([1, 2, 3]),
    }).then((response) => response.json());
    const asset = await fetch(
      `${baseUrl}/api/assets?name=${encodeURIComponent(uploaded.name)}&vault=0`,
    );
    expect(asset.ok).toBe(true);
    expect(await asset.arrayBuffer()).toHaveProperty("byteLength", 3);
  });
});

function browserTypeFromEnv(): BrowserType {
  switch (process.env["TANSU2_E2E_BROWSER"]) {
    case "firefox":
      return firefox;
    case "webkit":
      return webkit;
    default:
      return chromium;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => {
        if (address !== null && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("no free port"));
        }
      });
    });
  });
}

async function waitForReady(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready: ${url}`);
}

async function openSeededDocument(path: string): Promise<TestNoteDocument> {
  const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
    headers: { "X-Tansu-Vault": "0" },
  }).then((response) => response.json() as Promise<{ notes: TestNoteMeta[] }>);
  const note = bootstrap.notes.find((item) => item.path === path);
  if (note === undefined) {
    throw new Error(`missing seeded note: ${path}`);
  }
  return fetch(`${baseUrl}/api/notes/${encodeURIComponent(note.noteId)}`, {
    headers: { "X-Tansu-Vault": "0" },
  }).then((response) => response.json() as Promise<TestNoteDocument>);
}
