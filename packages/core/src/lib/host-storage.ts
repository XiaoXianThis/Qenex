import type { QenexHostStorage } from "@qenex/platform";
import type { StateStorage } from "zustand/middleware";

let hostStorage: QenexHostStorage | null = null;

const localStorageFallback: StateStorage = {
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

export function getHostPersistStorage(): StateStorage {
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
