import { afterEach, describe, expect, it, vi } from "vitest";

describe("dev log client", () => {
  const originalMode = process.env["TANSU2_LOGS"];

  afterEach(() => {
    process.env["TANSU2_LOGS"] = originalMode;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does nothing when logging is off", async () => {
    process.env["TANSU2_LOGS"] = "off";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { logClientEvent, flushLogs } = await import("./dev-log.ts");

    logClientEvent("info", "system.event", { system: { component: "test", action: "skip" } });
    flushLogs(false);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("batches enabled client events", async () => {
    vi.useFakeTimers();
    process.env["TANSU2_LOGS"] = "buffer";
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const { logClientEvent } = await import("./dev-log.ts");

    logClientEvent("info", "system.event", { system: { component: "test", action: "run" } });
    vi.runOnlyPendingTimers();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      events: [
        {
          source: "client",
          level: "info",
          kind: "system.event",
          system: { component: "test", action: "run" },
        },
      ],
    });
  });

  it("disables sending after a transport failure", async () => {
    process.env["TANSU2_LOGS"] = "buffer";
    const fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetch);
    const { logClientEvent, flushLogs } = await import("./dev-log.ts");

    logClientEvent("warn", "system.event");
    flushLogs(false);
    await Promise.resolve();
    logClientEvent("warn", "system.event");
    flushLogs(false);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
