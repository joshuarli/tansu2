/// Markdown → HTML renderer. Supports the subset used in note-taking:
/// headings, paragraphs, lists (ul/ol/task), blockquotes,
/// fenced code blocks, tables, HR, and inline formatting.
/// Callouts, wiki-links, and wiki-images are provided as extensions.

import { CODE_FENCE_MARKER_LENGTH, LIST_INDENT_SPACES, MAX_HEADING_LEVEL } from "./constants.js";
import type { MarkdownExtension } from "./extension.js";
import { highlightCode } from "./highlight.js";
import { escapeHtml, CURSOR_SENTINEL, SEL_START_SENTINEL, SEL_END_SENTINEL } from "./util.js";

type Block =
  | { type: "heading"; level: number; text: string; sourceStart: number }
  | { type: "paragraph"; text: string }
  | { type: "task"; text: string; checked: boolean; sourceStart: number }
  | { type: "blank" }
  | { type: "code"; lang: string; text: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "table"; header: string[]; rows: string[][] };

type ListItem = {
  text: string;
  checked: boolean | null; // null = not a task item
  sourceStart: number;
  nested?: ListNode[];
};

type ListNode = {
  ordered: boolean;
  items: ListItem[];
};

function isBlockStart(line: string): boolean {
  return (
    new RegExp(
      `^(#{1,${MAX_HEADING_LEVEL}}\\s|[\`~]{${CODE_FENCE_MARKER_LENGTH},}|>|(-{3,}|\\*{3,}|_{3,})\\s*$)`,
    ).test(line) || parseListLine(line) !== null
  );
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Blank line
    if (line.trim() === "") {
      blocks.push({ type: "blank" });
      i++;
      continue;
    }

    // Fenced code block
    const fenceMatch = line.match(new RegExp(`^([\`~]{${CODE_FENCE_MARKER_LENGTH},})(.*)`));
    if (fenceMatch) {
      const fence = fenceMatch[1]!;
      const lang = fenceMatch[2]!.trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith(fence.charAt(0).repeat(fence.length))) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: "code", lang, text: codeLines.join("\n") });
      continue;
    }

    // Heading
    const headingMatch = line.match(new RegExp(`^(#{1,${MAX_HEADING_LEVEL}})\\s+(.*)`));
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1]!.length,
        text: headingMatch[2]!,
        sourceStart: headingMatch[1]!.length + 1,
      });
      i++;
      continue;
    }

    // HR
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Table: line starts with | and next line is a separator
    if (
      line.trimStart().startsWith("|") &&
      i + 1 < lines.length &&
      /^\|?[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|?\s*$/.test(lines[i + 1]!)
    ) {
      const headerCells = parseTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith("|")) {
        rows.push(parseTableRow(lines[i]!));
        i++;
      }
      blocks.push({ type: "table", header: headerCells, rows });
      continue;
    }

    // List (unordered, ordered, or task)
    const listStart = parseListLine(line);
    if (listStart) {
      const parsed = parseList(lines, i, listStart.indent);
      blocks.push({ type: "list", ordered: parsed.list.ordered, items: parsed.list.items });
      i = parsed.nextIndex;
      continue;
    }

    // Bare task item: "[ ] foo" or "[x] foo"
    const taskStart = parseTaskLine(line);
    if (taskStart) {
      blocks.push({
        type: "task",
        checked: taskStart.checked,
        text: taskStart.text,
        sourceStart: taskStart.sourceStart,
      });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const bqLines: string[] = [];
      while (
        i < lines.length &&
        (lines[i]!.startsWith(">") ||
          (lines[i]!.trim() !== "" && bqLines.length > 0 && !lines[i]!.startsWith("#")))
      ) {
        if (!lines[i]!.startsWith(">")) {
          break;
        }
        // Strip the leading > and optional space
        bqLines.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", lines: bqLines });
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-special lines
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (l.trim() === "") {
        break;
      }
      if (isBlockStart(l)) {
        break;
      }
      if (
        l.trimStart().startsWith("|") &&
        i + 1 < lines.length &&
        /^\|?[\s:]*-+/.test(lines[i + 1] ?? "")
      ) {
        break;
      }
      paraLines.push(l);
      i++;
    }
    for (const paraLine of paraLines) {
      blocks.push({ type: "paragraph", text: paraLine });
    }
  }

  return blocks;
}

