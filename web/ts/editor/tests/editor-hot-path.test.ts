import { expect, describe, it, beforeEach, vi, afterAll, beforeAll, afterEach } from "vitest";

import { setupDOM } from "./test-helper.ts";

describe("editor hot paths", () => {
  let cleanup: () => void;

  beforeAll(() => {
    cleanup = setupDOM();
  });

  afterAll(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.doUnmock("../serialize.ts");
  });

  it("does not serialize the visual DOM for typing, snapshots, cursor capture, or source entry", async () => {
    const domToMarkdown = vi.fn(() => {
      throw new Error("domToMarkdown should not be called on editor hot paths");
    });
    vi.doMock(import("../serialize.ts"), async (importOriginal) => ({
      ...((await importOriginal()) as object),
      domToMarkdown,
    }));
    const { createEditor } = await import("../editor.ts");

    const container = document.createElement("div");
    document.body.append(container);
    const handle = createEditor(container);
    handle.setValue("hello\nworld", 5);

    const textNode = handle.contentEl.querySelector("p")!.firstChild!;
    textNode.textContent = "hello!";
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 6);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    handle.contentEl.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText" }),
    );

    expect(handle.getValue()).toBe("hello!\nworld");
    expect(handle.getSnapshot().markdown).toBe("hello!\nworld");
    expect(handle.getSelectionOffsets()).toStrictEqual({ start: 6, end: 6 });
    expect(handle.getCursorOffset()).toBe(6);

    handle.toggleSourceMode();
    expect(handle.sourceEl.value).toBe("hello!\nworld");
    expect(domToMarkdown).not.toHaveBeenCalled();
    handle.destroy();
  });
});
