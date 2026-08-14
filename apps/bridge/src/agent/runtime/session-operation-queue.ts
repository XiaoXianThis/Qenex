import { BridgeError } from "../../errors.ts";

/**
 * Per-session mutex for Agent state changes.
 *
 * In the queue: chat stream, setMode/setModel/setConfigOption, model-config
 * reads (including probe), GET config that fills catalogs.
 *
 * Never enqueue: pending-approval reads, approval respond (chat holds the
 * mutex while waiting on permission), stop/cancel (must interrupt),
 * read-only history/metadata.
 */
export type SessionOpKind =
  | "chat"
  | "set-mode"
  | "set-model"
  | "set-config-option"
  | "get-config"
  | "probe-model-config";

export type SessionOpLease = {
  kind: SessionOpKind;
  signal: AbortSignal;
  release: () => void;
};

type CurrentOp = {
  kind: SessionOpKind;
  abort: AbortController;
};

export function sessionOpAbortedError(): BridgeError {
  return new BridgeError(
    "request_aborted",
    "Session operation was cancelled",
    499,
  );
}

/** Reject `promise` as soon as `signal` aborts, without enqueueing. */
export function rejectWhenAborted<T>(
  signal: AbortSignal,
  promise: Promise<T>,
): Promise<T> {
  if (signal.aborted) return Promise.reject(sessionOpAbortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(sessionOpAbortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export class SessionOperationQueue {
  #tail = new Map<string, Promise<void>>();
  #current = new Map<string, CurrentOp>();

  async acquire(
    sessionId: string,
    kind: SessionOpKind,
  ): Promise<SessionOpLease> {
    const prev = this.#tail.get(sessionId) ?? Promise.resolve();
    let releaseHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    this.#tail.set(
      sessionId,
      prev.then(
        () => held,
        () => held,
      ),
    );

    try {
      await prev;
    } catch {
      /* a failed predecessor must not stall the session */
    }

    const abort = new AbortController();
    this.#current.set(sessionId, { kind, abort });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const current = this.#current.get(sessionId);
      if (current?.abort === abort) this.#current.delete(sessionId);
      releaseHeld();
    };
    return { kind, signal: abort.signal, release };
  }

  async run<T>(
    sessionId: string,
    kind: SessionOpKind,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquire(sessionId, kind);
    try {
      if (lease.signal.aborted) throw sessionOpAbortedError();
      return await fn(lease.signal);
    } finally {
      lease.release();
    }
  }

  /** Abort the in-flight mutex op. Does not enqueue behind it. */
  interrupt(sessionId: string): void {
    this.#current.get(sessionId)?.abort.abort();
  }

  currentKind(sessionId: string): SessionOpKind | undefined {
    return this.#current.get(sessionId)?.kind;
  }

  isBusy(sessionId: string): boolean {
    return this.#current.has(sessionId);
  }
}
