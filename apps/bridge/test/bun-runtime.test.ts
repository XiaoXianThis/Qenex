import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUN_PIN_FALLBACK,
  bunAssetName,
  bunDownloadUrl,
  bunExecutableName,
  managedBunBin,
  readPinnedBunVersion,
} from "../../../scripts/lib/ensure-bun.mjs";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

describe("managed Bun pin", () => {
  test("runtime/bun-version matches fallback constant", () => {
    const pin = readFileSync(resolve(repoRoot, "runtime/bun-version"), "utf8").trim();
    expect(pin).toBe(BUN_PIN_FALLBACK);
    expect(readPinnedBunVersion(repoRoot)).toBe(pin);
  });

  test("official zip URLs for supported platforms", () => {
    expect(bunAssetName("darwin", "arm64")).toBe("bun-darwin-aarch64");
    expect(bunAssetName("linux", "x64")).toBe("bun-linux-x64");
    expect(bunAssetName("win32", "x64")).toBe("bun-windows-x64");
    expect(bunDownloadUrl("1.3.14", "darwin", "arm64")).toBe(
      "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-aarch64.zip",
    );
    expect(bunExecutableName("win32")).toBe("bun.exe");
    expect(managedBunBin("/tmp/home", "linux")).toBe(
      "/tmp/home/.qenex/runtime/bun/bin/bun",
    );
  });
});
