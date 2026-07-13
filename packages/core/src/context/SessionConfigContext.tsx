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
  ensureAgentReadyWithProgress,
  ensureSession,
  getSessionConfig,
  isAgentNotReadyError,
  setConfigOption,
  setMode,
  setModel,
} from "../lib/bridge-api.ts";
import { getPreferredGitSessionMode } from "../lib/git-session-mode.ts";
import { isAuthRequiredError } from "../lib/bridge-client.ts";
import { agentsActions } from "../store/agents-store.ts";
import { legacyIdsForRegistry } from "../config/agents.ts";
import {
  EMPTY_SESSION_CONFIG,
  type AuthChallenge,
  type SessionConfig,
} from "../lib/session-config.ts";
import { modelThoughtPrefsActions } from "../store/model-thought-prefs-store.ts";
import { tabsActions } from "../store/tabs-store.ts";

type SessionConfigContextValue = {
  config: SessionConfig;
  agentId: string;
  changeMode: (modeId: string) => Promise<void>;
  changeModel: (modelId: string) => Promise<void>;
  changeThoughtLevel: (value: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Re-run session bootstrap after the user completed external login. */
  retryAfterAuth: () => Promise<void>;
};

const SessionConfigContext = createContext<SessionConfigContextValue | null>(
  null,
);

type SessionConfigProviderProps = {
  tabId: string;
  threadId: string;
  agentId: string;
  cwd: string;
  agentCommand?: string[];
  agentSessionId?: string;
  children: ReactNode;
};

export function SessionConfigProvider({
  tabId,
  threadId,
  agentId,
  cwd,
  agentCommand,
  agentSessionId,
  children,
}: SessionConfigProviderProps) {
  const setAgentSessionId = tabsActions.setAgentSessionId;
  const setAgentLoading = tabsActions.setAgentLoading;
  const resumeSessionIdRef = useRef(agentSessionId);
  const [config, setConfig] = useState<SessionConfig>({
    ...EMPTY_SESSION_CONFIG,
    loading: true,
  });

  const bootstrap = useCallback(async (signal?: AbortSignal): Promise<"ok" | "auth" | "error"> => {
    setConfig((current) => ({
      ...current,
      loading: true,
      error: null,
      authChallenge: null,
    }));

    const runEnsureSession = async () =>
      ensureSession({
        taskId: threadId,
        cwd,
        agentId,
        agentCommand:
          agentCommand && agentCommand.length > 0 ? agentCommand : undefined,
        resumeSessionId: resumeSessionIdRef.current,
        gitSessionMode: getPreferredGitSessionMode(),
      });

    try {
      let result;
      try {
        result = await runEnsureSession();
      } catch (firstError) {
        if (isAuthRequiredError(firstError)) {
          throw firstError;
        }
        const message =
          firstError instanceof Error ? firstError.message : String(firstError);
        if (!isAgentNotReadyError(message) || signal?.aborted) {
          throw firstError;
        }
        setConfig((current) => ({
          ...current,
          loading: true,
          error: null,
          authChallenge: null,
        }));
        const ensured = await ensureAgentReadyWithProgress(
          agentId,
          undefined,
          (event) => {
            if (signal?.aborted) return;
            if (event.type === "stage" || event.type === "download") {
              setConfig((current) => ({
                ...current,
                loading: true,
                error: null,
              }));
            }
          },
        );
        if (signal?.aborted) {
          return "error";
        }
        agentsActions.upsertFromRegistry(
          {
            id: ensured.agentId,
            name: ensured.installed?.name || ensured.agentId,
            command: [],
            source: ensured.skippedDownload ? "detected" : "registry",
            registryId: ensured.agentId,
          },
          legacyIdsForRegistry(ensured.agentId),
        );
        result = await runEnsureSession();
      }
      if (signal?.aborted) {
        return "error";
      }

      let next = result.config;

      const preferredMode = modelThoughtPrefsActions.getPreferredMode(agentId);
      const canRestoreMode =
        !!preferredMode &&
        preferredMode !== next.currentModeId &&
        next.modes.some((mode) => mode.id === preferredMode);

      if (canRestoreMode && preferredMode) {
        next = await setMode(threadId, preferredMode);
      } else if (next.currentModeId) {
        modelThoughtPrefsActions.setPreferredMode(agentId, next.currentModeId);
      }

      const preferredModel =
        modelThoughtPrefsActions.getPreferredModel(agentId);
      const canRestoreModel =
        !!preferredModel &&
        preferredModel !== next.currentModelId &&
        next.models.some((model) => model.id === preferredModel);

      if (canRestoreModel && preferredModel) {
        next = await setModel(threadId, preferredModel);
      } else if (next.currentModelId) {
        modelThoughtPrefsActions.setPreferredModel(agentId, next.currentModelId);
      }

      // Restore thought level even when the model did not need changing
      // (e.g. Claude Code resets to Default on restart while OpenCode may not).
      const modelIdForThought = next.currentModelId;
      if (modelIdForThought) {
        const preferredThought = modelThoughtPrefsActions.get(
          agentId,
          modelIdForThought,
        );
        const thoughtConfigId = next.thoughtLevelConfigId;
        if (
          preferredThought &&
          thoughtConfigId &&
          next.thoughtLevels.some((level) => level.id === preferredThought) &&
          next.currentThoughtLevelId !== preferredThought
        ) {
          next = await setConfigOption(
            threadId,
            thoughtConfigId,
            preferredThought,
          );
        }
      }

      if (signal?.aborted) {
        return "error";
      }
      setConfig(next);
      setAgentSessionId(tabId, result.agentSessionId);
      setAgentLoading(tabId, false);
      return "ok";
    } catch (error) {
      if (signal?.aborted) {
        return "error";
      }
      if (isAuthRequiredError(error)) {
        const challenge = error.asAuthRequired();
        const authChallenge: AuthChallenge | null = challenge
          ? {
              detail: challenge.detail,
              methods: challenge.methods,
              agentName: challenge.agentName,
            }
          : null;
        setConfig({
          ...EMPTY_SESSION_CONFIG,
          error: challenge?.detail ?? error.message,
          authChallenge,
        });
        setAgentLoading(tabId, false);
        return "auth";
      }
      setConfig({
        ...EMPTY_SESSION_CONFIG,
        error: error instanceof Error ? error.message : "会话初始化失败",
      });
      setAgentLoading(tabId, false);
      return "error";
    }
  }, [
    threadId,
    cwd,
    agentCommand,
    tabId,
    agentId,
    setAgentSessionId,
    setAgentLoading,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    void bootstrap(controller.signal);
    return () => controller.abort();
  }, [bootstrap]);

  const retryAfterAuth = useCallback(async () => {
    const outcome = await bootstrap();
    if (outcome === "ok") {
      return;
    }
    if (outcome === "auth") {
      throw new Error("仍需登录：请确认已完成终端登录后再试");
    }
    throw new Error("会话初始化失败，请重试");
  }, [bootstrap]);

  // Seed preference for the active model once session config is ready.
  useEffect(() => {
    if (!config.ready || config.loading) {
      return;
    }
    const modelId = config.currentModelId;
    const thoughtId = config.currentThoughtLevelId;
    if (
      !modelId ||
      !thoughtId ||
      config.thoughtLevels.length === 0 ||
      !config.thoughtLevels.some((level) => level.id === thoughtId)
    ) {
      return;
    }
    if (modelThoughtPrefsActions.get(agentId, modelId)) {
      return;
    }
    modelThoughtPrefsActions.set(agentId, modelId, thoughtId);
  }, [
    agentId,
    config.ready,
    config.loading,
    config.currentModelId,
    config.currentThoughtLevelId,
    config.thoughtLevels,
  ]);

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
      modelThoughtPrefsActions.setPreferredMode(agentId, modeId);
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
    [threadId, agentId],
  );

  const changeThoughtLevel = useCallback(
    async (value: string) => {
      const configId = config.thoughtLevelConfigId;
      if (!configId) {
        return;
      }

      if (config.currentModelId) {
        modelThoughtPrefsActions.set(agentId, config.currentModelId, value);
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
    [threadId, config.thoughtLevelConfigId, config.currentModelId, agentId],
  );

  const changeModel = useCallback(
    async (modelId: string) => {
      modelThoughtPrefsActions.setPreferredModel(agentId, modelId);
      setConfig((current) => ({ ...current, loading: true, error: null }));
      try {
        let next = await setModel(threadId, modelId);

        const preferredThought = modelThoughtPrefsActions.get(agentId, modelId);
        const thoughtConfigId = next.thoughtLevelConfigId;
        const canApplyThought =
          !!preferredThought &&
          !!thoughtConfigId &&
          next.thoughtLevels.some((level) => level.id === preferredThought) &&
          next.currentThoughtLevelId !== preferredThought;

        if (canApplyThought && preferredThought && thoughtConfigId) {
          next = await setConfigOption(
            threadId,
            thoughtConfigId,
            preferredThought,
          );
        } else if (
          !preferredThought &&
          next.currentThoughtLevelId &&
          next.thoughtLevels.some(
            (level) => level.id === next.currentThoughtLevelId,
          )
        ) {
          // Seed preference from agent default when we have no saved mapping.
          modelThoughtPrefsActions.set(
            agentId,
            modelId,
            next.currentThoughtLevelId,
          );
        }

        setConfig(next);
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "切换模型失败",
        }));
      }
    },
    [threadId, agentId],
  );

  const value = useMemo(
    () => ({
      config,
      agentId,
      changeMode,
      changeModel,
      changeThoughtLevel,
      refresh,
      retryAfterAuth,
    }),
    [
      config,
      agentId,
      changeMode,
      changeModel,
      changeThoughtLevel,
      refresh,
      retryAfterAuth,
    ],
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
