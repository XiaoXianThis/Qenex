import { startBridgeServer } from "./server.ts";
import { resolveSessionsDbPath } from "./session-db.ts";

const port = Number(process.env.QENEX_BRIDGE_PORT ?? process.env.PORT ?? 8000);
const hostname = process.env.QENEX_BRIDGE_HOST ?? "127.0.0.1";
const dbPath = resolveSessionsDbPath();

const server = startBridgeServer({ hostname, port, dbPath });

console.log(
  `[qenex-bridge] listening on http://${server.hostname}:${server.port} (OpenCode ACP)`,
);
console.log(`[qenex-bridge] sessions db: ${dbPath}`);

function shutdown(signal: string) {
  console.log(`[qenex-bridge] ${signal}, shutting down…`);
  server.stop();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
