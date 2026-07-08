import { subscribe } from "valtio/vanilla";
import { getHostPersistStorage } from "./host-storage.ts";

type ZustandPersistEnvelope<T> = {
  state: T;
  version?: number;
};

function unwrapPersisted<T>(raw: string): T | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "state" in parsed &&
      (parsed as ZustandPersistEnvelope<T>).state != null
    ) {
      return (parsed as ZustandPersistEnvelope<T>).state;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

function wrapPersisted<T>(state: T): string {
  return JSON.stringify({ state, version: 0 } satisfies ZustandPersistEnvelope<T>);
}

export async function hydrateValtioStore<T extends object>(
  key: string,
  store: T,
  options?: {
    merge?: (persisted: unknown, current: T) => Partial<T>;
  },
): Promise<void> {
  const storage = getHostPersistStorage();
  const raw = await storage.getItem(key);
  if (!raw) return;

  const persisted = unwrapPersisted<unknown>(raw);
  if (!persisted) return;

  const patch = options?.merge
    ? options.merge(persisted, store)
    : (persisted as Partial<T>);

  Object.assign(store, patch);
}

export function subscribeValtioPersist<T extends object>(
  key: string,
  store: T,
  options?: {
    partialize?: (state: T) => Partial<T>;
    debounceMs?: number;
  },
): () => void {
  const storage = getHostPersistStorage();
  const debounceMs = options?.debounceMs ?? 300;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    const slice = options?.partialize
      ? options.partialize(store)
      : (store as Partial<T>);
    void storage.setItem(key, wrapPersisted(slice));
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const unsubscribe = subscribe(store, schedule);

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
