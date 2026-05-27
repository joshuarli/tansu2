import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
  type Page,
  type Request,
} from "playwright";
import { expect, afterAll, beforeEach, describe, beforeAll, it } from "vitest";

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let baseUrl = "";
let vaultOnePath = "";
const serverOutput: string[] = [];
const e2eBrowser = browserTypeFromEnv();

type TestFixture = {
  configHome: string;
  dataHome: string;
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

type LogEvent = {
  seq: number;
  ts: number;
  source: string;
  level: string;
  kind: string;
  requestId?: string;
} & Record<string, unknown>;

describe("real server harness", () => {
  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "tansu2-e2e-"));
    const fixture = JSON.parse(
      execFileSync(process.execPath, ["scripts/test-fixture.mjs", root, "--copy-vaults"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }),
    ) as TestFixture;
    vaultOnePath = fixture.vaultOne;
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn("cargo", ["run", "--quiet", "--bin", "tansu2", "--", "--port", String(port)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TANSU2_LOGS: "buffer",
        XDG_CONFIG_HOME: fixture.configHome,
        XDG_DATA_HOME: fixture.dataHome,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk: Buffer) => serverOutput.push(chunk.toString("utf8")));
    server.stderr?.on("data", (chunk: Buffer) => serverOutput.push(chunk.toString("utf8")));
    await waitForReady(`${baseUrl}/api/health`);
    browser = await e2eBrowser.launch();
  });

  beforeEach((context) => {
    context.onTestFailed(async () => {
      await dumpUnifiedLogs(context.task.name);
    }, 10_000);
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
    expect([...notesByPath.keys()]).toStrictEqual(
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
    expect(sample.ok).toBeTruthy();
    expect((await sample.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const page = await newLoggedPage();
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
    const page = await newLoggedPage();
    page.on("dialog", (dialog) => {
      throw new Error(`unexpected native dialog: ${dialog.type()} ${dialog.message()}`);
    });
    await page.goto(baseUrl);
    await page.waitForSelector(".main");
    await page.locator('.note-row[title="one.md"]').first().click();
    await page.waitForSelector(".workspace > .toolbar");
    await expect(page.locator(".workspace > .toolbar").count()).resolves.toBe(1);
    await expect(page.locator(".section-title", { hasText: "Notes" }).count()).resolves.toBe(0);
    await expect(page.locator('.toolbar [title="Source"] svg').count()).resolves.toBe(1);
    await expect(page.locator('.toolbar [title="Save"] svg').count()).resolves.toBe(1);
    await expect(page.locator('.toolbar [title="Highlight"] svg').count()).resolves.toBe(1);
    await expect(page.locator('.toolbar [title="Strikethrough"] svg').count()).resolves.toBe(1);
    await expect(
      page.locator('.toolbar [title="Highlight"] svg [fill="#ffe16a"]').count(),
    ).resolves.toBe(1);
    await expect(
      page.evaluate(() => getComputedStyle(document.querySelector(".tabs")!).scrollbarWidth),
    ).resolves.toBe("none");

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
    await expect(page.locator(".search-score").first().textContent()).resolves.toContain("content");
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
    ).toBeFalsy();
    await page.close();
  });

  it("keeps note bodies isolated when switching notes before saving", async () => {
    const page = await newLoggedPage();
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

  it("keeps immediate typing after Enter in the visual editor", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await page.locator('.sidebar-controls [title="New note"]').click();
    await page.locator(".note-dialog-panel input").fill("Immediate Cursor");
    await page.locator(".note-dialog-panel .primary-button").click();
    await page.waitForFunction(() =>
      document.querySelector(".tab.active")?.textContent?.includes("Immediate Cursor"),
    );
    await expect
      .poll(() =>
        page.locator(".app-editor").evaluate((editor) => {
          const anchor = getSelection()?.anchorNode;
          const element = anchor instanceof Element ? anchor : anchor?.parentElement;
          return element?.closest("p")?.parentElement === editor;
        }),
      )
      .toBe(true);
    const saveResponse = waitForNoteSave(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("bar");

    await expect
      .poll(() => visibleParagraphLayout(page, "Immediate Cursor", "bar", 1))
      .toMatchObject({
        blankCount: 1,
        ordered: true,
        blankHasLineBox: true,
        gapLooksLikeBlankLine: true,
      });
    await saveResponse;
    const saved = await openSeededDocument("immediate-cursor.md");
    expect(saved.content).toBe("# Immediate Cursor\r\n\r\nbar");
    await page.close();
  });

  it("preserves repeated blank lines across autosave", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await page.locator('.sidebar-controls [title="New note"]').click();
    await page.locator(".note-dialog-panel input").fill("Blank Lines");
    await page.locator(".note-dialog-panel .primary-button").click();
    await page.waitForFunction(() =>
      document.querySelector(".tab.active")?.textContent?.includes("Blank Lines"),
    );
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => activeCursorBlankLayout(page, "Blank Lines"))
      .toMatchObject({
        visibleBlankCountAfterText: 3,
        cursorHasLineBox: true,
        cursorIsAfterBlankLine: true,
      });
    await waitForNoteSave(page);

    await expect
      .poll(() => page.locator(".app-editor").evaluate((editor) => editor.textContent ?? ""))
      .toBe("Blank Lines\n\n\n");
    await expect
      .poll(() =>
        page.locator(".app-editor").evaluate((editor) => {
          const anchor = getSelection()?.anchorNode;
          const element = anchor instanceof Element ? anchor : anchor?.parentElement;
          return element?.closest("p")?.parentElement === editor;
        }),
      )
      .toBe(true);

    const saved = await openSeededDocument("blank-lines.md");
    expect(saved.content).toBe("# Blank Lines\r\n\r\n\r\n");
    await page.close();
  });

  it("preserves blank lines inserted between typed paragraphs", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await page.locator('.sidebar-controls [title="New note"]').click();
    await page.locator(".note-dialog-panel input").fill("Collapse Repro");
    await page.locator(".note-dialog-panel .primary-button").click();
    await page.waitForFunction(() =>
      document.querySelector(".tab.active")?.textContent?.includes("Collapse Repro"),
    );
    await page.keyboard.type("foo");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("bar");

    await expect
      .poll(() => visibleParagraphLayout(page, "foo", "bar", 1))
      .toMatchObject({
        blankCount: 1,
        ordered: true,
        blankHasLineBox: true,
        gapLooksLikeBlankLine: true,
      });
    await waitForNoteSave(page);

    const saved = await openSeededDocument("collapse-repro.md");
    expect(saved.content).toBe("# Collapse Repro\r\nfoo\r\n\r\nbar");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => visibleParagraphLayout(page, "foo", "bar", 1))
      .toMatchObject({
        blankCount: 1,
        ordered: true,
        blankHasLineBox: true,
        gapLooksLikeBlankLine: true,
      });
    await page.close();
  });

  it("places the visual cursor after a real blank line when pressing Enter twice", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await page.locator('.sidebar-controls [title="New note"]').click();
    await page.locator(".note-dialog-panel input").fill("Cursor Gap");
    await page.locator(".note-dialog-panel .primary-button").click();
    await page.waitForFunction(() =>
      document.querySelector(".tab.active")?.textContent?.includes("Cursor Gap"),
    );
    await page.keyboard.type("foo");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await expect
      .poll(() => activeCursorBlankLayout(page, "foo"))
      .toMatchObject({
        visibleBlankCountAfterText: 2,
        cursorHasLineBox: true,
        cursorIsAfterBlankLine: true,
      });
    await page.close();
  });

  it("moves through visible blank lines with arrow keys", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await page.locator('.sidebar-controls [title="New note"]').click();
    await page.locator(".note-dialog-panel input").fill("Arrow Blanks");
    await page.locator(".note-dialog-panel .primary-button").click();
    await page.waitForFunction(() =>
      document.querySelector(".tab.active")?.textContent?.includes("Arrow Blanks"),
    );
    await page.keyboard.type("foo");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("bar");
    await page.keyboard.press("ArrowUp");

    await expect
      .poll(() => activeCursorBetweenParagraphsLayout(page, "foo", "bar"))
      .toMatchObject({
        visibleLaneCount: 2,
        cursorVisibleLaneOrdinal: 2,
        cursorHasLineBox: true,
        cursorIsBetweenTextBlocks: true,
      });
    await page.close();
  });

  it("source mode round trip preserves repeated blank-line geometry and markdown", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await page.locator('.sidebar-controls [title="New note"]').click();
    await page.locator(".note-dialog-panel input").fill("Source Round Trip");
    await page.locator(".note-dialog-panel .primary-button").click();
    await page.waitForFunction(() =>
      document.querySelector(".tab.active")?.textContent?.includes("Source Round Trip"),
    );
    await page.keyboard.type("foo");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("bar");

    await page.locator('.toolbar [title="Source"]').click();
    await expect
      .poll(() => page.locator(".app-editor-source").inputValue())
      .toBe("# Source Round Trip\nfoo\n\n\nbar");
    await page.locator('.toolbar [title="Source"]').click();

    await expect
      .poll(() => visibleParagraphLayout(page, "foo", "bar", 2))
      .toMatchObject({
        blankCount: 2,
        ordered: true,
        blankHasLineBox: true,
        gapLooksLikeBlankLine: true,
      });
    await page.close();
  });

  it("handles Enter at paragraph start, middle, and end through model transactions", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await createNote(page, "Enter Positions");
    await page.keyboard.type("foo");
    await placeCursorInTextBlock(page, "foo", 0);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => activeCursorBlankLayout(page, "Enter Positions"))
      .toMatchObject({
        visibleBlankCountAfterText: 1,
        cursorHasLineBox: true,
        cursorIsAfterBlankLine: true,
      });

    await placeCursorInTextBlock(page, "foo", 1);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => visibleParagraphLayout(page, "f", "oo", 0))
      .toMatchObject({
        blankCount: 0,
        ordered: true,
        blankHasLineBox: true,
        gapLooksLikeBlankLine: true,
      });

    await placeCursorInTextBlock(page, "oo", 2);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => activeCursorBlankLayout(page, "oo"))
      .toMatchObject({
        visibleBlankCountAfterText: 0,
        cursorHasLineBox: true,
        cursorIsAfterBlankLine: false,
      });

    await waitForNoteSave(page);
    const saved = await openSeededDocument("enter-positions.md");
    expect(saved.content).toBe("# Enter Positions\r\n\r\nf\r\noo\r\n");
    await page.close();
  });

  it("handles Backspace and Delete across text and blank-line boundaries", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await createNote(page, "Delete Boundaries");
    await page.keyboard.type("abc");
    await placeCursorInTextBlock(page, "abc", 2);
    await page.keyboard.press("Backspace");
    await expect
      .poll(() => page.locator(".app-editor").evaluate((editor) => editor.textContent ?? ""))
      .toContain("ac");
    await page.keyboard.press("Delete");
    await expect
      .poll(() => page.locator(".app-editor").evaluate((editor) => editor.textContent ?? ""))
      .not.toContain("ac");

    await createNote(page, "Delete Boundaries Blank");
    await page.keyboard.type("foo");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("bar");
    await placeCursorInTextBlock(page, "bar", 0);
    await page.keyboard.press("Backspace");
    await expect
      .poll(() => page.locator(".app-editor").evaluate((editor) => editor.textContent ?? ""))
      .not.toContain("foo\n\nbar");

    await placeCursorInTextBlock(page, "foo", 3);
    await page.keyboard.press("Enter");
    await placeCursorInTextBlock(page, "foo", 3);
    await page.keyboard.press("Delete");
    await expect
      .poll(() => page.locator(".app-editor").evaluate((editor) => editor.textContent ?? ""))
      .not.toContain("foo\n\nbar");

    await expectSavedContent(
      "delete-boundaries-blank.md",
      "# Delete Boundaries Blank\r\nfoo\r\nbar",
    );
    await page.close();
  });

  it("applies visual block input syntax through model-backed rendering", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await createNote(page, "Heading Syntax");
    if (e2eBrowser.name() === "webkit") {
      await setEditorSource(page, "# Heading Syntax\n# Heading");
    } else {
      await page.keyboard.type("# Heading");
    }
    await expect.poll(() => blockSyntaxSummary(page)).toMatchObject({ headings: 2 });
    if (e2eBrowser.name() !== "webkit") {
      await expect
        .poll(() => activeCursorHost(page))
        .toMatchObject({
          tagName: "H1",
          text: "Heading",
          cursorAtEnd: true,
        });
    }
    await expectSavedContent("heading-syntax.md", "# Heading Syntax\r\n# Heading");
    await page.close();

    const listPage = await newLoggedPage();
    await listPage.goto(baseUrl);
    await listPage.waitForSelector(".main");
    await createNote(listPage, "List Syntax");
    if (e2eBrowser.name() === "webkit") {
      await setEditorSource(listPage, "# List Syntax\n- item");
    } else {
      await listPage.keyboard.type("- item");
    }
    await expect.poll(() => blockSyntaxSummary(listPage)).toMatchObject({ unorderedItems: 1 });
    if (e2eBrowser.name() !== "webkit") {
      await expect
        .poll(() => activeCursorHost(listPage))
        .toMatchObject({
          tagName: "LI",
          text: "item",
          cursorAtEnd: true,
          inUnorderedList: true,
        });
    }
    await expectSavedContent("list-syntax.md", "# List Syntax\r\n- item");
    await listPage.close();

    const orderedPage = await newLoggedPage();
    await orderedPage.goto(baseUrl);
    await orderedPage.waitForSelector(".main");
    await createNote(orderedPage, "Ordered Syntax");
    if (e2eBrowser.name() === "webkit") {
      await setEditorSource(orderedPage, "# Ordered Syntax\n1. ordered");
    } else {
      await orderedPage.keyboard.type("1. ordered");
    }
    await expect.poll(() => blockSyntaxSummary(orderedPage)).toMatchObject({ orderedItems: 1 });
    if (e2eBrowser.name() !== "webkit") {
      await expect
        .poll(() => activeCursorHost(orderedPage))
        .toMatchObject({
          tagName: "LI",
          text: "ordered",
          cursorAtEnd: true,
          inOrderedList: true,
        });
    }
    await expectSavedContent("ordered-syntax.md", "# Ordered Syntax\r\n1. ordered");
    await orderedPage.close();

    const taskPage = await newLoggedPage();
    await taskPage.goto(baseUrl);
    await taskPage.waitForSelector(".main");
    await createNote(taskPage, "Task Syntax");
    if (e2eBrowser.name() === "webkit") {
      await setEditorSource(taskPage, "# Task Syntax\n[ ] task");
    } else {
      await taskPage.keyboard.type("[ ] task");
    }
    await expect.poll(() => blockSyntaxSummary(taskPage)).toMatchObject({ taskItems: 1 });
    if (e2eBrowser.name() !== "webkit") {
      await expect
        .poll(() => activeCursorHost(taskPage))
        .toMatchObject({
          tagName: "LI",
          text: "task",
          cursorAtEnd: true,
          inTaskList: true,
        });
    }
    await expectSavedContent("task-syntax.md", "# Task Syntax\r\n[ ] task");
    await taskPage.close();

    const quotePage = await newLoggedPage();
    await quotePage.goto(baseUrl);
    await quotePage.waitForSelector(".main");
    await createNote(quotePage, "Quote Syntax");
    if (e2eBrowser.name() === "webkit") {
      await setEditorSource(quotePage, "# Quote Syntax\n> quote");
    } else {
      await quotePage.keyboard.type("> quote");
    }
    await expect.poll(() => blockSyntaxSummary(quotePage)).toMatchObject({ blockquotes: 1 });
    if (e2eBrowser.name() !== "webkit") {
      await expect
        .poll(() => activeCursorHost(quotePage))
        .toMatchObject({
          tagName: "P",
          text: "quote",
          cursorAtEnd: true,
          inBlockquote: true,
        });
    }
    await expectSavedContent("quote-syntax.md", "# Quote Syntax\r\n> quote");
    await quotePage.close();

    const hrPage = await newLoggedPage();
    await hrPage.goto(baseUrl);
    await hrPage.waitForSelector(".main");
    await createNote(hrPage, "Hr Syntax");
    if (e2eBrowser.name() === "webkit") {
      await setEditorSource(hrPage, "# Hr Syntax\n---\n");
    } else {
      await hrPage.keyboard.type("---");
      await hrPage.keyboard.press("Enter");
    }
    await expect.poll(() => blockSyntaxSummary(hrPage)).toMatchObject({ hrs: 1 });
    if (e2eBrowser.name() !== "webkit") {
      await expect
        .poll(() => activeCursorHost(hrPage))
        .toMatchObject({
          tagName: "P",
          text: "",
          cursorAtEnd: true,
          previousTagName: "HR",
        });
    }
    await expectSavedContent("hr-syntax.md", "# Hr Syntax\r\n---\r\n");
    await hrPage.close();

    const codePage = await newLoggedPage();
    await codePage.goto(baseUrl);
    await codePage.waitForSelector(".main");
    await createNote(codePage, "Code Syntax");
    if (e2eBrowser.name() === "webkit") {
      await setEditorSource(codePage, "# Code Syntax\n```\n");
    } else {
      await codePage.keyboard.type("```");
      await codePage.keyboard.press("Enter");
    }
    await expect.poll(() => blockSyntaxSummary(codePage)).toMatchObject({ codeBlocks: 1 });
    if (e2eBrowser.name() !== "webkit") {
      await expect
        .poll(() => activeCursorHost(codePage))
        .toMatchObject({
          tagName: "PRE",
          text: "",
          cursorAtEnd: true,
          inCodeBlock: true,
        });
    }
    await expectSavedContent("code-syntax.md", "# Code Syntax\r\n```\r\n");
    await codePage.close();
  });

  it("preserves blank lines when pasting multiline plain text and sanitized HTML", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await createNote(page, "Paste Blanks");
    await pastePlainText(page, "one\n\nthree");
    await page.keyboard.press("Enter");
    await pasteHtml(page, "<p>four</p><p><br></p><p>six</p>", "four\n\nsix");

    await expect
      .poll(() => visibleParagraphLayout(page, "one", "three", 1))
      .toMatchObject({
        blankCount: 1,
        ordered: true,
        blankHasLineBox: true,
        gapLooksLikeBlankLine: true,
      });
    await expect
      .poll(() => visibleParagraphLayout(page, "four", "six", 1))
      .toMatchObject({
        blankCount: 1,
        ordered: true,
        blankHasLineBox: true,
        gapLooksLikeBlankLine: true,
      });
    await waitForNoteSave(page);
    const saved = await openSeededDocument("paste-blanks.md");
    expect(saved.content).toBe("# Paste Blanks\r\none\r\n\r\nthree\r\nfour\r\n\r\nsix");
    await page.close();
  });

  it("adapts legacy editor typing and inline round-trip regressions", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await createNote(page, "Legacy Editor Roundtrips");
    await setEditorSource(page, "");
    await typeText(page, "foo");
    await page.keyboard.press("Enter");
    await typeText(page, "bar");
    await expectEditorSource(page, "foo\nbar");

    await setEditorSource(page, "");
    await typeText(page, "a");
    await page.keyboard.press("Enter");
    await typeText(page, "b");
    await page.keyboard.press("Enter");
    await typeText(page, "c");
    await expectEditorSource(page, "a\nb\nc");

    await setEditorSource(page, "");
    await typeText(page, "**bold**");
    await expect.poll(() => inlineSyntaxSummary(page)).toMatchObject({ strong: 1 });
    await expectEditorSource(page, "**bold**");

    await setEditorSource(page, "");
    await typeText(page, "*italic*");
    await expect.poll(() => inlineSyntaxSummary(page)).toMatchObject({ emphasis: 1 });
    await expectEditorSource(page, "*italic*");

    await setEditorSource(page, "");
    await typeText(page, "`code` ");
    await expect.poll(() => inlineSyntaxSummary(page)).toMatchObject({ code: 1 });
    expect((await readEditorSource(page)).trim()).toBe("`code`");

    await setEditorSource(page, "");
    await typeText(page, "**bold**");
    await page.keyboard.press("Enter");
    await typeText(page, "next");
    await expectEditorSource(page, "**bold**\nnext");
    await page.close();
  });

  it("adapts legacy heading, list, and boundary regressions", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await createNote(page, "Legacy Structural Regressions");
    await setEditorSource(page, "");
    await typeHeadingStart(page, "##", "Heading");
    await expect.poll(() => blockSyntaxSummary(page)).toMatchObject({ h2: 1 });
    await page.keyboard.press("Enter");
    await typeText(page, "plain text");
    await expectEditorSource(page, "## Heading\nplain text");

    await setEditorSource(page, "");
    await typeHeadingStart(page, "###", "Subheading");
    await expect.poll(() => blockSyntaxSummary(page)).toMatchObject({ h3: 1 });

    await setEditorSource(page, "# foo");
    await page.locator(".app-editor h1", { hasText: "foo" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await typeText(page, "bar");
    await expectEditorSource(page, "# foo\nbar");

    await setEditorSource(page, "- 1\n  - 2\n    - 3");
    await placeCursorInListItem(page, "3", 1);
    await page.keyboard.press("Shift+Tab");
    await expectEditorSource(page, "- 1\n  - 2\n  - 3");

    await setEditorSource(page, "- one\n- two");
    await placeCursorInListItem(page, "two", 3);
    await page.keyboard.press("Tab");
    await expectEditorSource(page, "- one\n  - two");

    await setEditorSource(page, "- 1\n  - 2\n    - 3\n      - 4");
    await selectListRange(page, 1, 1, 3, 3);
    await page.keyboard.press("Shift+Tab");
    await expectEditorSource(page, "- 1\n- 2\n  - 3\n    - 4");

    await setEditorSource(page, "- 1\n- 2");
    await placeCursorInListItem(page, "2", 1);
    await page.keyboard.press("Shift+Tab");
    await expectEditorSource(page, "- 1\n- 2");
    await page.close();
  });

  it("adapts legacy autosave, reload, and double-newline loss regressions", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await createNote(page, "Legacy Persistence Regressions");
    for (const source of ["\nline1\n\n\nline2\n", "foo:\n- one", "foo:\n- one\n- \ndsf"]) {
      await setEditorSource(page, source);
      await expectSavedContent("legacy-persistence-regressions.md", storedMarkdown(source));
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector(".main");
      await page.locator('.note-row[title="legacy-persistence-regressions.md"]').first().click();
      await expectEditorSource(page, source);
    }

    await setEditorSource(page, "sdf\n\nsdf");
    await placeCursorInLastTextBlock(page, "sdf", 3);
    const reportedLines = ["a", "sd", "s", "d", "csd", "dsfb", "b"];
    for (const line of reportedLines) {
      await page.keyboard.press("Enter");
      await page.keyboard.type(line);
    }
    await expectEditorSource(page, `sdf\n\nsdf\n${reportedLines.join("\n")}`);

    const rand = mulberry32(43);
    for (let i = 0; i < 8; i++) {
      const lines = Array.from({ length: 5 }, () => randomPlainText(rand, 2, 12));
      await setEditorSource(page, "sdf\n\nsdf");
      await placeCursorInLastTextBlock(page, "sdf", 3);
      for (const line of lines) {
        await page.keyboard.press("Enter");
        await page.keyboard.type(line);
      }
      await expectEditorSource(page, `sdf\n\nsdf\n${lines.join("\n")}`);
    }
    await page.close();
  }, 90_000);

  it("adapts legacy save and shortcut integration coverage", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await page.keyboard.press(`${shortcutModifier()}+p`);
    await expect.poll(() => page.locator(".search-panel .command-input").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".search-panel").count()).toBe(0);

    await page.keyboard.press(`${shortcutModifier()}+k`);
    await expect.poll(() => page.locator(".command-panel .command-input").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".command-panel").count()).toBe(0);

    await createNote(page, "Legacy Save Requests");
    await page.waitForTimeout(500);

    const typingRequests = await collectApiRequests(page, async () => {
      await page.keyboard.type("abcdef");
      await page.waitForTimeout(500);
    });
    expect(typingRequests.filter((request) => request === "PUT /api/session")).toHaveLength(0);

    const saveRequests = await collectApiRequests(page, async () => {
      await page.keyboard.press(`${shortcutModifier()}+s`);
      await expectSavedContent("legacy-save-requests.md", "# Legacy Save Requests\r\nabcdef");
    });
    expect(saveRequests.filter((request) => request.startsWith("PATCH /api/notes/"))).toHaveLength(
      1,
    );
    expect(saveRequests.filter((request) => request.startsWith("GET /api/notes/"))).toHaveLength(0);

    const cleanSaveRequests = await collectApiRequests(page, async () => {
      await page.keyboard.press(`${shortcutModifier()}+s`);
      await page.waitForTimeout(500);
    });
    expect(
      cleanSaveRequests.filter((request) => request.startsWith("PATCH /api/notes/")),
    ).toHaveLength(0);
    await page.close();
  });

  it("sends exact delta save bodies without full note content", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    const baseLines = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`);
    const baseContent = `# Delta Body\n${baseLines.join("\n")}`;
    await createNote(page, "Delta Body");
    await setEditorSource(page, baseContent);
    await page.keyboard.press(`${shortcutModifier()}+s`);
    await expectSavedContent("delta-body.md", storedMarkdown(baseContent));

    const source = page.locator(".app-editor-source");
    await openSourceMode(page);
    await source.evaluate((textarea) => {
      const sourceTextarea = textarea as HTMLTextAreaElement;
      const offset = sourceTextarea.value.indexOf("line 1") + "line 1".length;
      sourceTextarea.setSelectionRange(offset, offset);
      sourceTextarea.value = `${sourceTextarea.value.slice(0, offset)} edited${sourceTextarea.value.slice(offset)}`;
      sourceTextarea.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: " edited" }),
      );
    });
    await closeSourceMode(page);

    const saveRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "PATCH" && url.pathname.startsWith("/api/notes/");
    });
    await page.keyboard.press(`${shortcutModifier()}+s`);
    const request = await saveRequest;
    const body = request.postDataJSON() as {
      content?: string;
      contentHash?: string;
      edits?: { start: unknown; end: unknown; text: string }[];
    };

    expect(body.content).toBeUndefined();
    expect(body.contentHash).toMatch(/^sha256:/);
    expect(body.edits).toStrictEqual([
      {
        start: { line: 1, character: 6 },
        end: { line: 1, character: 6 },
        text: " edited",
      },
    ]);
    await expectSavedContent(
      "delta-body.md",
      storedMarkdown(`# Delta Body\nline 1 edited\n${baseLines.slice(1).join("\n")}`),
    );
    await page.close();
  });

  it("covers lists, tasks, and undoable structural editing across the exposed markdown surface", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await createNote(page, "Markdown Surface");
    await setEditorSource(page, "- one");
    await placeCursorInListItem(page, "one", 3);
    await page.keyboard.press("Enter");
    await page.keyboard.type("two");
    await expectEditorSource(page, "- one\n- two");
    await placeCursorInListItem(page, "two", 3);
    await page.keyboard.press("Tab");
    await expectEditorSource(page, "- one\n  - two");
    await page.keyboard.press("Shift+Tab");
    await expectEditorSource(page, "- one\n- two");
    await setEditorSource(page, "- one\n- two\n- ");
    await placeCursorInListItemByIndex(page, 2, 0);
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator(".app-editor li").count()).toBe(2);
    await undoEditor(page);
    await expect.poll(() => page.locator(".app-editor li").count()).toBe(3);
    await redoEditor(page);
    await expectEditorSource(page, "- one\n- two\n");

    await setEditorSource(page, "- [ ] todo\n- [x] done");
    await page.locator('.app-editor input[type="checkbox"]').first().click();
    await expectEditorSource(page, "- [x] todo\n- [x] done");
    await page.locator('.app-editor input[type="checkbox"]').nth(1).click();
    await expectEditorSource(page, "- [x] todo\n- [ ] done");

    const surface =
      "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n" +
      "> [!warning] Be careful\n> line one\n>\n> line three\n\n" +
      "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n" +
      "[regular](https://example.com) [[Wiki Note|Wiki]] ![alt](https://example.com/a.png) ![[z-images/sample.webp|132]]";
    await setEditorSource(page, surface);
    await expect
      .poll(() => markdownSurfaceSummary(page))
      .toMatchObject({
        codeBlocks: 1,
        callouts: 1,
        tables: 1,
        regularLinks: 1,
        wikiLinks: 0,
        regularImages: 1,
        wikiImages: 1,
      });
    await expectEditorSource(page, surface);

    await page.close();
  });

  it("pastes and resizes images through model markdown", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await createNote(page, "Image Editing");
    await pasteGeneratedImage(page);
    await expect.poll(() => page.locator(".app-editor img[data-wiki-image]").count()).toBe(1);
    await expect.poll(() => readEditorSource(page)).toMatch(/!\[\[z-images\/.+\.webp\]\]/);

    await resizeFirstWikiImage(page, 36);
    await expect.poll(() => readEditorSource(page)).toMatch(/!\[\[z-images\/.+\.webp\|\d+\]\]/);
    await page.close();
  });

  it("covers block gutter copy, range selection, replacement, delete, escape, and undo", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await createNote(page, "Gutter Blocks");
    const source =
      "# Heading\n\nparagraph\n\n- one\n- two\n\n```js\ncode\n```\n\n" +
      "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> [!note] Title\n> Body\n\n![[z-images/sample.webp|132]]";
    await setEditorSource(page, source);

    await expect.poll(() => copyBlockByText(page, "Heading")).toBe("# Heading\n");
    await expect.poll(() => copyBlockByText(page, "paragraph")).toBe("paragraph\n");
    await expect.poll(() => copyBlockByText(page, "one")).toBe("- one\n- two\n");
    await expect.poll(() => copyBlockBySelector(page, "pre")).toBe("```js\ncode\n```\n");
    await expect
      .poll(() => copyBlockBySelector(page, "table"))
      .toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    await expect.poll(() => copyBlockByText(page, "Title")).toBe("> [!note] Title\n> Body\n");
    await expect
      .poll(() => copyBlockBySelector(page, "img[data-wiki-image]"))
      .toBe("![[z-images/sample.webp|132]]");
    await expect.poll(() => copyBlockBySelector(page, '[data-md-block-kind="blank"]')).toBe("\n");

    await expect
      .poll(() => selectBlockRangeAndCopy(page, "Heading", "paragraph"))
      .toBe("# Heading\n\nparagraph\n");
    await page.keyboard.type("replacement");
    await expect.poll(() => page.locator(".app-editor").textContent()).toContain("replacement");
    await expect.poll(() => page.locator(".app-editor h1").count()).toBe(0);
    await expect.poll(() => page.locator(".app-editor li").count()).toBe(2);

    await expect.poll(() => copyBlockByText(page, "replacement")).toBe("replacement\n");
    await page.keyboard.press("Escape");
    await page.keyboard.type("!");
    await expect.poll(() => page.locator(".app-editor").textContent()).toContain("!replacement");

    await expect.poll(() => copyBlockByText(page, "one")).toBe("- one\n- two\n");
    await page.keyboard.press("Delete");
    await expect.poll(() => page.locator(".app-editor li").count()).toBe(0);
    await undoEditor(page);
    await expectEditorSource(
      page,
      "!replacement\n- one\n- two\n\n```js\ncode\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> [!note] Title\n> Body\n\n![[z-images/sample.webp|132]]",
    );
    await expect.poll(() => focusedHandleName(page)).toBe("Select block");
    await page.close();
  });

  it("restores markdown and cursor through undo and redo checkpoints", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");

    await createNote(page, "Undo Redo");
    await setEditorSource(page, "");
    await typeText(page, "alpha");
    await undoEditor(page);
    await expect
      .poll(() =>
        page
          .locator(".app-editor")
          .textContent()
          .then((text) => (text ?? "").trim()),
      )
      .toBe("");
    await redoEditor(page);
    await expect
      .poll(() =>
        page
          .locator(".app-editor")
          .textContent()
          .then((text) => (text ?? "").trim()),
      )
      .toBe("alpha");
    await expect
      .poll(() => activeCursorHost(page))
      .toMatchObject({ text: "alpha", cursorAtEnd: true });

    await page.keyboard.press("Enter");
    await page.keyboard.type("beta");
    await page.keyboard.press("Backspace");
    await expect.poll(() => page.locator(".app-editor").textContent()).toContain("bet");
    await undoEditor(page);
    await expect.poll(() => page.locator(".app-editor").textContent()).toContain("beta");
    await redoEditor(page);
    await expectEditorSource(page, "alpha\nbet");

    await setEditorSource(page, "foo\n\nbar");
    await placeCursorInTextBlock(page, "bar", 0);
    await page.keyboard.press("ArrowUp");
    await undoEditor(page);
    await redoEditor(page);
    await expect
      .poll(() => activeCursorBetweenParagraphsLayout(page, "foo", "bar"))
      .toMatchObject({
        visibleLaneCount: 1,
        cursorVisibleLaneOrdinal: 0,
        cursorHasLineBox: true,
        cursorIsBetweenTextBlocks: false,
      });

    await setEditorSource(page, "source");
    await openSourceMode(page);
    await page.locator(".app-editor-source").fill("source edit");
    await undoEditor(page);
    await expect.poll(() => page.locator(".app-editor-source").inputValue()).toBe("source");
    await redoEditor(page);
    await expect.poll(() => page.locator(".app-editor-source").inputValue()).toBe("source edit");
    await closeSourceMode(page);
    await expectEditorSource(page, "source edit");
    await page.close();
  });

  it("keeps rapid typing responsive in a large visual note", async () => {
    const content = `# Stress\n\n${Array.from(
      { length: 500 },
      (_, i) => `paragraph ${i} with enough text to make DOM walks expensive`,
    ).join("\n")}`;
    await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tansu-Vault": "0",
      },
      body: JSON.stringify({ path: "stress-lag.md", content, source: null }),
    });

    const page = await newLoggedPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".main");
    await page.locator('.note-row[title="stress-lag.md"]').first().click();
    await page.waitForFunction(() =>
      document.querySelector(".app-editor")?.textContent?.includes("paragraph 499"),
    );
    await page.locator(".app-editor").evaluate((editor) => {
      const last = editor.lastChild;
      if (last === null) {
        throw new Error("missing editor content");
      }
      const range = document.createRange();
      range.selectNodeContents(last);
      range.collapse(false);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      (editor as HTMLElement).focus();
    });

    const typed = " latency-free-editing-regression-check";
    const started = performance.now();
    await page.keyboard.type(typed);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(2500);
    await expect
      .poll(() => page.locator(".app-editor").evaluate((editor) => editor.textContent ?? ""))
      .toContain(`paragraph 499 with enough text to make DOM walks expensive${typed}`);
    await page.close();
  });

  it("streams vault-scoped note changes over SSE", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    const eventPromise = page.evaluate(
      () =>
        new Promise<string>((resolve) => {
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
              notes: { title: string }[];
            };
            if (
              payload.kind === "note_changed" &&
              payload.notes.some((note) => note.title === "SSE")
            ) {
              source.close();
              resolve(payload.kind);
            }
          });
        }),
    );
    await expect(eventPromise).resolves.toBe("note_changed");
    await page.close();
  });

  it("reconciles external filesystem edits for the active vault", async () => {
    const page = await newLoggedPage();
    await page.goto(baseUrl);
    const eventPromise = page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const source = new EventSource("/events?vault=0");
          source.addEventListener("message", (event) => {
            const payload = JSON.parse((event as MessageEvent<string>).data) as {
              kind: string;
              notes: { title: string }[];
            };
            if (
              payload.kind === "vault_changed" &&
              payload.notes.some((note) => note.title === "Outside")
            ) {
              source.close();
              resolve(payload.kind);
            }
          });
        }),
    );
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
    expect(asset.ok).toBeTruthy();
    await expect(asset.arrayBuffer()).resolves.toHaveProperty("byteLength", 3);
  });
});

