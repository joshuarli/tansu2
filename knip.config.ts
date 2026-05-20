import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "web/ts/main.ts",
    "scripts/*.mjs",
    "*.config.{mjs,ts}",
    "packages/md-wysiwyg/src/index.ts",
    "packages/md-wysiwyg/vitest.config.ts",
  ],
  project: [
    "web/ts/**/*.ts",
    "scripts/*.mjs",
    "*.config.{mjs,ts}",
    "packages/md-wysiwyg/src/**/*.ts",
    "packages/md-wysiwyg/tests/**/*.ts",
    "packages/md-wysiwyg/*.config.ts",
  ],
  ignore: ["web/ts/types.generated.ts"],
};

export default config;
