import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkspaceFiles, resolveSafePath } from "../src/files.ts";
import { BridgeError } from "../src/errors.ts";

describe("M3 · workspace files", () => {
  const workspace = mkdtempSync(join(tmpdir(), "qenex-files-"));
  mkdirSync(join(workspace, "src"));
  writeFileSync(join(workspace, "README.md"), "# hi\n");
  writeFileSync(join(workspace, "src", "main.ts"), "console.log(1)\n");

  test("lists files and directories under base", () => {
    const result = listWorkspaceFiles({ base: workspace, path: "." });
    expect(result.path).toBe(".");
    const names = result.items.map((i) => i.name).sort();
    expect(names).toContain("README.md");
    expect(names).toContain("src");
    expect(result.items.find((i) => i.name === "src")?.isDirectory).toBe(true);
    expect(result.items.find((i) => i.name === "README.md")?.isDirectory).toBe(
      false,
    );
  });

  test("lists nested directory", () => {
    const result = listWorkspaceFiles({ base: workspace, path: "src" });
    expect(result.items.some((i) => i.name === "main.ts")).toBe(true);
    expect(result.items[0]?.path.includes("src")).toBe(true);
  });

  test("rejects path escape", () => {
    expect(() => resolveSafePath(workspace, "../")).toThrow(BridgeError);
    expect(() =>
      listWorkspaceFiles({ base: workspace, path: "../" }),
    ).toThrow(BridgeError);
  });

  test("rejects missing base", () => {
    expect(() =>
      listWorkspaceFiles({ base: join(workspace, "nope-missing"), path: "." }),
    ).toThrow(BridgeError);
  });

  test("skips node_modules, .git, dist, .next, .turbo, and .DS_Store", () => {
    const root = mkdtempSync(join(tmpdir(), "qenex-files-skip-"));
    mkdirSync(join(root, "node_modules"));
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "dist"));
    mkdirSync(join(root, ".next"));
    mkdirSync(join(root, ".turbo"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, ".DS_Store"), "");
    writeFileSync(join(root, "README.md"), "hi\n");
    const names = listWorkspaceFiles({ base: root, path: "." }).items.map(
      (i) => i.name,
    );
    expect(names).toEqual(["src", "README.md"]);
  });

  test("caps a single directory at 200 entries", () => {
    const root = mkdtempSync(join(tmpdir(), "qenex-files-cap-"));
    mkdirSync(join(root, "dir"));
    for (let i = 0; i < 210; i++) {
      writeFileSync(join(root, `f${String(i).padStart(3, "0")}.txt`), "x");
    }
    const result = listWorkspaceFiles({ base: root, path: "." });
    expect(result.items).toHaveLength(200);
    expect(result.items[0]?.isDirectory).toBe(true);
  });
});
