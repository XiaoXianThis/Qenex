import type { QenexHostStorage } from "@qenex/platform";

export type PersistStorage = {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => void | Promise<void>;
  removeItem: (name: string) => void | Promise<void>;
};

let hostStorage: QenexHostStorage | null = null;

const localStorageFallback: PersistStorage = {
  getItem: (name) => {
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage.getItem(name);
  },
  setItem: (name, value) => {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(name, value);
  },
  removeItem: (name) => {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.removeItem(name);
  },
};

export function setHostPersistStorage(storage: QenexHostStorage): void {
  hostStorage = storage;
}

export function clearHostPersistStorage(): void {
  hostStorage = null;
}

export function getHostPersistStorage(): PersistStorage {
  if (!hostStorage) {
    return localStorageFallback;
  }

  const storage = hostStorage;
  return {
    getItem: (name) => storage.get(name),
    setItem: (name, value) => storage.set(name, value),
    removeItem: (name) => storage.remove(name),
  };
}
