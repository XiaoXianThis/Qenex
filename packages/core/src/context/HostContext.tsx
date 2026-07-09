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
  hydrateModelThoughtPrefsStore,
  startModelThoughtPrefsPersist,
} from "../store/model-thought-prefs-store.ts";
import {
  hydrateStyleStore,
  startStylePersist,
} from "../store/style-store.ts";
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
    let stopStylePersist: (() => void) | undefined;
    let stopModelThoughtPrefsPersist: (() => void) | undefined;

    void Promise.all([
      hydrateTabsStore(),
      hydrateLayoutStore(),
      hydrateStyleStore(),
      hydrateModelThoughtPrefsStore(),
    ]).then(() => {
      stopTabsPersist = startTabsPersist();
      stopLayoutPersist = startLayoutPersist();
      stopStylePersist = startStylePersist();
      stopModelThoughtPrefsPersist = startModelThoughtPrefsPersist();
      void tabsActions.ensureInitialTab().finally(() => {
        setHydrated(true);
      });
    });

    return () => {
      stopTabsPersist?.();
      stopLayoutPersist?.();
      stopStylePersist?.();
      stopModelThoughtPrefsPersist?.();
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
