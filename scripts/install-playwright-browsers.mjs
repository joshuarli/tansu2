import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const config = packageJson.playwrightBrowsers;

if (!config) {
  throw new Error("package.json is missing playwrightBrowsers");
}

const expectedPlaywrightVersion = config.playwrightVersion;
const actualPlaywrightVersion = packageJson.devDependencies?.playwright;

if (actualPlaywrightVersion !== expectedPlaywrightVersion) {
  throw new Error(
    `playwright devDependency is ${actualPlaywrightVersion}, expected ${expectedPlaywrightVersion}`,
  );
}

const require = createRequire(import.meta.url);
const playwrightRequire = createRequire(require.resolve("playwright/package.json"));
const corePackagePath = playwrightRequire.resolve("playwright-core/package.json");
const corePackage = JSON.parse(readFileSync(corePackagePath, "utf8"));

if (corePackage.version !== expectedPlaywrightVersion) {
  throw new Error(
    `playwright-core is ${corePackage.version}, expected ${expectedPlaywrightVersion}`,
  );
}

const browsersPath = join(dirname(corePackagePath), "browsers.json");
const browserMetadata = JSON.parse(readFileSync(browsersPath, "utf8"));
const browserByName = new Map(browserMetadata.browsers.map((browser) => [browser.name, browser]));

for (const name of config.install) {
  const expected = config.browsers?.[name];
  const actual = browserByName.get(name);

  if (!expected) {
    throw new Error(`playwrightBrowsers.browsers is missing ${name}`);
  }

  if (!actual) {
    throw new Error(`playwright-core metadata is missing ${name}`);
  }

  if (actual.browserVersion !== expected.version || actual.revision !== expected.revision) {
    throw new Error(
      `${name} is ${actual.browserVersion} revision ${actual.revision}, expected ${expected.version} revision ${expected.revision}`,
    );
  }
}

const passthroughArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const install = spawnSync(
  "pnpm",
  ["exec", "playwright", "install", ...passthroughArgs, "--with-deps", ...config.install],
  { stdio: "inherit" },
);

if (install.error) {
  throw install.error;
}

process.exit(install.status ?? 1);
