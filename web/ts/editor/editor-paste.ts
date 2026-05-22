import type { SelectionOffsets } from "./editor-selection.js";
import type { MarkdownExtension } from "./extension.js";
import { domToMarkdown } from "./serialize.js";

const DISALLOWED_PASTE_TAGS = new Set([
  "BASE",
  "EMBED",
  "FRAME",
  "IFRAME",
  "LINK",
  "META",
  "OBJECT",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
]);

function hasDataTransferType(dataTransfer: DataTransfer, type: string): boolean {
  return [...dataTransfer.types].includes(type);
}

export function hasPlainTextOnlyPaste(dataTransfer: DataTransfer): boolean {
  return (
    hasDataTransferType(dataTransfer, "text/plain") &&
    !hasDataTransferType(dataTransfer, "text/html")
  );
}

function isSafePastedUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === "") {
    return true;
  }
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("#") ||
    lower.startsWith("/") ||
    lower.startsWith("./") ||
    lower.startsWith("../") ||
    lower.startsWith("http:") ||
    lower.startsWith("https:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:") ||
    lower.startsWith("data:image/")
  );
}

function sanitizePastedTree(root: ParentNode): void {
  const toRemove: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();
  while (current) {
    const el = current as Element;
    if (DISALLOWED_PASTE_TAGS.has(el.tagName)) {
      toRemove.push(el);
      current = walker.nextNode();
      continue;
    }
    for (const attr of el.attributes) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        !isSafePastedUrl(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
    current = walker.nextNode();
  }
  for (const el of toRemove) {
    el.remove();
  }
}

function htmlToSanitizedContainer(html: string): HTMLElement {
  const container = document.createElement("div");
  const sanitizerContainer = container as HTMLDivElement & {
    setHTML?: (input: string, options?: { sanitizer?: unknown }) => void;
  };
  if (typeof sanitizerContainer.setHTML === "function") {
    sanitizerContainer.setHTML(html);
    return container;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizePastedTree(doc.body);
  for (const child of doc.body.childNodes) {
    container.append(child.cloneNode(true));
  }
  return container;
}

function parseSanitizedHtmlContainer(html: string): HTMLElement {
  const container = document.createElement("div");
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizePastedTree(doc.body);
  for (const child of doc.body.childNodes) {
    container.append(child.cloneNode(true));
  }
  return container;
}

export type EditorPasteHandlerOptions = {
  extensions: MarkdownExtension[];
  getImageWebpQuality(): number;
  onImagePaste(blob: Blob): Promise<string | null> | undefined;
  consumePlainTextPastePreference(): boolean;
  replaceBlockSelection(text: string): boolean;
  replaceEmptySelectedLine(text: string): boolean;
  getBlockPasteSelectionOverride(text: string): SelectionOffsets | undefined;
  syncSelectionFromDomMetadata(): boolean;
  replaceSelectionWithTransactions(text: string, selectionOverride?: SelectionOffsets): void;
  replaceSelectionWithModel(text: string): void;
};

export function createEditorPasteHandler(options: EditorPasteHandlerOptions): {
  onPaste(e: ClipboardEvent): Promise<void>;
} {
  async function onPaste(e: ClipboardEvent): Promise<void> {
    e.preventDefault();
    const clipData = e.clipboardData;
    const usePlainTextPaste = options.consumePlainTextPastePreference();
    if (!clipData) return;

    const imageItem = [...clipData.items].find((item) => item.type.startsWith("image/"));
    const onImagePaste = options.onImagePaste;
    if (imageItem && onImagePaste) {
      const file = imageItem.getAsFile();
      if (file) {
        const bitmap = await createImageBitmap(file);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        const blob = await canvas.convertToBlob({
          type: "image/webp",
          quality: options.getImageWebpQuality(),
        });
        bitmap.close();
        const html = await onImagePaste(blob);
        if (html) {
          const div = parseSanitizedHtmlContainer(html);
          const imageMarkdown = domToMarkdown(div, { extensions: options.extensions }) || html;
          if (!options.replaceBlockSelection(imageMarkdown)) {
            if (options.syncSelectionFromDomMetadata()) {
              options.replaceSelectionWithModel(imageMarkdown);
            } else {
              options.replaceSelectionWithTransactions(imageMarkdown);
            }
          }
        }
      }
      return;
    }

    const htmlData = clipData.getData("text/html");
    const plainTextData = clipData.getData("text/plain");
    const pastedText =
      htmlData && !usePlainTextPaste
        ? domToMarkdown(htmlToSanitizedContainer(htmlData), { extensions: options.extensions }) ||
          plainTextData
        : plainTextData;

    if (pastedText) {
      if (!options.replaceBlockSelection(pastedText)) {
        if (options.replaceEmptySelectedLine(pastedText)) {
          return;
        }
        const selectionOverride = options.getBlockPasteSelectionOverride(pastedText);
        if (selectionOverride !== undefined || !options.syncSelectionFromDomMetadata()) {
          options.replaceSelectionWithTransactions(pastedText, selectionOverride);
        } else {
          options.replaceSelectionWithModel(pastedText);
        }
      }
    }
  }

  return { onPaste };
}