function browserTypeFromEnv(): BrowserType {
  switch (process.env["TANSU2_E2E_BROWSER"]) {
    case "firefox": {
      return firefox;
    }
    case "webkit": {
      return webkit;
    }
    default: {
      return chromium;
    }
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

async function dumpUnifiedLogs(testName: string): Promise<void> {
  const lines: string[] = [`\n--- tansu2 unified logs for failed test: ${testName} ---`];
  if (baseUrl !== "") {
    try {
      const snapshot = await fetch(`${baseUrl}/api/dev/logs`).then(
        (response) => response.json() as Promise<{ events: LogEvent[] }>,
      );
      for (const event of snapshot.events) {
        lines.push(JSON.stringify(event));
      }
    } catch (error) {
      lines.push(`unable to fetch unified logs: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (serverOutput.length > 0) {
    lines.push("--- server stdout/stderr fallback ---");
    lines.push(serverOutput.join(""));
  }
  lines.push("--- end tansu2 unified logs ---");
  console.error(lines.join("\n"));
}

async function newLoggedPage(): Promise<Page> {
  const page = await browser!.newPage();
  page.on("pageerror", (error) => {
    void postHarnessLog("error", "client.error", {
      page: { url: page.url() },
      error: { name: error.name, message: error.message, stack: error.stack },
    });
  });
  page.on("requestfailed", (request) => {
    void postHarnessLog("warn", "http.request_failed", {
      http: {
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText,
      },
    });
  });
  return page;
}

async function postHarnessLog(
  level: "debug" | "info" | "warn" | "error",
  kind: string,
  fields: Record<string, unknown>,
): Promise<void> {
  if (baseUrl === "") {
    return;
  }
  await fetch(`${baseUrl}/api/dev/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      events: [{ source: "harness", level, kind, ...fields }],
    }),
  }).catch(() => {});
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

async function createNote(page: Page, title: string): Promise<void> {
  await page.locator('.sidebar-controls [title="New note"]').click();
  await page.locator(".note-dialog-panel input").fill(title);
  await page.locator(".note-dialog-panel .primary-button").click();
  await page.waitForFunction(
    (expected) => document.querySelector(".tab.active")?.textContent?.includes(expected),
    title,
  );
  await expect
    .poll(() =>
      page.locator(".app-editor").evaluate((editor) => {
        const anchor = getSelection()?.anchorNode;
        const element = anchor instanceof Element ? anchor : anchor?.parentElement;
        return element?.closest("p")?.parentElement === editor;
      }),
    )
    .toBe(true);
}

async function setEditorSource(page: Page, content: string): Promise<void> {
  await openSourceMode(page);
  const source = page.locator(".app-editor-source");
  await source.fill(content);
  await source.evaluate((textarea, value) => {
    const sourceTextarea = textarea as HTMLTextAreaElement;
    sourceTextarea.value = value;
    sourceTextarea.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText" }),
    );
  }, content);
  await closeSourceMode(page);
  await page.locator(".app-editor").evaluate((editor) => {
    const host = editor.querySelector<HTMLElement>("[data-md-line-index]");
    if (host === null) {
      throw new Error("missing editor line host");
    }
    if (host.dataset["mdBlank"] === "true") {
      delete host.dataset["mdBlank"];
      host.hidden = false;
      host.setAttribute("contenteditable", "true");
      if (!host.querySelector("br") && (host.textContent ?? "") === "") {
        host.prepend(document.createElement("br"));
      }
      const range = document.createRange();
      range.setStart(host, 0);
      range.collapse(true);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      (editor as HTMLElement).focus();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(host);
    range.collapse(false);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (editor as HTMLElement).focus();
  });
  await page.locator(".app-editor [data-md-line-index]").first().click({ force: true });
}

async function typeText(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
}

async function typeHeadingStart(page: Page, marker: "##" | "###", text: string): Promise<void> {
  await page.keyboard.type(`${marker} ${text}`);
}

async function readEditorSource(page: Page): Promise<string> {
  await openSourceMode(page);
  const source = await page.locator(".app-editor-source").inputValue();
  await closeSourceMode(page);
  await page.locator(".app-editor").evaluate((editor) => {
    (editor as HTMLElement).focus();
  });
  return source;
}

async function expectEditorSource(page: Page, content: string): Promise<void> {
  await expect.poll(() => readEditorSource(page)).toBe(content);
}

async function openSourceMode(page: Page): Promise<void> {
  if (!(await page.locator(".app-editor-source").isVisible())) {
    await page.locator('.toolbar [title="Source"]').click();
  }
  await expect.poll(() => page.locator(".app-editor-source").isVisible()).toBe(true);
}

async function closeSourceMode(page: Page): Promise<void> {
  if (await page.locator(".app-editor-source").isVisible()) {
    await page.locator('.toolbar [title="Source"]').click();
  }
  await expect.poll(() => page.locator(".app-editor").isVisible()).toBe(true);
}

async function waitForNoteSave(page: Page): Promise<void> {
  await page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.startsWith("/api/notes/") &&
      response.status() === 200,
  );
  await expect.poll(() => page.locator(".statusbar").textContent()).not.toContain("Saving");
}

async function expectSavedContent(path: string, content: string): Promise<void> {
  await expect.poll(async () => (await openSeededDocument(path)).content).toBe(content);
}

function storedMarkdown(markdown: string): string {
  return markdown.replaceAll("\n", "\r\n");
}

async function placeCursorInTextBlock(page: Page, text: string, offset: number): Promise<void> {
  await page.locator(".app-editor").evaluate(
    (editor, args) => {
      const host = [...editor.querySelectorAll<HTMLElement>("[data-md-line-index]")].find(
        (candidate) =>
          candidate.dataset["mdBlank"] !== "true" && candidate.textContent === args.text,
      );
      if (!host) {
        throw new Error(`missing text block: ${args.text}`);
      }
      const textNode = [...host.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (!textNode) {
        throw new Error(`missing text node: ${args.text}`);
      }
      const range = document.createRange();
      range.setStart(textNode, Math.min(args.offset, textNode.textContent?.length ?? 0));
      range.collapse(true);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      (editor as HTMLElement).focus();
    },
    { text, offset },
  );
}

async function placeCursorInLastTextBlock(page: Page, text: string, offset: number): Promise<void> {
  await page.locator(".app-editor").evaluate(
    (editor, args) => {
      const hosts = [...editor.querySelectorAll<HTMLElement>("[data-md-line-index]")].filter(
        (candidate) =>
          candidate.dataset["mdBlank"] !== "true" && candidate.textContent === args.text,
      );
      const host = hosts.at(-1);
      if (!host) {
        throw new Error(`missing text block: ${args.text}`);
      }
      const textNode = [...host.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (!textNode) {
        throw new Error(`missing text node: ${args.text}`);
      }
      const range = document.createRange();
      range.setStart(textNode, Math.min(args.offset, textNode.textContent?.length ?? 0));
      range.collapse(true);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      (editor as HTMLElement).focus();
    },
    { text, offset },
  );
}

async function placeCursorInListItem(page: Page, text: string, offset: number): Promise<void> {
  await page.locator(".app-editor").evaluate(
    (editor, args) => {
      const item = [...editor.querySelectorAll<HTMLLIElement>("li")].find((candidate) =>
        (candidate.textContent ?? "").includes(args.text),
      );
      if (!item) {
        throw new Error(`missing list item: ${args.text}`);
      }
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return (node.textContent ?? "").includes(args.text)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        },
      });
      const textNode = walker.nextNode();
      if (!textNode) {
        throw new Error(`missing list item text node: ${args.text}`);
      }
      const textOffset = Math.min(args.offset, textNode.textContent?.length ?? 0);
      const range = document.createRange();
      range.setStart(textNode, textOffset);
      range.collapse(true);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      (editor as HTMLElement).focus();
    },
    { text, offset },
  );
}

