import type { ProgressEmit, ProgressEvent } from "./types.ts";

export function stage(
  emit: ProgressEmit | undefined,
  stageName: string,
  message: string,
): void {
  emit?.({ type: "stage", stage: stageName, message });
}

/** SSE progress stream used by install/ensure-ready stream endpoints. */
export function sseProgressResponse(
  run: (emit: ProgressEmit) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(chunk));
      };
      const emit: ProgressEmit = (event: ProgressEvent) => {
        send(`event: progress\ndata: ${JSON.stringify(event)}\n\n`);
      };
      const keepalive = setInterval(() => {
        send(`: keepalive ${Date.now()}\n\n`);
      }, 15_000);

      void (async () => {
        try {
          await run(emit);
        } catch (err) {
          emit({
            type: "error",
            detail: err instanceof Error ? err.message : String(err),
          });
        } finally {
          clearInterval(keepalive);
          closed = true;
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      })();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

export function detailError(status: number, detail: string): Response {
  return Response.json({ detail }, { status });
}