function parseList(
  lines: readonly string[],
  startIndex: number,
  baseIndent: number,
): { list: ListNode; nextIndex: number } {
  const first = parseListLine(lines[startIndex]!);
  if (!first) {
    return { list: { ordered: false, items: [] }, nextIndex: startIndex };
  }

  const items: ListItem[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const parsed = parseListLine(lines[i]!);
    if (!parsed) {
      break;
    }

    if (parsed.indent < baseIndent) {
      break;
    }

    if (parsed.indent > baseIndent) {
      const lastItem = items.at(-1);
      if (!lastItem) {
        break;
      }
      const nested = parseList(lines, i, parsed.indent);
      lastItem.nested ??= [];
      lastItem.nested.push(nested.list);
      i = nested.nextIndex;
      continue;
    }

    if (parsed.ordered !== first.ordered) {
      break;
    }

    items.push({ text: parsed.text, checked: parsed.checked, sourceStart: parsed.sourceStart });
    i++;
  }

  return { list: { ordered: first.ordered, items }, nextIndex: i };
}

function parseListLine(line: string): {
  indent: number;
  ordered: boolean;
  text: string;
  checked: boolean | null;
  sourceStart: number;
} | null {
  const match = line.match(/^([ \t]*)([-*+]|\d+\.)(?:\s(.*))?$/);
  if (!match) {
    return null;
  }
  if ((match[2] === "*" || match[2] === "+") && match[3] === undefined) {
    return null;
  }

  let text = match[3] ?? "";
  let checked: boolean | null = null;
  let sourceStart = match[0].length - text.length;
  const taskMatch = text.match(/^\[([ xX])\]\s(.*)/);
  if (taskMatch) {
    checked = taskMatch[1] !== " ";
    text = taskMatch[2]!;
    sourceStart = match[0].length - text.length;
  }

  return {
    indent: countIndent(match[1]!),
    ordered: /\d+\./.test(match[2]!),
    text,
    checked,
    sourceStart,
  };
}

function parseTaskLine(
  line: string,
): { checked: boolean; text: string; sourceStart: number } | null {
  const match = line.match(/^([ \t]*)\[([ xX])\]\s(.*)$/);
  if (!match) {
    return null;
  }
  return {
    checked: match[2] !== " ",
    text: match[3]!,
    sourceStart: match[0].length - match[3]!.length,
  };
}

function countIndent(indent: string): number {
  let width = 0;
  for (const ch of indent) {
    width += ch === "\t" ? LIST_INDENT_SPACES : 1;
  }
  return width;
}

function parseTableRow(line: string): string[] {
  // Strip leading/trailing pipe and split
  let s = line.trim();
  if (s.startsWith("|")) {
    s = s.slice(1);
  }
  if (s.endsWith("|")) {
    s = s.slice(0, -1);
  }
  return s.split("|").map((c) => c.trim());
}

/// Find closing delimiter, skipping escaped characters.
function findClosing(text: string, delim: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === delim) {
      return i;
    }
  }
  return -1;
}

function sourceAttrs(start: number, end: number, contentStart = start, contentEnd = end): string {
  return ` data-md-source-start="${start}" data-md-source-end="${end}" data-md-content-start="${contentStart}" data-md-content-end="${contentEnd}"`;
}

