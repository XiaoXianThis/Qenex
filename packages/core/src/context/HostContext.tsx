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
import {
  hydrateLayoutStore,
  startLayoutPersist,
} from "../store/layout-store.ts";
import {
  hydrateTabsStore,
  startTabsPersist,
  tabsActions,
} from "../store/tabs-store.ts";

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

    let stopTabsPersist: (() => void) | undefined;
    let stopLayoutPersist: (() => void) | undefined;

    void Promise.all([hydrateTabsStore(), hydrateLayoutStore()]).then(() => {
      stopTabsPersist = startTabsPersist();
      stopLayoutPersist = startLayoutPersist();
      void tabsActions.ensureInitialTab().finally(() => {
        setHydrated(true);
      });
    });

    return () => {
      stopTabsPersist?.();
      stopLayoutPersist?.();
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
