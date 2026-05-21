import { INLINE_TRANSFORM_SEARCH_LIMIT } from "./constants.js";

export type InlinePattern = {
  open: string;
  close: string;
  tag: string;
  trailingSpace?: boolean;
};

export const patterns: InlinePattern[] = [
  { open: "**", close: "**", tag: "strong" },
  { open: "~~", close: "~~", tag: "del" },
  { open: "==", close: "==", tag: "mark" },
  { open: "`", close: "`", tag: "code", trailingSpace: true },
  { open: "*", close: "*", tag: "em" },
];

export function matchPattern(
  text: string,
  pos: number,
  pat: InlinePattern,
): { start: number; content: string } | null {
  const { open, close } = pat;

  let end = pos;
  if (pat.trailingSpace) {
    if (pos < 1) {
      return null;
    }
    const last = text[pos - 1];
    if (last !== " " && last !== "\u00A0") {
      return null;
    }
    end = pos - 1;
  }

  if (end < open.length + close.length + 1) {
    return null;
  }

  if (text.slice(end - close.length, end) !== close) {
    return null;
  }

  if (close === "*" && end >= 2 && text[end - 2] === "*") {
    return null;
  }

  if (close === "`" && end >= 2 && text[end - 2] === "`") {
    return null;
  }

  const contentEnd = end - close.length;
  const searchStart = Math.max(0, contentEnd - INLINE_TRANSFORM_SEARCH_LIMIT);

  for (let i = contentEnd - 1; i >= searchStart; i--) {
    if (text.slice(i, i + open.length) !== open) {
      continue;
    }

    if (open === "*" && ((i > 0 && text[i - 1] === "*") || text[i + 1] === "*")) {
      continue;
    }

    if (open === "`" && ((i > 0 && text[i - 1] === "`") || text[i + 1] === "`")) {
      continue;
    }

    const content = text.slice(i + open.length, contentEnd);
    if (content.length === 0 || content.startsWith(" ") || content.endsWith(" ")) {
      continue;
    }

    return { start: i, content };
  }

  return null;
}