async function placeCursorInListItemByIndex(
  page: Page,
  index: number,
  offset: number,
): Promise<void> {
  await page.locator(".app-editor").evaluate(
    (editor, args) => {
      const item = [...editor.querySelectorAll<HTMLLIElement>("li")][args.index];
      if (!item) {
        throw new Error(`missing list item index: ${args.index}`);
      }
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode();
      const range = document.createRange();
      if (textNode) {
        range.setStart(textNode, Math.min(args.offset, textNode.textContent?.length ?? 0));
      } else {
        range.setStart(item, 0);
      }
      range.collapse(true);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      (editor as HTMLElement).focus();
    },
    { index, offset },
  );
}

async function selectListRange(
  page: Page,
  startIndex: number,
  startOffset: number,
  endIndex: number,
  endOffset: number,
): Promise<void> {
  await page.locator(".app-editor").evaluate(
    (editor, rangeArgs) => {
      const items = [...editor.querySelectorAll<HTMLLIElement>("li")];
      const getTextNode = (item: Element): Node => {
        const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
        const node = walker.nextNode();
        if (!node) {
          throw new Error("expected list item text node");
        }
        return node;
      };
      const startNode = getTextNode(items[rangeArgs.startIndex]!);
      const endNode = getTextNode(items[rangeArgs.endIndex]!);
      const range = document.createRange();
      range.setStart(
        startNode,
        Math.min(rangeArgs.startOffset, startNode.textContent?.length ?? 0),
      );
      range.setEnd(endNode, Math.min(rangeArgs.endOffset, endNode.textContent?.length ?? 0));
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      (editor as HTMLElement).focus();
    },
    { startIndex, startOffset, endIndex, endOffset },
  );
}

