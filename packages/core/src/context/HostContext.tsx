import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import type { QenexHost } from "@qenex/platform";
import {
  clearBridgeHost,
  setBridgeHost,
} from "../lib/bridge-client.ts";
import {
  clearHostPersistStorage,
  setHostPersistStorage,
} from "../lib/host-storage.ts";
import { useLayoutStore } from "../store/layout-store.ts";
import { useTabsStore } from "../store/tabs-store.ts";

const HostContext = createContext<QenexHost | null>(null);

type QenexHostProviderProps = {
  host: QenexHost;
  children: ReactNode;
};

export function QenexHostProvider({ host, children }: QenexHostProviderProps) {
  const [hydrated, setHydrated] = useState(false);

  useLayoutEffect(() => {
    setBridgeHost(host);
    setHostPersistStorage(host.storage);

    void Promise.all([
      Promise.resolve(useTabsStore.persist.rehydrate()),
      Promise.resolve(useLayoutStore.persist.rehydrate()),
    ]).then(() => {
      void useTabsStore.getState().ensureInitialTab().finally(() => {
        setHydrated(true);
      });
    });

    return () => {
      clearBridgeHost();
      clearHostPersistStorage();
      setHydrated(false);
    };
  }, [host]);

  if (!hydrated) {
    return null;
  }

  return (
    <HostContext.Provider value={host}>{children}</HostContext.Provider>
  );
}

export function useHost(): QenexHost {
  const host = useContext(HostContext);
  if (!host) {
    throw new Error("useHost must be used within QenexHostProvider");
  }
  return host;
}
