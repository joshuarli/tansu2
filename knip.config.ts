import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "web/ts/main.ts",
    "web/ts/editor/index.ts",
    "bench/*.mjs",
    "scripts/*.mjs",
    "*.config.{mjs,ts}",
  ],
  project: ["web/ts/**/*.ts", "bench/*.mjs", "scripts/*.mjs", "*.config.{mjs,ts}"],
  ignore: ["web/ts/types.generated.ts"],
  ignoreDependencies: ["@typescript/native-preview"],
};

export default config;
