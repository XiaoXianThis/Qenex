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

// M0/M8: default stack is Bun Bridge (AI SDK / UIMessage).
console.log(
  "Starting Bun Bridge (http://127.0.0.1:8000) and Web (http://localhost:3000)...",
);
run("bridge", "bun", ["run", "--filter", "@qenex/bridge", "start"]);
run("frontend", "bun", ["run", "--filter", "@qenex/web", "dev"]);
