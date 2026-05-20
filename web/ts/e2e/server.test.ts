import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Browser } from "playwright";

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let baseUrl = "";
let vaultOnePath = "";

describe("real server harness", () => {
  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "tansu2-e2e-"));
    const configHome = join(root, "config");
    const vaultOne = join(root, "vault-one");
    const vaultTwo = join(root, "vault-two");
    await mkdir(join(configHome, "tansu"), { recursive: true });
    await mkdir(vaultOne, { recursive: true });
    await mkdir(vaultTwo, { recursive: true });
    vaultOnePath = vaultOne;
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
    const startupRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || url.pathname === "/events") {
        startupRequests.push(`${request.method()} ${url.pathname}${url.search}`);
      }
    });
    const sessionRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "PUT" && url.pathname === "/api/session";
    });
    await page.goto(baseUrl);
    await page.waitForSelector(".main");
    await sessionRequest;
    expect(startupRequests).toEqual([
      "GET /api/bootstrap",
      "GET /events?vault=0",
      "PUT /api/session",
    ]);
    await page.close();
  });

  it("streams vault-scoped note changes over SSE", async () => {
    const page = await browser!.newPage();
    await page.goto(baseUrl);
    const eventPromise = page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const source = new EventSource("/events?vault=0");
        source.addEventListener(
          "open",
          () => {
            void fetch("/api/notes", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Tansu-Vault": "0",
              },
              body: JSON.stringify({ path: "sse.md", content: "# SSE\n\nbody\n", source: null }),
            });
          },
          { once: true },
        );
        source.addEventListener("message", (event) => {
          const payload = JSON.parse((event as MessageEvent<string>).data) as {
            kind: string;
            notes: Array<{ title: string }>;
          };
          if (
            payload.kind === "note_changed" &&
            payload.notes.some((note) => note.title === "SSE")
          ) {
            source.close();
            resolve(payload.kind);
          }
        });
      });
    });
    await expect(eventPromise).resolves.toBe("note_changed");
    await page.close();
  });

  it("reconciles external filesystem edits for the active vault", async () => {
    const page = await browser!.newPage();
    await page.goto(baseUrl);
    const eventPromise = page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const source = new EventSource("/events?vault=0");
        source.addEventListener("message", (event) => {
          const payload = JSON.parse((event as MessageEvent<string>).data) as {
            kind: string;
            notes: Array<{ title: string }>;
          };
          if (
            payload.kind === "vault_changed" &&
            payload.notes.some((note) => note.title === "Outside")
          ) {
            source.close();
            resolve(payload.kind);
          }
        });
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 900));
    await writeFile(join(vaultOnePath, "outside.md"), "# Outside\n\nedit\n", "utf8");
    await expect(eventPromise).resolves.toBe("vault_changed");
    await page.close();
  });

  it("restores revisions and serves vault-scoped image assets", async () => {
    const created = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tansu-Vault": "0",
      },
      body: JSON.stringify({ path: "recover.md", content: "# Recover\n\nold\n", source: null }),
    }).then((response) => response.json());
    await fetch(`${baseUrl}/api/notes/${created.meta.noteId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Tansu-Vault": "0",
      },
      body: JSON.stringify({
        content: "# Recover\n\nnew\n",
        baseSeq: created.meta.seq,
        baseHash: created.meta.contentHash,
        checkpoint: true,
      }),
    });
    const revisions = await fetch(`${baseUrl}/api/notes/${created.meta.noteId}/revisions`, {
      headers: { "X-Tansu-Vault": "0" },
    }).then((response) => response.json());
    const oldest = revisions.at(-1);
    const restored = await fetch(
      `${baseUrl}/api/notes/${created.meta.noteId}/revisions/${oldest.eventId}/restore`,
      {
        method: "POST",
        headers: { "X-Tansu-Vault": "0" },
      },
    ).then((response) => response.json());
    expect(restored.document.content).toContain("old");

    const uploaded = await fetch(`${baseUrl}/api/images`, {
      method: "POST",
      headers: {
        "Content-Type": "image/webp",
        "X-Tansu-Vault": "0",
      },
      body: new Uint8Array([1, 2, 3]),
    }).then((response) => response.json());
    const asset = await fetch(
      `${baseUrl}/api/assets?name=${encodeURIComponent(uploaded.name)}&vault=0`,
    );
    expect(asset.ok).toBe(true);
    expect(await asset.arrayBuffer()).toHaveProperty("byteLength", 3);
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