async function pastePlainText(page: Page, text: string): Promise<void> {
  await page.locator(".app-editor").evaluate((editor, pasted) => {
    const data = new DataTransfer();
    data.setData("text/plain", pasted);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    editor.dispatchEvent(event);
  }, text);
}

async function pasteHtml(page: Page, html: string, fallbackText: string): Promise<void> {
  await page.locator(".app-editor").evaluate(
    (editor, dataInput) => {
      const data = new DataTransfer();
      data.setData("text/html", dataInput.html);
      data.setData("text/plain", dataInput.fallbackText);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: data });
      editor.dispatchEvent(event);
    },
    { html, fallbackText },
  );
}

async function pasteGeneratedImage(page: Page): Promise<void> {
  await page.locator(".app-editor").evaluate(async (editor) => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("missing canvas context");
    }
    context.fillStyle = "#cc3344";
    context.fillRect(0, 0, 4, 4);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value === null ? reject(new Error("missing blob")) : resolve(value)),
        "image/png",
      );
    });
    const file = new File([blob], "pasted.png", { type: "image/png" });
    const data = {
      items: [{ type: file.type, getAsFile: () => file }],
      getData: () => "",
    };
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    editor.dispatchEvent(event);
  });
}

async function resizeFirstWikiImage(page: Page, deltaX: number): Promise<void> {
  await page.locator(".app-editor").evaluate((editor, amount) => {
    const image = editor.querySelector<HTMLImageElement>("img[data-wiki-image]");
    if (image === null) {
      throw new Error("missing wiki image");
    }
    const rect = image.getBoundingClientRect();
    const x = rect.right - 2;
    const y = rect.top + rect.height / 2;
    image.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        clientX: x + amount,
        clientY: y,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        buttons: 0,
        clientX: x + amount,
        clientY: y,
      }),
    );
  }, deltaX);
}

