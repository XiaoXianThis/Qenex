import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CACHE_TTL_SECS,
  loadRegistryDocument,
  waitForRegistryRefresh,
} from "../src/agent/registry.ts";
import type { RegistryDocument } from "../src/agent/types.ts";

const originalFetch = globalThis.fetch;

function cachePath(): string {
  return join(mkdtempSync(join(tmpdir(), "qenex-registry-")), "registry-cache.json");
}

function doc(id: string): RegistryDocument {
  return {
    version: "1",
    agents: [
      {
        id,
        name: id,
        version: "0.0.1",
        description: id,
        distribution: {},
      },
    ],
  };
}

function writeCacheFile(
  path: string,
  document: RegistryDocument,
  fetchedAt: number,
): void {
  writeFileSync(
    path,
    `${JSON.stringify({ fetched_at: fetchedAt, document })}\n`,
    "utf8",
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("loadRegistryDocument stale-while-revalidate", () => {
  test("returns disk cache immediately even when TTL expired", async () => {
    const path = cachePath();
    writeCacheFile(path, doc("cached-agent"), Math.floor(Date.now() / 1000) - CACHE_TTL_SECS - 10);
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return Response.json(doc("fresh-agent"));
    }) as typeof fetch;

    const loaded = await loadRegistryDocument(false, path);
    expect(loaded.agents[0]?.id).toBe("cached-agent");

    await waitForRegistryRefresh(path);
    expect(fetches).toBe(1);
    const refreshed = await loadRegistryDocument(false, path);
    expect(refreshed.agents[0]?.id).toBe("fresh-agent");
  });

  test("fresh cache does not hit the network", async () => {
    const path = cachePath();
    writeCacheFile(path, doc("fresh-cache"), Math.floor(Date.now() / 1000));
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return Response.json(doc("network"));
    }) as typeof fetch;

    const loaded = await loadRegistryDocument(false, path);
    expect(loaded.agents[0]?.id).toBe("fresh-cache");
    await waitForRegistryRefresh(path);
    expect(fetches).toBe(0);
  });

  test("no cache still fetches synchronously", async () => {
    const path = cachePath();
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return Response.json(doc("network-only"));
    }) as typeof fetch;

    const loaded = await loadRegistryDocument(false, path);
    expect(fetches).toBe(1);
    expect(loaded.agents[0]?.id).toBe("network-only");
  });

  test("refresh=true forces a network fetch", async () => {
    const path = cachePath();
    writeCacheFile(path, doc("stale"), Math.floor(Date.now() / 1000));
    globalThis.fetch = (async () => Response.json(doc("forced"))) as typeof fetch;
    const loaded = await loadRegistryDocument(true, path);
    expect(loaded.agents[0]?.id).toBe("forced");
  });
});
