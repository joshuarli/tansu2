import { expect, beforeAll, describe, afterAll, it } from 'vitest';
import { normalizeEditableContent } from "../editor-normalize.ts";
import { setupDOM } from "./test-helper.ts";

describe("normalizeEditableContent", () => {
  let cleanup: () => void;

  function html(content: string): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML = content;
    return el;
  }

  beforeAll(() => {
    cleanup = setupDOM();
  });

  afterAll(() => {
    cleanup();
  });

  it("removes trailing placeholder breaks from headings with text", () => {
    const root = html("<h1>a<br><br></h1>");
    normalizeEditableContent(root);
    expect(root.innerHTML).toBe("<h1>a</h1>");
  });

  it("removes leading placeholder breaks from paragraphs with text", () => {
    const root = html("<p><br>x</p>");
    normalizeEditableContent(root);
    expect(root.innerHTML).toBe("<p>x</p>");
  });

  it("normalizes explicit blank paragraphs to hidden sentinels", () => {
    const root = html('<p data-md-blank="true"><br></p>');
    normalizeEditableContent(root);
    expect(root.innerHTML).toBe('<p data-md-blank="true" hidden=""></p>');
  });

  it("normalizes inserted empty paragraphs to hidden sentinels", () => {
    const root = html("<p>foo</p><p></p><p>bar</p>");
    normalizeEditableContent(root);
    expect(root.innerHTML).toBe('<p>foo</p><p data-md-blank="true" hidden=""></p><p>bar</p>');
  });

  it("leaves a lone empty paragraph editable", () => {
    const root = html("<p><br></p>");
    normalizeEditableContent(root);
    expect(root.innerHTML).toBe("<p><br></p>");
  });
});