async function blockSyntaxSummary(page: Page): Promise<{
  headings: number;
  h2: number;
  h3: number;
  unorderedItems: number;
  orderedItems: number;
  taskItems: number;
  blockquotes: number;
  hrs: number;
  codeBlocks: number;
}> {
  return page.locator(".app-editor").evaluate((editor) => ({
    headings: editor.querySelectorAll("h1").length,
    h2: editor.querySelectorAll("h2").length,
    h3: editor.querySelectorAll("h3").length,
    unorderedItems: editor.querySelectorAll("ul:not(.task-list) > li").length,
    orderedItems: editor.querySelectorAll("ol > li").length,
    taskItems: editor.querySelectorAll(".task-item").length,
    blockquotes: editor.querySelectorAll("blockquote").length,
    hrs: editor.querySelectorAll("hr").length,
    codeBlocks: editor.querySelectorAll("pre code").length,
  }));
}

async function markdownSurfaceSummary(page: Page): Promise<{
  codeBlocks: number;
  callouts: number;
  tables: number;
  regularLinks: number;
  wikiLinks: number;
  regularImages: number;
  wikiImages: number;
}> {
  return page.locator(".app-editor").evaluate((editor) => ({
    codeBlocks: editor.querySelectorAll("pre code").length,
    callouts: editor.querySelectorAll(".callout").length,
    tables: editor.querySelectorAll("table").length,
    regularLinks: editor.querySelectorAll("a[href]:not(.wiki-link)").length,
    wikiLinks: editor.querySelectorAll("a.wiki-link").length,
    regularImages: editor.querySelectorAll("img:not([data-wiki-image])").length,
    wikiImages: editor.querySelectorAll("img[data-wiki-image]").length,
  }));
}

