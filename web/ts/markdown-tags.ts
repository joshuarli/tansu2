import type { Tab } from "./state.ts";

export function editableMarkdown(tab: Tab): string {
  const content = tab.draft ?? tab.doc?.content ?? "";
  return frontmatterSupportsTags(content) ? markdownBody(content) : normalizeLineEndings(content);
}

export function frontmatterSupportsTags(content: string): boolean {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return true;
  }
  const normalized = content.replaceAll("\r\n", "\n");
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return false;
  }
  const body = normalized.slice(4, end).split("\n");
  let inTagsList = false;
  for (const line of body) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    if (trimmed.startsWith("tags:")) {
      inTagsList = true;
      continue;
    }
    if (inTagsList && trimmed.startsWith("-")) {
      continue;
    }
    return false;
  }
  return true;
}

export function setMarkdownTags(content: string, tags: string[]): string {
  const body = markdownBody(content);
  if (tags.length === 0) {
    return body;
  }
  return `---\ntags:\n${tags.map((tag) => `  - ${tag}`).join("\n")}\n---\n\n${body}`;
}

export function markdownBody(content: string): string {
  const normalized = normalizeLineEndings(content);
  const hasFrontmatter = normalized.startsWith("---\n");
  const end = hasFrontmatter ? normalized.indexOf("\n---", 4) : -1;
  return end === -1 ? normalized : normalized.slice(end + 4).replace(/^\n+/, "");
}

function normalizeLineEndings(content: string): string {
  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function normalizeTag(value: string): string | null {
  const tag = value.trim().replace(/^#/, "");
  return tag === "" || /[\r\n]/.test(tag) ? null : tag;
}
