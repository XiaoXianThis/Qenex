import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsDir = join(root, "apps", "jetbrains");
const isWin = process.platform === "win32";
const gradlew = isWin ? "gradlew.bat" : "./gradlew";

const skipBuild = process.argv.includes("--no-build");

if (!skipBuild) {
  execSync("bun scripts/build-jetbrains.mjs", { cwd: root, stdio: "inherit" });
}

console.log("Starting JetBrains sandbox IDE (runIde)...");
execSync(`${gradlew} runIde`, {
  cwd: jetbrainsDir,
  stdio: "inherit",
  shell: true,
});
