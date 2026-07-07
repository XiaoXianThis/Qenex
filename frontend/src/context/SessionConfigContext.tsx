import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ensureSession,
  getSessionConfig,
  setConfigOption,
  setMode,
  setModel,
} from "@/lib/bridge-api";
import {
  EMPTY_SESSION_CONFIG,
  type SessionConfig,
} from "@/lib/session-config";
import { useTabsStore } from "@/store/tabs-store";

type SessionConfigContextValue = {
  config: SessionConfig;
  changeMode: (modeId: string) => Promise<void>;
  changeModel: (modelId: string) => Promise<void>;
  changeThoughtLevel: (value: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const SessionConfigContext = createContext<SessionConfigContextValue | null>(
  null,
);

type SessionConfigProviderProps = {
  tabId: string;
  threadId: string;
  cwd: string;
  agentCommand: string[];
  agentSessionId?: string;
  children: ReactNode;
};

export function SessionConfigProvider({
  tabId,
  threadId,
  cwd,
  agentCommand,
  agentSessionId,
  children,
}: SessionConfigProviderProps) {
  const setAgentSessionId = useTabsStore((s) => s.setAgentSessionId);
  const resumeSessionIdRef = useRef(agentSessionId);
  const [config, setConfig] = useState<SessionConfig>({
    ...EMPTY_SESSION_CONFIG,
    loading: true,
  });

  const bootstrap = useCallback(async () => {
    setConfig((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await ensureSession({
        taskId: threadId,
        cwd,
        agentCommand,
        resumeSessionId: resumeSessionIdRef.current,
      });
      setConfig(result.config);
      setAgentSessionId(tabId, result.agentSessionId);
    } catch (error) {
      setConfig({
        ...EMPTY_SESSION_CONFIG,
        error: error instanceof Error ? error.message : "会话初始化失败",
      });
    }
  }, [threadId, cwd, agentCommand, tabId, setAgentSessionId]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const refresh = useCallback(async () => {
    try {
      const next = await getSessionConfig(threadId);
      setConfig(next);
    } catch (error) {
      setConfig((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "加载配置失败",
      }));
    }
  }, [threadId]);

  const changeMode = useCallback(
    async (modeId: string) => {
      setConfig((current) => ({ ...current, loading: true, error: null }));
      try {
        const next = await setMode(threadId, modeId);
        setConfig(next);
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "切换 Agent 模式失败",
        }));
      }
    },
    [threadId],
  );

  const changeModel = useCallback(
    async (modelId: string) => {
      setConfig((current) => ({ ...current, loading: true, error: null }));
      try {
        const next = await setModel(threadId, modelId);
        setConfig(next);
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "切换模型失败",
        }));
      }
    },
    [threadId],
  );

  const changeThoughtLevel = useCallback(
    async (value: string) => {
      const configId = config.thoughtLevelConfigId;
      if (!configId) {
        return;
      }

      setConfig((current) => ({ ...current, loading: true, error: null }));
      try {
        const next = await setConfigOption(threadId, configId, value);
        setConfig(next);
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error:
            error instanceof Error ? error.message : "切换思考强度失败",
        }));
      }
    },
    [threadId, config.thoughtLevelConfigId],
  );

  const value = useMemo(
    () => ({
      config,
      changeMode,
      changeModel,
      changeThoughtLevel,
      refresh,
    }),
    [config, changeMode, changeModel, changeThoughtLevel, refresh],
  );

  return (
    <SessionConfigContext.Provider value={value}>
      {children}
    </SessionConfigContext.Provider>
  );
}

export function useSessionConfig() {
  const context = useContext(SessionConfigContext);
  if (!context) {
    throw new Error("useSessionConfig must be used within SessionConfigProvider");
  }
  return context;
}
