import Defuddle from "defuddle/full";

import { importHtml, type HtmlImportParseResult, type ImportedHtml } from "./html-importer.ts";
import type { NoteMeta } from "./types.generated.ts";

export type { ImportedHtml } from "./html-importer.ts";

export async function pickHtmlImport(notes: Iterable<NoteMeta>): Promise<ImportedHtml | null> {
  const file = await pickHtmlFile();
  if (file === null) {
    return null;
  }
  const html = await file.text();
  return importHtml({ html, fallbackTitle: file.name, notes, parse: parseHtmlWithDefuddle });
}

async function parseHtmlWithDefuddle(html: string): Promise<HtmlImportParseResult> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return new Defuddle(doc, { separateMarkdown: true }).parseAsync();
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
