import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Browser } from "playwright";

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let baseUrl = "";

describe("real server harness", () => {
  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "tansu2-e2e-"));
    const configHome = join(root, "config");
    const vaultOne = join(root, "vault-one");
    const vaultTwo = join(root, "vault-two");
    await mkdir(join(configHome, "tansu"), { recursive: true });
    await mkdir(vaultOne, { recursive: true });
    await mkdir(vaultTwo, { recursive: true });
    await writeFile(join(vaultOne, "one.md"), "# One\n\nalpha", "utf8");
    await writeFile(join(vaultTwo, "two.md"), "# Two\n\nbeta", "utf8");
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
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn("cargo", ["run", "--quiet", "--bin", "tansu2", "--", "--port", String(port)], {
      cwd: process.cwd(),
      env: { ...process.env, XDG_CONFIG_HOME: configHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForReady(`${baseUrl}/api/health`);
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  it("starts with two seeded vaults and loads the static app", async () => {
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { "X-Tansu-Vault": "1" },
    }).then((response) => response.json());
    expect(bootstrap.vaults).toHaveLength(2);
    expect(bootstrap.activeVault).toBe(1);
    expect(bootstrap.notes[0].title).toBe("Two");

    const page = await browser!.newPage();
    await page.goto(baseUrl);
    await page.waitForSelector(".app-shell");
    await page.close();
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => {
        if (address !== null && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("no free port"));
        }
      });
    });
  });
}

async function waitForReady(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready: ${url}`);
}
