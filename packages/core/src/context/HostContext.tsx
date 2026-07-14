import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import type { QenexHost } from "@qenex/platform";
import { AppErrorBoundary } from "../components/AppErrorBoundary.tsx";
import {
  clearBridgeHost,
  setBridgeHost,
} from "../lib/bridge-client.ts";
import {
  clearHostPersistStorage,
  setHostPersistStorage,
} from "../lib/host-storage.ts";
import {
  agentsActions,
  agentsStore,
  hydrateAgentsStore,
  startAgentsPersist,
} from "../store/agents-store.ts";
import { discoverLocalAgents } from "../lib/bridge-api.ts";
import {
  hydrateLayoutStore,
  startLayoutPersist,
} from "../store/layout-store.ts";
import {
  hydrateModelThoughtPrefsStore,
  startModelThoughtPrefsPersist,
} from "../store/model-thought-prefs-store.ts";
import {
  hydrateModelConfigCacheStore,
  startModelConfigCachePersist,
} from "../store/model-config-cache-store.ts";
import {
  hydrateApprovalPrefsStore,
  startApprovalPrefsPersist,
} from "../store/approval-prefs-store.ts";
import {
  hydrateUiPrefsStore,
  startUiPrefsPersist,
} from "../store/ui-prefs-store.ts";
import { applyDocumentThemeStyles } from "../style/document-theme.ts";
import { getSystemPrefersColorScheme } from "../style/defaults.ts";
import {
  hydrateStyleStore,
  startStylePersist,
  styleActions,
  styleStore,
} from "../store/style-store.ts";
import {
  hydrateTabsStore,
  startTabsPersist,
  tabsActions,
  tabsStore,
} from "../store/tabs-store.ts";

function applyPersistedDocumentTheme() {
  applyDocumentThemeStyles({
    themeCss: styleStore.themeCss,
    customCss: styleStore.customCss,
    themeSource: styleStore.themeSource,
    hostThemeKind: styleStore.hostThemeKind,
  });
}

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
    let stopModelConfigCachePersist: (() => void) | undefined;
    let stopApprovalPrefsPersist: (() => void) | undefined;
    let stopUiPrefsPersist: (() => void) | undefined;

    void (async () => {
      try {
        // 先 hydrate 主题并立刻写入 DOM，让 Loading 页背景跟随已保存主题
        const hadPersistedStyle = await hydrateStyleStore();
        if (!hadPersistedStyle) {
          styleActions.applyDefaultThemeForHost(host.kind);
        }
        applyPersistedDocumentTheme();
        if (styleStore.themeSource === "followHost") {
          try {
            const snapshot = await host.getHostTheme?.();
            if (snapshot) {
              styleActions.applyHostTheme(snapshot);
              applyPersistedDocumentTheme();
            }
          } catch {
            // 宿主主题稍后由 HostThemeSync 补齐
          }
        } else if (styleStore.themeSource === "followSystem") {
          styleActions.applySystemColorScheme(getSystemPrefersColorScheme());
          applyPersistedDocumentTheme();
        }

        // agents 需先于 tabs，以便 createTab / preferredAgent 解析正确
        await hydrateAgentsStore();
        // Best-effort: merge PATH/vendor-ready agents into presets.
        try {
          const discovered = await discoverLocalAgents(false);
          agentsActions.mergeDetectedAgents(discovered.agents);
        } catch {
          // Bridge may be starting; ignore discover failures at hydrate time.
        }
        await Promise.all([
          hydrateTabsStore(),
          hydrateLayoutStore(),
          hydrateModelThoughtPrefsStore(),
          hydrateModelConfigCacheStore(),
          hydrateApprovalPrefsStore(),
          hydrateUiPrefsStore(),
        ]);
        syncPreferredAgentAfterHydrate();

        stopAgentsPersist = startAgentsPersist();
        stopTabsPersist = startTabsPersist();
        stopLayoutPersist = startLayoutPersist();
        stopStylePersist = startStylePersist();
        stopModelThoughtPrefsPersist = startModelThoughtPrefsPersist();
        stopModelConfigCachePersist = startModelConfigCachePersist();
        stopApprovalPrefsPersist = startApprovalPrefsPersist();
        stopUiPrefsPersist = startUiPrefsPersist();
        await tabsActions.ensureInitialTab();
      } catch (error) {
        console.error("[qenex] host hydrate failed:", error);
      } finally {
        setHydrated(true);
      }
    })();

    return () => {
      stopAgentsPersist?.();
      stopTabsPersist?.();
      stopLayoutPersist?.();
      stopStylePersist?.();
      stopModelThoughtPrefsPersist?.();
      stopModelConfigCachePersist?.();
      stopApprovalPrefsPersist?.();
      stopUiPrefsPersist?.();
      clearBridgeHost();
      clearHostPersistStorage();
      setHydrated(false);
    };
  }, [host]);

  const body = !hydrated ? (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        background: "var(--background, transparent)",
        color: "var(--foreground, #888)",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
      }}
    >
      Loading Qenex…
    </div>
  ) : (
    <HostContext.Provider value={host}>{children}</HostContext.Provider>
  );

  return <AppErrorBoundary label="Qenex">{body}</AppErrorBoundary>;
}

export function useHost(): QenexHost {
  const host = useContext(HostContext);
  if (!host) {
    throw new Error("useHost must be used within QenexHostProvider");
  }
  return host;
}
