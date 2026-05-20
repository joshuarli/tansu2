import type { ApiErrorResponse } from "./types.generated.ts";

describe("generated API error types", () => {
  it("uses the Rust-generated discriminant", () => {
    const response: ApiErrorResponse = {
      error: { code: "path_collision", path: "A.md" },
    };
    expect(response.error.code).toBe("path_collision");
  });
});
