import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const distIndex = join(root, "apps", "web", "dist", "index.html");
const manifest = join(root, "crates", "bridge", "Cargo.toml");
const isWin = process.platform === "win32";
const binName = isWin ? "acp-to-agui.exe" : "acp-to-agui";
const releaseBin = join(root, "target", "release", binName);
const configSrc = join(root, "crates", "bridge", "bridge.config.json");

if (!existsSync(distIndex)) {
  console.log("Web dist not found, building web first (required for embed)...");
  execSync("bun scripts/build-web.mjs", { cwd: root, stdio: "inherit" });
}

console.log("Building Rust bridge (release)...");
execSync(
  `cargo build --release --manifest-path "${manifest}" --features server --bin acp-to-agui`,
  { cwd: root, stdio: "inherit" },
);

if (!existsSync(releaseBin)) {
  throw new Error(`Rust build failed: ${releaseBin} not found`);
}

mkdirSync(buildDir, { recursive: true });
copyFileSync(releaseBin, join(buildDir, binName));
copyFileSync(configSrc, join(buildDir, "bridge.config.json"));

if (!isWin) {
  chmodSync(join(buildDir, binName), 0o755);
}

console.log(`Rust binary copied to ${join(buildDir, binName)}`);
