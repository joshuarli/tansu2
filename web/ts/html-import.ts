import Defuddle from "defuddle/full";

import type { NoteMeta } from "./types.generated.ts";

type ImportedMetadata = {
  author?: string;
  site?: string;
  published?: string;
  description?: string;
};

export type ImportedHtml = {
  path: string;
  content: string;
};

export async function pickHtmlImport(notes: Iterable<NoteMeta>): Promise<ImportedHtml | null> {
  const file = await pickHtmlFile();
  if (file === null) {
    return null;
  }
  const html = await file.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const parsed = await new Defuddle(doc, { markdown: true, separateMarkdown: true }).parseAsync();
  const markdown = parsed.contentMarkdown?.trim();
  if (markdown === undefined || markdown === "") {
    return null;
  }
  const title = parsed.title?.trim() || file.name.replace(/\.html?$/i, "") || "Imported";
  return {
    path: uniqueImportPath(title, notes),
    content: importedMarkdown(title, markdown, parsed),
  };
}

function pickHtmlFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".html,.htm,text/html";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
}

function importedMarkdown(title: string, markdown: string, parsed: ImportedMetadata): string {
  const metadata = [
    `Title: ${title}`,
    parsed.author ? `Author: ${parsed.author}` : null,
    parsed.site ? `Site: ${parsed.site}` : null,
    parsed.published ? `Published: ${parsed.published}` : null,
    parsed.description ? `Description: ${parsed.description}` : null,
  ].filter((line): line is string => line !== null);
  const heading = markdown.startsWith("# ") ? "" : `# ${title}\n\n`;
  return metadata.length === 0
    ? `${heading}${markdown}\n`
    : `${heading}${metadata.join("\n")}\n\n${markdown}\n`;
}

function uniqueImportPath(title: string, notes: Iterable<NoteMeta>): string {
  const stem =
    title
      .trim()
      .replace(/[^\d A-Za-z._-]+/g, "")
      .replace(/\s+/g, " ")
      .trim() || "Imported";
  let path = `${stem}.md`;
  let suffix = 2;
  const existing = new Set([...notes].map((note) => note.path.toLowerCase()));
  while (existing.has(path.toLowerCase())) {
    path = `${stem} ${suffix}.md`;
    suffix += 1;
  }
  return path;
}
