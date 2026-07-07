import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "apps", "web", "dist");
const buildWebDir = join(root, "build", "web");

console.log("Building web frontend...");
execSync("bun run --filter @qenex/web build", { cwd: root, stdio: "inherit" });

if (!existsSync(join(distDir, "index.html"))) {
  throw new Error("Web build failed: apps/web/dist/index.html not found");
}

rmSync(buildWebDir, { recursive: true, force: true });
mkdirSync(buildWebDir, { recursive: true });
cpSync(distDir, buildWebDir, { recursive: true });

console.log(`Web build copied to ${buildWebDir}`);
