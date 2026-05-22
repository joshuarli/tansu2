import { LIST_INDENT_SPACES } from "./constants.js";
import type { SelectionOffsets } from "./editor-selection.js";

export type SourceModeControllerOptions = {
  sourceEl: HTMLTextAreaElement;
  contentEl: HTMLElement;
  getIndentUnit(): string;
  onChange(): void;
  onSave(): void;
  undo(): void;
  redo(): void;
  isSourceMode(): boolean;
  syncModelFromSource(): void;
  syncActiveLineFromDom(): boolean;
  syncSelectionFromDomMetadata(): boolean;
  currentMarkdown(): string;
  currentSelectionOffsets(): SelectionOffsets | null;
  checkpointUndo(): void;
  resetUndo(markdown: string, selectionStart: number, selectionEnd: number): void;
  scheduleTypingCheckpoint(): void;
  setSourceMode(sourceMode: boolean): void;
  renderCurrentModel(): void;
};

export function createSourceModeController(options: SourceModeControllerOptions): {
  onSourceInput(): void;
  onSourceKeyDown(e: KeyboardEvent): void;
  toggleSourceMode(): void;
} {
  function dedentLine(line: string): string {
    const indentUnit = options.getIndentUnit();
    if (line.startsWith(indentUnit)) return line.slice(indentUnit.length);
    const match = line.match(new RegExp(`^[ ]{1,${LIST_INDENT_SPACES}}`));
    return match ? line.slice(match[0].length) : line;
  }

  function handleSourceTabKey(e: KeyboardEvent): void {
    e.preventDefault();
    const indentUnit = options.getIndentUnit();
    const { sourceEl } = options;
    const { value } = sourceEl;
    const start = sourceEl.selectionStart;
    const end = sourceEl.selectionEnd;

    if (!e.shiftKey && start === end) {
      sourceEl.value = value.slice(0, start) + indentUnit + value.slice(end);
      sourceEl.selectionStart = start + indentUnit.length;
      sourceEl.selectionEnd = start + indentUnit.length;
      options.onChange();
      return;
    }

    const lineStartIdx = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const adjustedEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const nextNewline = value.indexOf("\n", adjustedEnd);
    const lineEnd = nextNewline === -1 ? value.length : nextNewline;
    const lines = value.slice(lineStartIdx, lineEnd).split("\n");
    const transformed = e.shiftKey ? lines.map(dedentLine) : lines.map((l) => indentUnit + l);
    sourceEl.setRangeText(transformed.join("\n"), lineStartIdx, lineEnd, "select");
    sourceEl.selectionStart = lineStartIdx;
    sourceEl.selectionEnd = lineStartIdx + transformed.join("\n").length;
    options.onChange();
  }

  function onSourceInput(): void {
    options.syncModelFromSource();
    options.scheduleTypingCheckpoint();
    options.onChange();
  }

  function onSourceKeyDown(e: KeyboardEvent): void {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === "s") {
      e.preventDefault();
      e.stopPropagation();
      options.onSave();
      return;
    }
    if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      options.undo();
      return;
    }
    if (
      (meta && e.shiftKey && e.key.toLowerCase() === "z") ||
      (meta && e.key.toLowerCase() === "y")
    ) {
      e.preventDefault();
      options.redo();
      return;
    }
    if (e.key === "Tab") {
      handleSourceTabKey(e);
    }
  }

  function toggleSourceMode(): void {
    const { contentEl, sourceEl } = options;
    if (options.isSourceMode()) {
      options.syncModelFromSource();
      const offsets = options.currentSelectionOffsets();
      options.resetUndo(options.currentMarkdown(), offsets?.start ?? 0, offsets?.end ?? 0);
      options.setSourceMode(false);
      sourceEl.style.display = "none";
      contentEl.style.display = "";
      options.renderCurrentModel();
    } else {
      if (!options.syncActiveLineFromDom()) {
        options.syncSelectionFromDomMetadata();
      }
      const offsets = options.currentSelectionOffsets();
      sourceEl.value = options.currentMarkdown();
      options.checkpointUndo();
      options.setSourceMode(true);
      contentEl.style.display = "none";
      sourceEl.style.display = "";
      const start = offsets?.start ?? 0;
      const end = offsets?.end ?? start;
      sourceEl.focus();
      sourceEl.setSelectionRange(start, end);
    }
  }

  return {
    onSourceInput,
    onSourceKeyDown,
    toggleSourceMode,
  };
}