async function selectBlockRange(page: Page, startText: string, endText: string): Promise<void> {
  await page.locator(".app-editor").evaluate(
    (editor, labels) => {
      const blocks = [...editor.querySelectorAll<HTMLElement>("[data-md-block-id]")].filter(
        (candidate) =>
          candidate.querySelector(`[data-md-block-handle="${candidate.dataset["mdBlockId"]}"]`) !==
          null,
      );
      const select = (text: string, shiftKey: boolean): void => {
        const block = blocks.find((candidate) => (candidate.textContent ?? "").includes(text));
        if (block === undefined) {
          throw new Error(`missing block text: ${text}`);
        }
        const handle = block.querySelector<HTMLElement>(
          `[data-md-block-handle="${block.dataset["mdBlockId"]}"]`,
        );
        if (handle === null) {
          throw new Error(`missing block handle: ${text}`);
        }
        dispatchBlockPointerDown(editor, handle, shiftKey);
      };
      const dispatchBlockPointerDown = (
        root: Element,
        handle: HTMLElement,
        shiftKey: boolean,
      ): void => {
        (root as HTMLElement).focus();
        for (let attempt = 0; attempt < 3; attempt += 1) {
          handle.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 1,
              pointerType: "mouse",
              button: 0,
              buttons: 1,
              shiftKey,
            }),
          );
          if (root.querySelectorAll(".md-block-selected").length > 0) return;
        }
      };
      select(labels.startText, false);
      select(labels.endText, true);
    },
    { startText, endText },
  );
  await expect.poll(() => selectedBlockCount(page)).toBe(3);
}

