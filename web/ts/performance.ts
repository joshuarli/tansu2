export function markPerformance(name: string): void {
  if (!isDevelopment()) {
    return;
  }
  try {
    globalThis.performance?.mark(name);
  } catch {
    return;
  }
}

export function markNextPaint(name: string): void {
  if (!isDevelopment()) {
    return;
  }
  const requestFrame = globalThis.requestAnimationFrame;
  if (requestFrame === undefined) {
    globalThis.setTimeout(() => markPerformance(name), 0);
    return;
  }
  requestFrame(() => markPerformance(name));
}

function isDevelopment(): boolean {
  return typeof process === "undefined" || process.env["NODE_ENV"] !== "production";
}
