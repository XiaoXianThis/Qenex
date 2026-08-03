/**
 * M0 guard: default `dev` must start Bun Bridge, not cargo / Rust Bridge.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);

describe("M0 · default dev path", () => {
  test("scripts/dev.mjs starts @qenex/bridge, not cargo", () => {
    const src = readFileSync(resolve(repoRoot, "scripts/dev.mjs"), "utf8");
    expect(src).toContain("@qenex/bridge");
    expect(src).toContain("start");
    expect(src).not.toMatch(/spawn\(\s*["']cargo["']/);
    expect(src).not.toContain("crates/bridge/Cargo.toml");
  });

  test("root package.json exposes Bun bridge scripts and no Rust Bridge", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
      workspaces: string[];
    };
    expect(pkg.scripts["dev:bridge"]).toContain("@qenex/bridge");
    expect(pkg.scripts["test:bridge"]).toContain("@qenex/bridge");
    expect(pkg.scripts["test:m0"]).toBeTruthy();
    expect(pkg.scripts["dev:rust"]).toBeUndefined();
    expect(pkg.scripts["build:rust"]).toBeUndefined();
    expect(pkg.workspaces).toContain("scratch/*");
  });

  test("legacy Rust Bridge entry points are gone (M8)", () => {
    expect(existsSync(resolve(repoRoot, "scripts/dev-rust.mjs"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "scripts/build-rust.mjs"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "crates/bridge"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "Cargo.toml"))).toBe(false);
  });
});
