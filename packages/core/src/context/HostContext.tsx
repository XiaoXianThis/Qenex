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
  agentsStore,
  hydrateAgentsStore,
  startAgentsPersist,
} from "../store/agents-store.ts";
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
  tabsStore,
} from "../store/tabs-store.ts";

const HostContext = createContext<QenexHost | null>(null);

type QenexHostProviderProps = {
  host: QenexHost;
  children: ReactNode;
};

function syncPreferredAgentAfterHydrate() {
  if (!agentsStore.agents.some((a) => a.id === tabsStore.preferredAgentId)) {
    tabsActions.setPreferredAgentId(agentsStore.defaultAgentId);
  }
}

export function QenexHostProvider({ host, children }: QenexHostProviderProps) {
  const [hydrated, setHydrated] = useState(false);

  useLayoutEffect(() => {
    setBridgeHost(host);
    setHostPersistStorage(host.storage);

    let stopAgentsPersist: (() => void) | undefined;
    let stopTabsPersist: (() => void) | undefined;
    let stopLayoutPersist: (() => void) | undefined;
    let stopStylePersist: (() => void) | undefined;
    let stopModelThoughtPrefsPersist: (() => void) | undefined;

    void (async () => {
      // agents 需先于 tabs，以便 createTab / preferredAgent 解析正确
      await hydrateAgentsStore();
      await Promise.all([
        hydrateTabsStore(),
        hydrateLayoutStore(),
        hydrateStyleStore(),
        hydrateModelThoughtPrefsStore(),
      ]);
      syncPreferredAgentAfterHydrate();

      stopAgentsPersist = startAgentsPersist();
      stopTabsPersist = startTabsPersist();
      stopLayoutPersist = startLayoutPersist();
      stopStylePersist = startStylePersist();
      stopModelThoughtPrefsPersist = startModelThoughtPrefsPersist();
      void tabsActions.ensureInitialTab().finally(() => {
        setHydrated(true);
      });
    })();

    return () => {
      stopAgentsPersist?.();
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