function createRenderer(extensions: MarkdownExtension[], editorSourceSpans = false) {
  function renderLines(lines: string[]): string {
    const blocks = parseBlocks(lines);
    return blocks.map(renderBlock).join("\n");
  }

  function renderBlockquote(bqLines: string[]): string {
    // Try extension hooks first
    for (const ext of extensions) {
      const result = ext.renderBlockquote?.(bqLines, renderLines);
      if (result !== null && result !== undefined) return result;
    }
    // Regular blockquote: recursively parse inner content
    return `<blockquote>${renderLines(bqLines)}</blockquote>`;
  }

  function renderListNode(list: ListNode): string {
    const tag = list.ordered ? "ol" : "ul";
    const cls =
      !list.ordered && list.items.some((item) => item.checked !== null) ? ' class="task-list"' : "";
    const items = list.items
      .map((item) => {
        const itemCls = item.checked !== null ? ' class="task-item"' : "";
        const textHtml =
          item.checked !== null
            ? `<input type="checkbox"${item.checked ? " checked" : ""}>&nbsp;${inline(
                item.text,
                item.sourceStart,
              )}`
            : inline(item.text, item.sourceStart);
        const nestedHtml = item.nested?.map(renderListNode).join("\n") ?? "";
        const contentHtml = textHtml || nestedHtml ? textHtml : "<br>";
        return nestedHtml
          ? `<li${itemCls}>${contentHtml}\n${nestedHtml}</li>`
          : `<li${itemCls}>${contentHtml}</li>`;
      })
      .join("\n");
    return `<${tag}${cls}>\n${items}\n</${tag}>`;
  }

  function renderBlock(block: Block): string {
    switch (block.type) {
      case "heading": {
        return `<h${block.level}>${inline(block.text, block.sourceStart)}</h${block.level}>`;
      }
      case "paragraph": {
        return `<p>${inline(block.text)}</p>`;
      }
      case "task": {
        return `<ul class="task-list">\n<li class="task-item"><input type="checkbox"${
          block.checked ? " checked" : ""
        }>&nbsp;${block.text === "" ? "<br>" : inline(block.text, block.sourceStart)}</li>\n</ul>`;
      }
      case "blank": {
        return '<p data-md-blank="true" hidden></p>';
      }
      case "hr": {
        return "<hr>";
      }
      case "code": {
        const highlighted = block.lang
          ? highlightCode(block.text, block.lang)
          : escapeHtml(block.text);
        const cls = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : "";
        return `<pre><code${cls}>${highlighted}</code></pre>`;
      }
      case "list": {
        return renderListNode({ ordered: block.ordered, items: block.items });
      }
      case "blockquote": {
        return renderBlockquote(block.lines);
      }
      case "table": {
        const head = block.header.map((c) => `<th>${inline(c)}</th>`).join("");
        const body = block.rows
          .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("\n");
        return `<table>\n<tr>${head}</tr>\n${body}\n</table>`;
      }
      default: {
        return (block satisfies never, "");
      }
    }
  }

  /// Inline rendering: handles bold, italic, strikethrough, code, highlight,
  /// wiki-links, wiki-images, links, images, and escaped characters.
  function inline(text: string, baseOffset = 0): string {
    let out = "";
    let i = 0;
    const len = text.length;

    while (i < len) {
      const ch = text[i]!;

      // Escaped character
      if (ch === "\\" && i + 1 < len) {
        const next = text[i + 1]!;
        if ("\\`*_{}[]()#+-.!~=|".includes(next)) {
          out += escapeHtml(next);
          i += 2;
          continue;
        }
      }

      if (ch === CURSOR_SENTINEL) {
        out += '<span data-md-cursor="true"></span>';
        i++;
        continue;
      }

      if (ch === SEL_START_SENTINEL) {
        out += '<span data-md-sel-start="true"></span>';
        i++;
        continue;
      }

      if (ch === SEL_END_SENTINEL) {
        out += '<span data-md-sel-end="true"></span>';
        i++;
        continue;
      }

      // Inline code (backtick) — no nesting
      if (ch === "`") {
        const end = text.indexOf("`", i + 1);
        if (end !== -1) {
          const attrs = editorSourceSpans
            ? sourceAttrs(
                baseOffset + i,
                baseOffset + end + 1,
                baseOffset + i + 1,
                baseOffset + end,
              )
            : "";
          out += `<code${attrs}>${escapeHtml(text.slice(i + 1, end))}</code>`;
          i = end + 1;
          continue;
        }
      }

      // Image: ![alt](src)
      if (ch === "!" && text[i + 1] === "[") {
        const m = text.slice(i).match(/^!\[([^\]]*)\]\(([^)]+)\)/);
        if (m) {
          const attrs = editorSourceSpans
            ? sourceAttrs(baseOffset + i, baseOffset + i + m[0].length)
            : "";
          out += `<img${attrs} src="${escapeHtml(m[2]!)}" alt="${escapeHtml(m[1]!)}">`;
          i += m[0].length;
          continue;
        }
      }

      // Link: [text](url)
      if (ch === "[") {
        const m = text.slice(i).match(/^\[([^\]]*)\]\(([^)]+)\)/);
        if (m) {
          const textStart = baseOffset + i + 1;
          const attrs = editorSourceSpans
            ? sourceAttrs(
                baseOffset + i,
                baseOffset + i + m[0].length,
                textStart,
                textStart + m[1]!.length,
              )
            : "";
          out += `<a${attrs} href="${escapeHtml(m[2]!)}">${inline(m[1]!, textStart)}</a>`;
          i += m[0].length;
          continue;
        }
      }

      // Highlight: ==text==
      if (ch === "=" && text[i + 1] === "=") {
        const end = text.indexOf("==", i + 2);
        if (end !== -1) {
          const attrs = editorSourceSpans
            ? sourceAttrs(
                baseOffset + i,
                baseOffset + end + 2,
                baseOffset + i + 2,
                baseOffset + end,
              )
            : "";
          out += `<mark${attrs}>${inline(text.slice(i + 2, end), baseOffset + i + 2)}</mark>`;
          i = end + 2;
          continue;
        }
      }

      // Strikethrough: ~~text~~
      if (ch === "~" && text[i + 1] === "~") {
        const end = text.indexOf("~~", i + 2);
        if (end !== -1) {
          const attrs = editorSourceSpans
            ? sourceAttrs(
                baseOffset + i,
                baseOffset + end + 2,
                baseOffset + i + 2,
                baseOffset + end,
              )
            : "";
          out += `<del${attrs}>${inline(text.slice(i + 2, end), baseOffset + i + 2)}</del>`;
          i = end + 2;
          continue;
        }
      }

      // Bold: **text**
      if (ch === "*" && text[i + 1] === "*") {
        const end = text.indexOf("**", i + 2);
        if (end !== -1) {
          const attrs = editorSourceSpans
            ? sourceAttrs(
                baseOffset + i,
                baseOffset + end + 2,
                baseOffset + i + 2,
                baseOffset + end,
              )
            : "";
          out += `<strong${attrs}>${inline(text.slice(i + 2, end), baseOffset + i + 2)}</strong>`;
          i = end + 2;
          continue;
        }
      }

      // Italic: *text*
      if (ch === "*") {
        const end = findClosing(text, "*", i + 1);
        if (end !== -1) {
          const attrs = editorSourceSpans
            ? sourceAttrs(
                baseOffset + i,
                baseOffset + end + 1,
                baseOffset + i + 1,
                baseOffset + end,
              )
            : "";
          out += `<em${attrs}>${inline(text.slice(i + 1, end), baseOffset + i + 1)}</em>`;
          i = end + 1;
          continue;
        }
      }

      // Bare URL: http:// or https://
      if (
        ch === "h" &&
        (text.slice(i, i + 7) === "http://" || text.slice(i, i + 8) === "https://")
      ) {
        let end = i;
        while (end < len && !" \n\t<>\"'`".includes(text[end]!)) {
          end++;
        }
        while (end > i && ".,)!?;:".includes(text[end - 1]!)) {
          end--;
        }
        const url = text.slice(i, end);
        const attrs = editorSourceSpans ? sourceAttrs(baseOffset + i, baseOffset + end) : "";
        out += `<a${attrs} href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
        i = end;
        continue;
      }

      // Line break
      if (ch === "\n") {
        out += "<br>";
        i++;
        continue;
      }

      if (ch === "\t") {
        out += '<span class="md-tab">\t</span>';
        i++;
        continue;
      }

      // HTML special chars
      if (ch === "&") {
        out += "&amp;";
        i++;
        continue;
      }
      if (ch === "<") {
        out += "&lt;";
        i++;
        continue;
      }
      if (ch === ">") {
        out += "&gt;";
        i++;
        continue;
      }

      // Extension inline hooks
      let claimed = false;
      for (const ext of extensions) {
        const result = ext.renderInline?.(text, i);
        if (result) {
          out += editorSourceSpans
            ? `<span${sourceAttrs(
                baseOffset + i,
                baseOffset + i + result.consumed,
                baseOffset + i,
                baseOffset + i + result.consumed,
              )} data-md-atomic-source="true">${result.html}</span>`
            : result.html;
          i += result.consumed;
          claimed = true;
          break;
        }
      }
      if (claimed) continue;

      out += ch;
      i++;
    }

    return out;
  }

  function _renderMarkdown(src: string): string {
    if (src === "") {
      return "";
    }
    const lines = src.split("\n");
    const blocks = parseBlocks(lines);
    return blocks.map(renderBlock).join("\n");
  }

  return {
    renderMarkdown: _renderMarkdown,

    renderMarkdownWithCursor(src: string, offset: number): string {
      const clamped = Math.max(0, Math.min(offset, src.length));
      return _renderMarkdown(src.slice(0, clamped) + CURSOR_SENTINEL + src.slice(clamped));
    },

    renderMarkdownWithSelection(src: string, selStart: number, selEnd: number): string {
      const clampedStart = Math.max(0, Math.min(selStart, src.length));
      const clampedEnd = Math.max(clampedStart, Math.min(selEnd, src.length));
      // Insert end sentinel first (higher offset) so inserting it doesn't shift the start offset.
      const withEnd = src.slice(0, clampedEnd) + SEL_END_SENTINEL + src.slice(clampedEnd);
      const withBoth =
        withEnd.slice(0, clampedStart) + SEL_START_SENTINEL + withEnd.slice(clampedStart);
      return _renderMarkdown(withBoth);
    },
  };
}

type RenderOpts = { extensions?: MarkdownExtension[] };

export function renderMarkdown(src: string, opts?: RenderOpts): string {
  return createRenderer(opts?.extensions ?? []).renderMarkdown(src);
}

export function renderMarkdownWithCursor(src: string, offset: number, opts?: RenderOpts): string {
  return createRenderer(opts?.extensions ?? []).renderMarkdownWithCursor(src, offset);
}

/// Render markdown with selection markers inserted. Emits
/// <span data-md-sel-start> and <span data-md-sel-end> at the given offsets
/// so callers can restore the DOM selection after re-rendering.
export function renderMarkdownWithSelection(
  src: string,
  selStart: number,
  selEnd: number,
  opts?: RenderOpts,
): string {
  return createRenderer(opts?.extensions ?? []).renderMarkdownWithSelection(src, selStart, selEnd);
}

export function renderEditorMarkdown(src: string, opts?: RenderOpts): string {
  return createRenderer(opts?.extensions ?? [], true).renderMarkdown(src);
}

export function renderEditorMarkdownWithCursor(
  src: string,
  offset: number,
  opts?: RenderOpts,
): string {
  return createRenderer(opts?.extensions ?? [], true).renderMarkdownWithCursor(src, offset);
}

export function renderEditorMarkdownWithSelection(
  src: string,
  selStart: number,
  selEnd: number,
  opts?: RenderOpts,
): string {
  return createRenderer(opts?.extensions ?? [], true).renderMarkdownWithSelection(
    src,
    selStart,
    selEnd,
  );
}
