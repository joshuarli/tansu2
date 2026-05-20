import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: ["DESIGN.md", "web/ts/types.generated.ts"],
  sortImports: true,
});
