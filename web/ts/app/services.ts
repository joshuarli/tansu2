import * as apiModule from "../api.ts";
import type { ApiClient } from "../api.ts";
import { createEditor, type EditorConfig, type EditorHandle } from "../editor/index.js";
import { pickHtmlImport } from "../html-import.ts";
import { cacheNoteBody, deleteCachedNoteBodies, getCachedNoteBody } from "../note-cache.ts";
import { markNextPaint, markPerformance } from "../performance.ts";

export type AppServices = {
  api: ApiClient;
  editor: {
    createEditor: (container: HTMLElement, config?: EditorConfig) => EditorHandle;
  };
  htmlImport: {
    pickHtmlImport: typeof pickHtmlImport;
  };
  noteCache: {
    cacheNoteBody: typeof cacheNoteBody;
    deleteCachedNoteBodies: typeof deleteCachedNoteBodies;
    getCachedNoteBody: typeof getCachedNoteBody;
  };
  performance: {
    markNextPaint: typeof markNextPaint;
    markPerformance: typeof markPerformance;
  };
};

export const defaultServices: AppServices = {
  api: (apiModule.apiClient ?? apiModule) as ApiClient,
  editor: {
    createEditor,
  },
  htmlImport: {
    pickHtmlImport,
  },
  noteCache: {
    cacheNoteBody,
    deleteCachedNoteBodies,
    getCachedNoteBody,
  },
  performance: {
    markNextPaint,
    markPerformance,
  },
};
