import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const children = [];

function run(label, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      shutdown(signal);
      return;
    }
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
      shutdown(code);
    }
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(typeof code === "number" ? code : 0);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("Starting backend (http://localhost:8000) and frontend (http://localhost:3000)...");
run("backend", "cargo", [
  "run",
  "--manifest-path",
  "crates/bridge/Cargo.toml",
  "--features",
  "server",
  "--bin",
  "acp-to-agui",
  "--",
  "--config",
  "crates/bridge/bridge.config.json",
]);
run("frontend", "bun", ["run", "--filter", "@qenex/web", "dev"]);
