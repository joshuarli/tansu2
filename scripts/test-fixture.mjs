import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = join(REPO_ROOT, "tests", "fixtures", "test-vaults");

export async function createTestFixture(root) {
  const fixtureRoot = resolve(root);
  const configHome = join(fixtureRoot, "config");
  const vaultOne = join(fixtureRoot, "vault-one");
  const vaultTwo = join(fixtureRoot, "vault-two");

  await rm(configHome, { recursive: true, force: true });
  await rm(vaultOne, { recursive: true, force: true });
  await rm(vaultTwo, { recursive: true, force: true });
  await rm(join(fixtureRoot, "vault"), { recursive: true, force: true });

  await mkdir(join(configHome, "tansu"), { recursive: true });
  await cp(join(SOURCE_ROOT, "vault-one"), vaultOne, { recursive: true });
  await cp(join(SOURCE_ROOT, "vault-two"), vaultTwo, { recursive: true });

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

  return { configHome, vaultOne, vaultTwo };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2];
  if (!root) {
    console.error("usage: node scripts/test-fixture.mjs <root>");
    process.exit(2);
  }
  const fixture = await createTestFixture(root);
  console.log(JSON.stringify(fixture));
}
