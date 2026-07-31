import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uiSrc = resolve(fileURLToPath(new URL(".", import.meta.url)), "../src");

const FORBIDDEN = [
  /from\s+["']@tauri-apps\//,
  /from\s+["']tauri/,
  /from\s+["']vscode/,
  /require\(\s*["']vscode["']\s*\)/,
  /from\s+["']@jetbrains\//,
  /acquireVsCodeApi/,
  /__TAURI__/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|css)$/.test(name) && !name.includes(".test."))
      out.push(p);
  }
  return out;
}

describe("@qenex/ui platform purity", () => {
  test("UI sources do not import desktop/IDE APIs", () => {
    const files = walk(uiSrc);
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(text)) hits.push(`${file} matches ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
