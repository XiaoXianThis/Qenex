import { startBridgeServer } from "./server.ts";

const port = Number(process.env.QENEX_BRIDGE_PORT ?? process.env.PORT ?? 8000);
const hostname = process.env.QENEX_BRIDGE_HOST ?? "127.0.0.1";

const server = startBridgeServer({ hostname, port });

console.log(
  `[qenex-bridge] listening on http://${server.hostname}:${server.port} (OpenCode ACP)`,
);

function shutdown(signal: string) {
  console.log(`[qenex-bridge] ${signal}, shutting down…`);
  server.stop();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
