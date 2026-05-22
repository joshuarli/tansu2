import type { NoteMeta } from "./types.generated.ts";

type ImportedMetadata = {
  author?: string;
  site?: string;
  published?: string;
  description?: string;
};

export type HtmlImportParseResult = ImportedMetadata & {
  title?: string;
  contentMarkdown?: string;
};

type HtmlImportParser = (html: string) => Promise<HtmlImportParseResult>;

export type ImportedHtml = {
  path: string;
  content: string;
};

type ImportHtmlOptions = {
  html: string;
  fallbackTitle: string;
  notes?: Iterable<NoteMeta>;
  parse: HtmlImportParser;
};

export async function importHtml(options: ImportHtmlOptions): Promise<ImportedHtml | null> {
  const parsed = await options.parse(options.html);
  const markdown = parsed.contentMarkdown?.trim();
  if (markdown === undefined || markdown === "") {
    return null;
  }
  const title = parsed.title?.trim() || stripHtmlExtension(options.fallbackTitle) || "Imported";
  return {
    path: uniqueImportPath(title, options.notes ?? []),
    content: importedMarkdown(title, markdown, parsed),
  };
}

function stripHtmlExtension(name: string): string {
  return name.replace(/\.html?$/i, "");
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
