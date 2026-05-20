import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: ["web/ts/types.generated.ts"],
  sortImports: true,
});
