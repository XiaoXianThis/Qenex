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
});
