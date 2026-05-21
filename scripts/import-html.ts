#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { Defuddle } from "defuddle/node";

import { importHtml, type HtmlImportParseResult } from "../web/ts/html-importer.ts";

const { filePath, url } = parseArgs(process.argv.slice(2));
const html = await readFile(expandHome(filePath), "utf8");
const imported = await importHtml({
  html,
  fallbackTitle: basename(filePath),
  parse: (input) => parseHtmlWithDefuddle(input, url),
});

if (imported === null) {
  fail("HTML import failed: no markdown content was extracted.\n");
}

process.stdout.write(imported.content);

function parseArgs(args: string[]): { filePath: string; url?: string } {
  let filePath: string | undefined;
  let url: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--url") {
      url = args[i + 1];
      if (url === undefined || url.startsWith("-")) {
        usage();
      }
      i += 1;
    } else if (arg === "-h" || arg === "--help") {
      usage(0);
    } else if (arg?.startsWith("-")) {
      usage();
    } else if (filePath === undefined) {
      filePath = arg;
    } else {
      usage();
    }
  }
  if (filePath === undefined) {
    usage();
  }
  return url === undefined ? { filePath } : { filePath, url };
}

function usage(exitCode = 2): never {
  fail("Usage: node scripts/import-html.ts <file.html> [--url <page-url>]\n", exitCode);
}

function fail(message: string, exitCode = 1): never {
  process.stderr.write(message);
  process.exit(exitCode);
}

function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

async function parseHtmlWithDefuddle(
  html: string,
  url: string | undefined,
): Promise<HtmlImportParseResult> {
  return Defuddle(html, url, { separateMarkdown: true });
}
