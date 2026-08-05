import { existsSync, readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(root, "apps", "desktop");
const tauriDir = join(desktopDir, "src-tauri");
const bridgeEntry = join(root, "apps", "bridge", "src", "index.ts");

const required = [
  join(desktopDir, "bridge.config.json"),
  join(tauriDir, "tauri.conf.json"),
  join(tauriDir, "src", "lib.rs"),
  join(tauriDir, "src", "bridge.rs"),
  join(desktopDir, "src", "host", "tauri-host.ts"),
  bridgeEntry,
];

let failed = false;

for (const file of required) {
  if (existsSync(file)) {
    console.log(`OK  ${file}`);
  } else {
    console.error(`MISSING  ${file}`);
    failed = true;
  }
}

const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
if (bun.status === 0) {
  console.log(`OK  bun ${bun.stdout.trim()}`);
} else {
  console.error("MISSING  bun on PATH");
  failed = true;
}

const tauriConf = readFileSync(join(tauriDir, "tauri.conf.json"), "utf8");
if (tauriConf.includes("externalBin") || tauriConf.includes("acp-to-agui")) {
  console.error(
    "FAIL  tauri.conf.json still references Rust sidecar (externalBin / acp-to-agui)",
  );
  failed = true;
} else {
  console.log("OK  tauri.conf.json has no Rust sidecar externalBin");
}

const bridgeRs = readFileSync(join(tauriDir, "src", "bridge.rs"), "utf8");
if (bridgeRs.includes("acp-to-agui") || bridgeRs.includes("sidecar(")) {
  console.error("FAIL  bridge.rs still spawns Rust acp-to-agui sidecar");
  failed = true;
} else if (!bridgeRs.includes("QENEX_BRIDGE_PORT") || !bridgeRs.includes("bun")) {
  console.error("FAIL  bridge.rs missing Bun Bridge spawn markers");
  failed = true;
} else if (!bridgeRs.includes("using repo Bun Bridge entry")) {
  console.error(
    "FAIL  bridge.rs should prefer repo apps/bridge over packaged target/*/bridge",
  );
  failed = true;
} else {
  console.log("OK  bridge.rs spawns Bun Bridge (repo-first)");
}

const hostTs = readFileSync(
  join(desktopDir, "src", "host", "tauri-host.ts"),
  "utf8",
);
if (!hostTs.includes("cmd_get_bridge_url") || !hostTs.includes("getBridgeBaseUrl")) {
  console.error("FAIL  tauri-host Host.getBridgeBaseUrl contract broken");
  failed = true;
} else {
  console.log("OK  Host.getBridgeBaseUrl → cmd_get_bridge_url");
}

// Frontend dist is optional for pure check; build if missing for packaging smoke.
if (!existsSync(join(desktopDir, "dist", "index.html"))) {
  console.log("Building desktop frontend for verify...");
  execSync("bun run build", { cwd: desktopDir, stdio: "inherit" });
}
if (existsSync(join(desktopDir, "dist", "index.html"))) {
  console.log(`OK  ${join(desktopDir, "dist", "index.html")}`);
} else {
  console.error("MISSING  desktop dist/index.html");
  failed = true;
}

console.log("Type-checking desktop frontend...");
execSync("bunx tsc --noEmit -p tsconfig.app.json", {
  cwd: desktopDir,
  stdio: "inherit",
});

console.log("Checking Tauri Rust crate...");
execSync("cargo check", {
  cwd: tauriDir,
  stdio: "inherit",
});

if (failed) {
  process.exit(1);
}

console.log("");
console.log("verify:desktop passed");
