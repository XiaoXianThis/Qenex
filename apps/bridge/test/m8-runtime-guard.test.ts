/**
 * M8 guards: Rust Bridge / AG-UI / checkpoint remnants removed.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("M8 · no Rust Bridge / AG-UI runtime", () => {
  test("crates/bridge, root Cargo, acp-to-agui tree deleted", () => {
    expect(existsSync(resolve(repoRoot, "crates/bridge"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "Cargo.toml"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "Cargo.lock"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "acp-to-agui"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "scripts/dev-rust.mjs"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "scripts/build-rust.mjs"))).toBe(false);
  });

  test("root scripts no longer start or build Rust Bridge", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["dev:rust"]).toBeUndefined();
    expect(pkg.scripts["build:rust"]).toBeUndefined();
    expect(pkg.scripts.build).toContain("build-all.mjs");
    expect(pkg.scripts.start).toContain("start-build.mjs");

    const buildAll = read("scripts/build-all.mjs");
    expect(buildAll).not.toContain("build-rust");
    expect(buildAll).not.toContain("acp-to-agui");
    expect(buildAll).toContain("Bun Bridge");

    const start = read("scripts/start-build.mjs");
    expect(start).not.toContain("acp-to-agui");
    expect(start).toContain("bridge");
  });

  test("fusion packages have no AG-UI runtime deps", () => {
    for (const rel of [
      "packages/core/package.json",
      "packages/ui/package.json",
      "apps/web/package.json",
      "apps/desktop/package.json",
    ]) {
      const pkg = read(rel);
      expect(pkg).not.toContain("@ag-ui/client");
      expect(pkg).not.toContain("@assistant-ui/react-ag-ui");
    }
  });

  test("CI / release no longer build crates/bridge", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).not.toContain("crates/bridge");
    expect(ci).not.toContain("acp-to-agui");
    expect(ci).toContain("apps/desktop/src-tauri");

    const release = read(".github/workflows/release.yml");
    expect(release).not.toContain("crates/bridge");
  });

  test("IDE build scripts no longer call build-rust", () => {
    for (const rel of [
      "scripts/build-vscode.mjs",
      "scripts/build-jetbrains.mjs",
      "scripts/verify-vscode.mjs",
      "scripts/verify-jetbrains.mjs",
    ]) {
      const src = read(rel);
      expect(src).not.toContain("build-rust");
      expect(src).not.toMatch(/cargo build/);
    }
  });
});

describe("M8 · docs & version", () => {
  test("CHANGELOG has v0.3.0 breaking + data wipe", () => {
    const log = read("CHANGELOG.md");
    expect(log).toMatch(/v0\.3\.0/);
    expect(log.toLowerCase()).toMatch(/breaking/);
    expect(log).toMatch(/sessions\.db|tasks\.db|清空|不迁移/);
  });

  test("README points at Bun Bridge v0.3", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/v0\.3\.0/);
    expect(readme).toContain("apps/bridge");
    expect(readme).not.toContain("bun run dev:rust");
    expect(readme).not.toContain("crates/bridge");
  });
});