async function selectBlockRangeAndCopy(
  page: Page,
  startText: string,
  endText: string,
): Promise<string> {
  await selectBlockRange(page, startText, endText);
  return syntheticCopy(page);
}

async function copyBlockByText(page: Page, text: string): Promise<string> {
  return selectBlockAndCopy(page, { kind: "text", value: text });
}

async function copyBlockBySelector(page: Page, selector: string): Promise<string> {
  return selectBlockAndCopy(page, { kind: "selector", value: selector });
}

async function selectBlockAndCopy(
  page: Page,
  target: { kind: "text" | "selector"; value: string },
): Promise<string> {
  return page.locator(".app-editor").evaluate((editor, args) => {
    const findByText = (value: string): HTMLElement | undefined => {
      const blocks = [...editor.querySelectorAll<HTMLElement>("[data-md-block-id]")].filter(
        (candidate) =>
          candidate.querySelector(`[data-md-block-handle="${candidate.dataset["mdBlockId"]}"]`) !==
          null,
      );
      return blocks.find((candidate) => (candidate.textContent ?? "").includes(value));
    };
    const findBySelector = (value: string): HTMLElement | undefined =>
      [...editor.querySelectorAll(value)]
        .map((node) => node.closest("[data-md-block-id]"))
        .find(
          (candidate): candidate is HTMLElement =>
            candidate instanceof HTMLElement &&
            candidate.querySelector(
              `[data-md-block-handle="${candidate.dataset["mdBlockId"]}"]`,
            ) !== null,
        );
    const block = args.kind === "text" ? findByText(args.value) : findBySelector(args.value);
    if (block === undefined) {
      throw new Error(`missing block ${args.kind}: ${args.value}`);
    }
    const handle = block.querySelector<HTMLElement>(
      `[data-md-block-handle="${block.dataset["mdBlockId"]}"]`,
    );
    if (handle === null) {
      throw new Error(`missing block handle: ${args.value}`);
    }
    const dispatchBlockPointerDown = (): void => {
      (editor as HTMLElement).focus();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        handle.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 1,
            pointerType: "mouse",
            button: 0,
            buttons: 1,
          }),
        );
        if (editor.querySelectorAll(".md-block-selected").length > 0) return;
      }
    };
    dispatchBlockPointerDown();
    const data = new DataTransfer();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    editor.dispatchEvent(event);
    return data.getData("text/plain");
  }, target);
}

async function undoEditor(page: Page): Promise<void> {
  await page.locator('.toolbar [title="Undo"]').evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
}

async function redoEditor(page: Page): Promise<void> {
  await page.locator('.toolbar [title="Redo"]').evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
}

async function selectedBlockCount(page: Page): Promise<number> {
  return page
    .locator(".app-editor")
    .evaluate((editor) => editor.querySelectorAll(".md-block-selected").length);
}

async function syntheticCopy(page: Page): Promise<string> {
  return page.locator(".app-editor").evaluate((editor) => {
    const data = new DataTransfer();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    editor.dispatchEvent(event);
    return data.getData("text/plain");
  });
}

async function focusedHandleName(page: Page): Promise<string> {
  return page.locator(".app-editor").evaluate((editor) => {
    const handle = editor.querySelector<HTMLButtonElement>("[data-md-block-handle]");
    handle?.focus();
    return document.activeElement instanceof HTMLElement
      ? (document.activeElement.getAttribute("aria-label") ?? "")
      : "";
  });
}

async function inlineSyntaxSummary(page: Page): Promise<{
  strong: number;
  emphasis: number;
  code: number;
}> {
  return page.locator(".app-editor").evaluate((editor) => ({
    strong: editor.querySelectorAll("strong").length,
    emphasis: editor.querySelectorAll("em").length,
    code: editor.querySelectorAll("p code, li code, h1 code, h2 code, h3 code").length,
  }));
}

async function collectApiRequests(page: Page, fn: () => Promise<void>): Promise<string[]> {
  const requests: string[] = [];
  const handler = (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || url.pathname === "/events") {
      requests.push(`${request.method()} ${url.pathname}`);
    }
  };
  page.on("request", handler);
  try {
    await fn();
    await page.waitForTimeout(250);
  } finally {
    page.off("request", handler);
  }
  return requests;
}

function shortcutModifier(): "Control" | "Meta" {
  return process.platform === "darwin" ? "Meta" : "Control";
}

