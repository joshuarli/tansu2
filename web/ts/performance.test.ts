import { markNextPaint, markPerformance } from "./performance.ts";

describe("performance marks", () => {
  const originalNodeEnv = process.env["NODE_ENV"];

  afterEach(() => {
    vi.useRealTimers();
    process.env["NODE_ENV"] = originalNodeEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls back cleanly when performance.mark is unavailable", () => {
    process.env["NODE_ENV"] = "development";
    vi.spyOn(performance, "mark").mockImplementation(() => {
      throw new Error("unavailable");
    });

    expect(() => markPerformance("tansu:test")).not.toThrow();
  });

  it("does not mark in production", () => {
    process.env["NODE_ENV"] = "production";
    const mark = vi.spyOn(performance, "mark");

    markPerformance("tansu:test");

    expect(mark).not.toHaveBeenCalled();
  });

  it("uses a timer fallback for next-paint marks without requestAnimationFrame", () => {
    vi.useFakeTimers();
    process.env["NODE_ENV"] = "development";
    const mark = vi.spyOn(performance, "mark");
    vi.stubGlobal("requestAnimationFrame", undefined);

    markNextPaint("tansu:test");
    vi.runOnlyPendingTimers();

    expect(mark).toHaveBeenCalledWith("tansu:test");
    vi.useRealTimers();
  });
});
