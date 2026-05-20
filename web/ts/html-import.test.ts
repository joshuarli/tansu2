import type { NoteMeta } from "./types.generated.ts";

const defuddle = vi.hoisted(() => ({
  parseAsync: vi.fn(),
}));

vi.mock("defuddle/full", () => ({
  default: vi.fn(function Defuddle() {
    return defuddle;
  }),
}));

const { pickHtmlImport } = await import("./html-import.ts");

describe("HTML import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the picker is cancelled", async () => {
    mockPickedFile(null);

    await expect(pickHtmlImport([])).resolves.toBeNull();
  });

  it("creates unique markdown with imported metadata", async () => {
    mockPickedFile(new File(["<article>body</article>"], "Saved Page.html", { type: "text/html" }));
    defuddle.parseAsync.mockResolvedValueOnce({
      title: "Saved Page",
      author: "Ada",
      site: "Example",
      published: "2026-05-20",
      description: "Imported description",
      contentMarkdown: "Body text",
    });

    await expect(pickHtmlImport([note("saved-page.md"), note("Saved Page.md")])).resolves.toEqual({
      path: "Saved Page 2.md",
      content:
        "# Saved Page\n\nTitle: Saved Page\nAuthor: Ada\nSite: Example\nPublished: 2026-05-20\nDescription: Imported description\n\nBody text\n",
    });
  });

  it("falls back to the file name and rejects empty markdown", async () => {
    mockPickedFile(new File(["<article></article>"], "clip.htm", { type: "text/html" }));
    defuddle.parseAsync.mockResolvedValueOnce({ title: "", contentMarkdown: "  " });

    await expect(pickHtmlImport([])).resolves.toBeNull();
  });

  it("does not duplicate an existing top-level heading", async () => {
    mockPickedFile(new File(["<article>body</article>"], "clip.html", { type: "text/html" }));
    defuddle.parseAsync.mockResolvedValueOnce({ title: "Clip", contentMarkdown: "# Clip\n\nBody" });

    await expect(pickHtmlImport([])).resolves.toEqual({
      path: "Clip.md",
      content: "Title: Clip\n\n# Clip\n\nBody\n",
    });
  });
});

function mockPickedFile(file: File | null): void {
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementationOnce((tagName: string) => {
    const input = createElement(tagName) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: file === null ? null : [file],
      configurable: true,
    });
    input.click = () => input.dispatchEvent(new Event("change"));
    return input;
  });
}

function note(path: string): NoteMeta {
  return {
    noteId: path,
    path,
    title: path,
    tags: [],
    seq: 1,
    contentHash: "hash",
    updatedAtMs: 1,
  };
}
