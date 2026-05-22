import { sourceBoundary } from "./editor-dom.js";

const IMAGE_RESIZE_EDGE_PX = 14;
const IMAGE_RESIZE_MIN_WIDTH = 48;
const IMAGE_RESIZE_MAX_WIDTH = 2400;

type ImageResizeDrag = {
  image: HTMLImageElement;
  startX: number;
  startWidth: number;
  changed: boolean;
};

export type WikiImageResizeControllerOptions = {
  isSourceMode(): boolean;
  checkpoint(): void;
  replaceMarkdownRange(start: number, end: number, text: string): void;
  onChange(): void;
};

function isWikiImage(el: EventTarget | null): el is HTMLImageElement {
  return el instanceof HTMLImageElement && el.dataset["wikiImage"] !== undefined;
}

function imageWidth(image: HTMLImageElement): number {
  const rectWidth = Math.round(image.getBoundingClientRect().width);
  const attrWidth = Number(image.getAttribute("width"));
  const naturalWidth = image.naturalWidth;
  const width = rectWidth || attrWidth || naturalWidth || 320;
  return Math.min(IMAGE_RESIZE_MAX_WIDTH, Math.max(IMAGE_RESIZE_MIN_WIDTH, width));
}

function isImageResizePointer(e: PointerEvent, image: HTMLImageElement): boolean {
  const rect = image.getBoundingClientRect();
  return (
    rect.width > 0 &&
    e.clientX >= rect.left &&
    e.clientX <= rect.right &&
    rect.right - e.clientX <= IMAGE_RESIZE_EDGE_PX
  );
}

export function createWikiImageResizeController(
  options: WikiImageResizeControllerOptions,
): {
  onImagePointerDown(e: PointerEvent): void;
  onDocumentPointerMove(e: PointerEvent): void;
  endImageResize(): void;
} {
  let imageResizeDrag: ImageResizeDrag | null = null;

  function onImagePointerDown(e: PointerEvent): void {
    if (options.isSourceMode() || !isWikiImage(e.target) || !isImageResizePointer(e, e.target)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    options.checkpoint();
    e.target.classList.add("md-image-resizing");
    imageResizeDrag = {
      image: e.target,
      startX: e.clientX,
      startWidth: imageWidth(e.target),
      changed: false,
    };
  }

  function onDocumentPointerMove(e: PointerEvent): void {
    if (!imageResizeDrag) return;
    e.preventDefault();
    const nextWidth = Math.round(
      Math.min(
        IMAGE_RESIZE_MAX_WIDTH,
        Math.max(
          IMAGE_RESIZE_MIN_WIDTH,
          imageResizeDrag.startWidth + e.clientX - imageResizeDrag.startX,
        ),
      ),
    );
    imageResizeDrag.image.setAttribute("width", String(nextWidth));
    imageResizeDrag.image.style.width = `${nextWidth}px`;
    imageResizeDrag.changed ||= nextWidth !== imageResizeDrag.startWidth;
  }

  function endImageResize(): void {
    if (!imageResizeDrag) return;
    const drag = imageResizeDrag;
    imageResizeDrag = null;
    drag.image.classList.remove("md-image-resizing");
    if (!drag.changed) return;
    const sourceElement = drag.image.closest("[data-md-source-start]");
    const sourceStart =
      sourceElement instanceof HTMLElement ? sourceBoundary(sourceElement, "mdSourceStart") : null;
    const sourceEnd =
      sourceElement instanceof HTMLElement ? sourceBoundary(sourceElement, "mdSourceEnd") : null;
    if (sourceStart === null || sourceEnd === null || !drag.image.dataset["wikiImage"]) {
      return;
    }
    options.replaceMarkdownRange(
      sourceStart,
      sourceEnd,
      `![[${drag.image.dataset["wikiImage"]}|${drag.image.getAttribute("width") ?? imageWidth(drag.image)}]]`,
    );
    options.checkpoint();
    options.onChange();
  }

  return {
    onImagePointerDown,
    onDocumentPointerMove,
    endImageResize,
  };
}
