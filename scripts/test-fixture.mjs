import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const SOURCE_ROOT = join(REPO_ROOT, "tests", "fixtures", "test-vaults");

export async function createTestFixture(root, opts = {}) {
  const fixtureRoot = resolve(root);
  const configHome = join(fixtureRoot, "config");
  const dataHome = join(fixtureRoot, "data");
  const copyVaults = opts.copyVaults ?? false;
  const generatedVaultOne = join(fixtureRoot, "vault-one");
  const generatedVaultTwo = join(fixtureRoot, "vault-two");
  const vaultOne = copyVaults ? generatedVaultOne : join(SOURCE_ROOT, "vault-one");
  const vaultTwo = copyVaults ? generatedVaultTwo : join(SOURCE_ROOT, "vault-two");

  await rm(configHome, { recursive: true, force: true });
  await rm(dataHome, { recursive: true, force: true });
  await rm(generatedVaultOne, { recursive: true, force: true });
  await rm(generatedVaultTwo, { recursive: true, force: true });
  await rm(join(fixtureRoot, "vault"), { recursive: true, force: true });

  await mkdir(join(configHome, "tansu"), { recursive: true });
  await mkdir(dataHome, { recursive: true });
  if (copyVaults) {
    await cp(join(SOURCE_ROOT, "vault-one"), vaultOne, { recursive: true });
    await cp(join(SOURCE_ROOT, "vault-two"), vaultTwo, { recursive: true });
  }

  await writeFile(
    join(configHome, "tansu", "config.toml"),
    `[[vaults]]
name = "One"
path = "${vaultOne}"

[[vaults]]
name = "Two"
path = "${vaultTwo}"
`,
    "utf8",
  );

  return { configHome, dataHome, vaultOne, vaultTwo };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2];
  if (!root) {
    console.error("usage: node scripts/test-fixture.mjs <root> [--copy-vaults]");
    process.exit(2);
  }
  const fixture = await createTestFixture(root, {
    copyVaults: process.argv.includes("--copy-vaults"),
  });
  console.log(JSON.stringify(fixture));
}
