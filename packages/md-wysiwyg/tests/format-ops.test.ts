import {
  clearInlineFormats,
  shiftIndent,
  toggleBold,
  toggleCodeFence,
  toggleHeading,
  toggleHighlight,
  toggleItalic,
  toggleStrikethrough,
} from "../src/format-ops.ts";

describe("format operations", () => {
  it("wraps and unwraps single selections", () => {
    expect(toggleBold("hello", 0, 5)).toEqual({ md: "**hello**", selStart: 2, selEnd: 7 });
    expect(toggleBold("**hello**", 2, 7)).toEqual({ md: "hello", selStart: 0, selEnd: 5 });
    expect(toggleStrikethrough("hello", 0, 5).md).toBe("~~hello~~");
    expect(toggleHighlight("hello", 0, 5).md).toBe("==hello==");
  });

  it("handles italic without treating bold markers as italic wrappers", () => {
    expect(toggleItalic("hello", 0, 5)).toEqual({ md: "*hello*", selStart: 1, selEnd: 6 });
    expect(toggleItalic("*hello*", 1, 6)).toEqual({ md: "hello", selStart: 0, selEnd: 5 });
    expect(toggleItalic("**hello**", 2, 7)).toEqual({
      md: "***hello***",
      selStart: 3,
      selEnd: 8,
    });
  });

  it("toggles markers across non-empty selected blocks", () => {
    expect(toggleBold("one\n\n\n\ntwo", 0, 10)).toEqual({
      md: "**one**\n\n\n\n**two**",
      selStart: 0,
      selEnd: 18,
    });
    expect(toggleBold("**one**\n\n**two**", 0, 16)).toEqual({
      md: "one\n\ntwo",
      selStart: 0,
      selEnd: 8,
    });
    expect(toggleItalic("*one*\n\n**two**", 0, 14).md).toBe("**one**\n\n***two***");
  });

  it("removes inline formatting markers from a selection", () => {
    expect(clearInlineFormats("a **b** ~~c~~ ==d== `e` _f_", 2, 29)).toEqual({
      md: "a b c d e f",
      selStart: 2,
      selEnd: 11,
    });
  });

  it("toggles heading levels at the current line", () => {
    expect(toggleHeading("one\ntwo", 4, 2)).toEqual({
      md: "one\n## two",
      selStart: 7,
      selEnd: 7,
    });
    expect(toggleHeading("one\n## two", 7, 2)).toEqual({
      md: "one\ntwo",
      selStart: 4,
      selEnd: 4,
    });
    expect(toggleHeading("### old", 4, 1)).toEqual({
      md: "# old",
      selStart: 2,
      selEnd: 2,
    });
  });

  it("wraps and unwraps code fences around selected lines", () => {
    expect(toggleCodeFence("one\ntwo", 1, 6)).toEqual({
      md: "```\none\ntwo\n```",
      selStart: 5,
      selEnd: 10,
    });
    expect(toggleCodeFence("```\none\ntwo\n```", 4, 11)).toEqual({
      md: "one\ntwo",
      selStart: 0,
      selEnd: 7,
    });
  });

  it("indents and dedents selected lines while preserving selection bounds", () => {
    expect(shiftIndent("one\ntwo", 1, 6, false)).toEqual({
      md: "\tone\n\ttwo",
      selStart: 2,
      selEnd: 8,
    });
    expect(shiftIndent("\tone\n  two\n    three\nfour", 1, 13, true)).toEqual({
      md: "one\ntwo\n  three\nfour",
      selStart: 0,
      selEnd: 8,
    });
    expect(shiftIndent("one", 0, 3, true)).toEqual({ md: "one", selStart: 0, selEnd: 3 });
  });
});
