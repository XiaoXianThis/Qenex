import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsDir = join(root, "apps", "jetbrains");
const isWin = process.platform === "win32";
const gradlew = isWin ? "gradlew.bat" : "./gradlew";

execSync(`${gradlew} buildPlugin`, {
  cwd: jetbrainsDir,
  stdio: "inherit",
  shell: true,
});

console.log("");
console.log("JetBrains plugin package complete → apps/jetbrains/build/distributions/");