function mulberry32(seed: number): () => number {
  return function prng() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomPlainText(rand: () => number, minLen: number, maxLen: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789   ";
  const len = minLen + Math.floor(rand() * (maxLen - minLen + 1));
  return Array.from({ length: len }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
}

async function activeCursorHost(page: Page): Promise<{
  tagName: string;
  text: string;
  cursorAtEnd: boolean;
  inUnorderedList: boolean;
  inOrderedList: boolean;
  inTaskList: boolean;
  inBlockquote: boolean;
  inCodeBlock: boolean;
  previousTagName: string;
}> {
  return page.locator(".app-editor").evaluate(() => {
    const selection = getSelection();
    const anchor = selection?.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
    const host = anchorElement?.closest("li, h1, h2, h3, h4, h5, h6, p, code, pre");
    if (!(host instanceof HTMLElement)) {
      return {
        tagName: "",
        text: "",
        cursorAtEnd: false,
        inUnorderedList: false,
        inOrderedList: false,
        inTaskList: false,
        inBlockquote: false,
        inCodeBlock: false,
        previousTagName: "",
      };
    }
    const clone = host.cloneNode(true) as HTMLElement;
    for (const control of clone.querySelectorAll("button,input")) {
      control.remove();
    }
    const text = (clone.textContent ?? "").replaceAll("​", "").replace(/^\u00A0/, "");
    const cursorAtEnd =
      anchor !== null &&
      anchor !== undefined &&
      anchor.nodeType === Node.TEXT_NODE &&
      selection?.anchorOffset === (anchor.textContent ?? "").length;
    return {
      tagName: host.tagName,
      text,
      cursorAtEnd: text === "" || cursorAtEnd,
      inUnorderedList:
        host.tagName === "LI" && host.closest("ul:not(.task-list)") instanceof HTMLUListElement,
      inOrderedList: host.tagName === "LI" && host.closest("ol") instanceof HTMLOListElement,
      inTaskList: host.tagName === "LI" && host.closest(".task-list") instanceof HTMLUListElement,
      inBlockquote: host.closest("blockquote") instanceof HTMLQuoteElement,
      inCodeBlock: host.closest("pre") instanceof HTMLPreElement,
      previousTagName: host.previousElementSibling?.tagName ?? "",
    };
  });
}

async function visibleParagraphLayout(
  page: Page,
  beforeText: string,
  afterText: string,
  expectedBlankCount: number,
): Promise<{
  blankCount: number;
  ordered: boolean;
  blankHasLineBox: boolean;
  gapLooksLikeBlankLine: boolean;
}> {
  return page.locator(".app-editor").evaluate(
    (editor, labels) => {
      const children = [...editor.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      const before = children.find(
        (child) => child.dataset["mdBlank"] !== "true" && child.textContent === labels.beforeText,
      );
      const after = children.find(
        (child) => child.dataset["mdBlank"] !== "true" && child.textContent === labels.afterText,
      );
      const beforeIndex = before === undefined ? -1 : children.indexOf(before);
      const afterIndex = after === undefined ? -1 : children.indexOf(after);
      const blanks =
        beforeIndex === -1 || afterIndex === -1
          ? []
          : children
              .slice(beforeIndex + 1, afterIndex)
              .filter((child) => child.dataset["mdBlank"] === "true" && !child.hidden);
      const blank = blanks[labels.expectedBlankCount - 1];
      if (labels.expectedBlankCount === 0 && before && after) {
        const beforeRect = before.getBoundingClientRect();
        const afterRect = after.getBoundingClientRect();
        return {
          blankCount: blanks.length,
          ordered: beforeRect.bottom <= afterRect.top,
          blankHasLineBox: true,
          gapLooksLikeBlankLine: true,
        };
      }
      if (!before || !blank || !after) {
        return {
          blankCount: blanks.length,
          ordered: false,
          blankHasLineBox: false,
          gapLooksLikeBlankLine: false,
        };
      }

      const beforeRect = before.getBoundingClientRect();
      const blankRect = blank.getBoundingClientRect();
      const afterRect = after.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight);
      const minimumLine = Number.isFinite(lineHeight) ? lineHeight * 0.6 : 12;
      return {
        blankCount: blanks.length,
        ordered: beforeRect.bottom <= blankRect.top && blankRect.bottom <= afterRect.top,
        blankHasLineBox: blankRect.height > 0,
        gapLooksLikeBlankLine: afterRect.top - beforeRect.bottom >= minimumLine,
      };
    },
    { beforeText, afterText, expectedBlankCount },
  );
}

async function activeCursorBlankLayout(
  page: Page,
  beforeText: string,
): Promise<{
  visibleBlankCountAfterText: number;
  cursorHasLineBox: boolean;
  cursorIsAfterBlankLine: boolean;
}> {
  return page.locator(".app-editor").evaluate((editor, text) => {
    const children = [...editor.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const before = children.find(
      (child) => child.dataset["mdBlank"] !== "true" && child.textContent === text,
    );
    const selection = getSelection();
    const anchor = selection?.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
    const cursorHost = anchorElement?.closest("[data-md-line-index]");
    if (!(before instanceof HTMLElement) || !(cursorHost instanceof HTMLElement)) {
      return {
        visibleBlankCountAfterText: 0,
        cursorHasLineBox: false,
        cursorIsAfterBlankLine: false,
      };
    }
    const afterTextChildren = children.slice(children.indexOf(before) + 1);
    const visibleBlanks = afterTextChildren.filter(
      (child) => child.dataset["mdBlank"] === "true" && !child.hidden,
    );
    const cursorRect = cursorHost.getBoundingClientRect();
    const beforeRect = before.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight);
    const minimumLine = Number.isFinite(lineHeight) ? lineHeight * 0.6 : 12;
    return {
      visibleBlankCountAfterText: visibleBlanks.length,
      cursorHasLineBox: cursorRect.height >= minimumLine,
      cursorIsAfterBlankLine: cursorRect.top - beforeRect.bottom >= minimumLine,
    };
  }, beforeText);
}

async function activeCursorBetweenParagraphsLayout(
  page: Page,
  beforeText: string,
  afterText: string,
): Promise<{
  visibleLaneCount: number;
  cursorVisibleLaneOrdinal: number;
  cursorHasLineBox: boolean;
  cursorIsBetweenTextBlocks: boolean;
}> {
  return page.locator(".app-editor").evaluate(
    (editor, labels) => {
      const children = [...editor.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      const before = children.find(
        (child) => child.dataset["mdBlank"] !== "true" && child.textContent === labels.beforeText,
      );
      const after = children.find(
        (child) => child.dataset["mdBlank"] !== "true" && child.textContent === labels.afterText,
      );
      const selection = getSelection();
      const anchor = selection?.anchorNode;
      const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
      const cursorHost =
        anchorElement?.closest("[data-md-line-index]") ?? anchorElement?.closest("p");
      if (
        !(before instanceof HTMLElement) ||
        !(after instanceof HTMLElement) ||
        !(cursorHost instanceof HTMLElement)
      ) {
        return {
          visibleLaneCount: 0,
          cursorVisibleLaneOrdinal: 0,
          cursorHasLineBox: false,
          cursorIsBetweenTextBlocks: false,
        };
      }

      const beforeIndex = children.indexOf(before);
      const afterIndex = children.indexOf(after);
      const lanes = children.slice(beforeIndex + 1, afterIndex).filter((child) => {
        if (child.hidden) return false;
        if (child.dataset["mdBlank"] === "true") return true;
        return child === cursorHost && (child.textContent ?? "") === "";
      });
      const cursorOrdinal = lanes.indexOf(cursorHost) + 1;
      const beforeRect = before.getBoundingClientRect();
      const afterRect = after.getBoundingClientRect();
      const cursorRect = cursorHost.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight);
      const minimumLine = Number.isFinite(lineHeight) ? lineHeight * 0.6 : 12;
      return {
        visibleLaneCount: lanes.length,
        cursorVisibleLaneOrdinal: cursorOrdinal,
        cursorHasLineBox: cursorRect.height >= minimumLine,
        cursorIsBetweenTextBlocks:
          beforeRect.bottom <= cursorRect.top && cursorRect.bottom <= afterRect.top,
      };
    },
    { beforeText, afterText },
  );
}
