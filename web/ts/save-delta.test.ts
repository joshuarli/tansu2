import { buildSaveNoteDeltaRequest, canonicalContentHash, computeTextEdits } from "./save-delta.ts";

describe("save delta", () => {
  it("computes a single exact replacement edit", () => {
    expect(computeTextEdits("# One\n\nbody\n", "# One\n\nchanged\n")).toEqual([
      {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 4 },
        text: "changed",
      },
    ]);
  });

  it("handles insertions, deletions, and trailing newlines", () => {
    expect(computeTextEdits("a\nb\n", "a\nb\nc\n")).toEqual([
      {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 0 },
        text: "c\n",
      },
    ]);
    expect(computeTextEdits("a\nb\nc\n", "a\nc\n")).toEqual([
      {
        start: { line: 1, character: 0 },
        end: { line: 2, character: 0 },
        text: "",
      },
    ]);
  });

  it("does not split UTF-16 surrogate pairs", () => {
    expect(computeTextEdits("emoji 😀\n", "emoji 😁\n")).toEqual([
      {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 8 },
        text: "😁",
      },
    ]);
  });

  it("normalizes CRLF and computes canonical hashes", async () => {
    await expect(canonicalContentHash("# A\n")).resolves.toBe(
      "sha256:ec054cdfbe2628ecb67e5d3e6e2dc4b72d60b3b041eb05d67c44c8333bf21481",
    );
    await expect(
      buildSaveNoteDeltaRequest("# A\r\n", "# B\n", 3, "sha256:base", false),
    ).resolves.toMatchObject({
      baseSeq: 3,
      baseHash: "sha256:base",
      checkpoint: false,
      edits: [{ start: { line: 0, character: 2 }, end: { line: 0, character: 3 }, text: "B" }],
    });
  });
});
