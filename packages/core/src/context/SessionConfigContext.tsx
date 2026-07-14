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
  probeModelConfig,
  probeModelsConfig,
  setConfigOption,
  setMode,
  setModel,
  type ModelConfigProbe,
} from "../lib/bridge-api.ts";
import { getPreferredGitSessionMode } from "../lib/git-session-mode.ts";
import { isAuthRequiredError } from "../lib/bridge-client.ts";
import { agentsActions } from "../store/agents-store.ts";
import { isCursorAgentId, legacyIdsForRegistry } from "../config/agents.ts";
import {
  EMPTY_SESSION_CONFIG,
  type AuthChallenge,
  type SessionConfig,
  type SessionOption,
} from "../lib/session-config.ts";
import { modelConfigCacheActions } from "../store/model-config-cache-store.ts";
import { modelThoughtPrefsActions } from "../store/model-thought-prefs-store.ts";
import { tabsActions } from "../store/tabs-store.ts";

type ModelConfigSnapshot = {
  thoughtLevels: SessionOption[];
  fastOptions: SessionOption[];
};

type SessionConfigContextValue = {
  config: SessionConfig;
  agentId: string;
  /**
   * Cursor-only: per-model options need silent set_model probes.
   * Other agents use session-level ACP configOptions directly.
   */
  usesPerModelConfigProbe: boolean;
  /** Per-model thought level options (Cursor probe cache / live session). */
  thoughtLevelsByModel: Record<string, SessionOption[]>;
  /** Per-model Fast options (Cursor probe cache / live session). */
  fastOptionsByModel: Record<string, SessionOption[]>;
  /** Cursor-only: ensure thought/fast options for a model (probes when needed). */
  ensureModelConfigForModel: (modelId: string) => Promise<ModelConfigSnapshot>;
  changeMode: (modeId: string) => Promise<void>;
  changeModel: (modelId: string) => Promise<void>;
  changeThoughtLevel: (value: string) => Promise<void>;
  changeFast: (value: string) => Promise<void>;
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
  const usesPerModelConfigProbe = isCursorAgentId(agentId);
  const usesPerModelConfigProbeRef = useRef(usesPerModelConfigProbe);
  usesPerModelConfigProbeRef.current = usesPerModelConfigProbe;
  const [config, setConfig] = useState<SessionConfig>({
    ...EMPTY_SESSION_CONFIG,
    loading: true,
  });
  const [thoughtLevelsByModel, setThoughtLevelsByModel] = useState<
    Record<string, SessionOption[]>
  >(() => {
    if (!isCursorAgentId(agentId)) return {};
    const seeded: Record<string, SessionOption[]> = {};
    for (const [modelId, entry] of Object.entries(
      modelConfigCacheActions.getAgent(agentId),
    )) {
      seeded[modelId] = entry.thoughtLevels;
    }
    return seeded;
  });
  const [fastOptionsByModel, setFastOptionsByModel] = useState<
    Record<string, SessionOption[]>
  >(() => {
    if (!isCursorAgentId(agentId)) return {};
    const seeded: Record<string, SessionOption[]> = {};
    for (const [modelId, entry] of Object.entries(
      modelConfigCacheActions.getAgent(agentId),
    )) {
      seeded[modelId] = entry.fastOptions;
    }
    return seeded;
  });
  const thoughtLevelsByModelRef = useRef(thoughtLevelsByModel);
  thoughtLevelsByModelRef.current = thoughtLevelsByModel;
  const fastOptionsByModelRef = useRef(fastOptionsByModel);
  fastOptionsByModelRef.current = fastOptionsByModel;
  const probeInFlightRef = useRef<
    Map<string, Promise<ModelConfigSnapshot>>
  >(new Map());
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  const sameOptions = (
    prev: SessionOption[] | undefined,
    next: SessionOption[],
  ) =>
    !!prev &&
    prev.length === next.length &&
    prev.every((item, index) => item.id === next[index]?.id);

  const cacheThoughtLevels = useCallback(
    (modelId: string, levels: SessionOption[]) => {
      setThoughtLevelsByModel((current) => {
        if (sameOptions(current[modelId], levels)) {
          return current;
        }
        return { ...current, [modelId]: levels };
      });
    },
    [],
  );

  const cacheFastOptions = useCallback(
    (modelId: string, options: SessionOption[]) => {
      setFastOptionsByModel((current) => {
        if (sameOptions(current[modelId], options)) {
          return current;
        }
        return { ...current, [modelId]: options };
      });
    },
    [],
  );

  const cacheModelConfig = useCallback(
    (
      modelId: string,
      thoughtLevels: SessionOption[],
      fastOptions: SessionOption[],
    ) => {
      if (!usesPerModelConfigProbeRef.current) {
        return;
      }
      cacheThoughtLevels(modelId, thoughtLevels);
      cacheFastOptions(modelId, fastOptions);
      modelConfigCacheActions.set(
        agentIdRef.current,
        modelId,
        thoughtLevels,
        fastOptions,
      );
    },
    [cacheThoughtLevels, cacheFastOptions],
  );

  const seedFromPersistentCache = useCallback((forAgentId: string) => {
    if (!isCursorAgentId(forAgentId)) {
      setThoughtLevelsByModel({});
      setFastOptionsByModel({});
      thoughtLevelsByModelRef.current = {};
      fastOptionsByModelRef.current = {};
      return;
    }
    const thought: Record<string, SessionOption[]> = {};
    const fast: Record<string, SessionOption[]> = {};
    for (const [modelId, entry] of Object.entries(
      modelConfigCacheActions.getAgent(forAgentId),
    )) {
      thought[modelId] = entry.thoughtLevels;
      fast[modelId] = entry.fastOptions;
    }
    setThoughtLevelsByModel(thought);
    setFastOptionsByModel(fast);
    thoughtLevelsByModelRef.current = thought;
    fastOptionsByModelRef.current = fast;
  }, []);

  const applyProbePrefs = useCallback(
    (probe: ModelConfigProbe) => {
      const modelId = probe.modelId;
      if (
        probe.currentThoughtLevelId &&
        probe.thoughtLevels.some(
          (level) => level.id === probe.currentThoughtLevelId,
        ) &&
        !modelThoughtPrefsActions.get(agentId, modelId)
      ) {
        modelThoughtPrefsActions.set(
          agentId,
          modelId,
          probe.currentThoughtLevelId,
        );
      }
      if (
        probe.currentFastId &&
        probe.fastOptions.some((option) => option.id === probe.currentFastId) &&
        !modelThoughtPrefsActions.getFast(agentId, modelId)
      ) {
        modelThoughtPrefsActions.setFast(
          agentId,
          modelId,
          probe.currentFastId,
        );
      }
    },
    [agentId],
  );

  const readCachedSnapshot = useCallback(
    (modelId: string): ModelConfigSnapshot | null => {
      const hasThought = Object.prototype.hasOwnProperty.call(
        thoughtLevelsByModelRef.current,
        modelId,
      );
      const hasFast = Object.prototype.hasOwnProperty.call(
        fastOptionsByModelRef.current,
        modelId,
      );
      if (hasThought && hasFast) {
        return {
          thoughtLevels: thoughtLevelsByModelRef.current[modelId] ?? [],
          fastOptions: fastOptionsByModelRef.current[modelId] ?? [],
        };
      }

      const persisted = modelConfigCacheActions.get(agentId, modelId);
      if (persisted) {
        cacheModelConfig(
          modelId,
          persisted.thoughtLevels,
          persisted.fastOptions,
        );
        return {
          thoughtLevels: persisted.thoughtLevels,
          fastOptions: persisted.fastOptions,
        };
      }
      return null;
    },
    [agentId, cacheModelConfig],
  );

  const bootstrap = useCallback(async (signal?: AbortSignal): Promise<"ok" | "auth" | "error"> => {
    setConfig((current) => ({
      ...current,
      loading: true,
      error: null,
      authChallenge: null,
    }));
    seedFromPersistentCache(agentId);
    probeInFlightRef.current.clear();

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
      if (next.currentModelId) {
        cacheModelConfig(
          next.currentModelId,
          next.thoughtLevels,
          next.fastOptions,
        );
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
    cacheModelConfig,
    seedFromPersistentCache,
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
      modelId &&
      thoughtId &&
      config.thoughtLevels.length > 0 &&
      config.thoughtLevels.some((level) => level.id === thoughtId) &&
      !modelThoughtPrefsActions.get(agentId, modelId)
    ) {
      modelThoughtPrefsActions.set(agentId, modelId, thoughtId);
    }

    const fastId = config.currentFastId;
    if (
      modelId &&
      fastId &&
      config.fastOptions.length > 0 &&
      config.fastOptions.some((option) => option.id === fastId) &&
      !modelThoughtPrefsActions.getFast(agentId, modelId)
    ) {
      modelThoughtPrefsActions.setFast(agentId, modelId, fastId);
    }
  }, [
    agentId,
    config.ready,
    config.loading,
    config.currentModelId,
    config.currentThoughtLevelId,
    config.thoughtLevels,
    config.currentFastId,
    config.fastOptions,
  ]);

  // Keep the live session model cache in sync when thought/fast options change.
  useEffect(() => {
    if (!config.ready || config.loading || !config.currentModelId) {
      return;
    }
    cacheModelConfig(
      config.currentModelId,
      config.thoughtLevels,
      config.fastOptions,
    );
  }, [
    cacheModelConfig,
    config.ready,
    config.loading,
    config.currentModelId,
    config.thoughtLevels,
    config.fastOptions,
  ]);

  const refresh = useCallback(async () => {
    try {
      const next = await getSessionConfig(threadId);
      if (next.currentModelId) {
        cacheModelConfig(
          next.currentModelId,
          next.thoughtLevels,
          next.fastOptions,
        );
      }
      setConfig(next);
    } catch (error) {
      setConfig((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "加载配置失败",
      }));
    }
  }, [threadId, cacheModelConfig]);

  const runBatchProbe = useCallback(
    async (modelIds: string[]) => {
      if (!usesPerModelConfigProbeRef.current || modelIds.length === 0) {
        return;
      }
      const probes =
        modelIds.length === 1
          ? [await probeModelConfig(threadId, modelIds[0]!)]
          : await probeModelsConfig(threadId, modelIds);
      for (const probe of probes) {
        cacheModelConfig(
          probe.modelId,
          probe.thoughtLevels,
          probe.fastOptions,
        );
        applyProbePrefs(probe);
      }
    },
    [threadId, cacheModelConfig, applyProbePrefs],
  );

  const ensureModelConfigForModel = useCallback(
    async (modelId: string): Promise<ModelConfigSnapshot> => {
      // Non-Cursor agents: standard ACP session config is authoritative.
      if (!usesPerModelConfigProbe) {
        return {
          thoughtLevels: config.thoughtLevels,
          fastOptions: config.fastOptions,
        };
      }

      const cached = readCachedSnapshot(modelId);
      if (cached) {
        return cached;
      }

      if (config.currentModelId === modelId) {
        cacheModelConfig(modelId, config.thoughtLevels, config.fastOptions);
        return {
          thoughtLevels: config.thoughtLevels,
          fastOptions: config.fastOptions,
        };
      }

      const inflight = probeInFlightRef.current.get(modelId);
      if (inflight) {
        return inflight;
      }

      const probePromise = (async () => {
        try {
          await runBatchProbe([modelId]);
          return (
            readCachedSnapshot(modelId) ?? {
              thoughtLevels: [],
              fastOptions: [],
            }
          );
        } finally {
          probeInFlightRef.current.delete(modelId);
        }
      })();

      probeInFlightRef.current.set(modelId, probePromise);
      return probePromise;
    },
    [
      usesPerModelConfigProbe,
      cacheModelConfig,
      config.currentModelId,
      config.thoughtLevels,
      config.fastOptions,
      readCachedSnapshot,
      runBatchProbe,
    ],
  );

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

  const changeFast = useCallback(
    async (value: string) => {
      const configId = config.fastConfigId;
      if (!configId) {
        return;
      }

      if (config.currentModelId) {
        modelThoughtPrefsActions.setFast(agentId, config.currentModelId, value);
      }

      setConfig((current) => ({ ...current, loading: true, error: null }));
      try {
        const next = await setConfigOption(threadId, configId, value);
        setConfig(next);
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "切换 Fast 模式失败",
        }));
      }
    },
    [threadId, config.fastConfigId, config.currentModelId, agentId],
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
          modelThoughtPrefsActions.set(
            agentId,
            modelId,
            next.currentThoughtLevelId,
          );
        }

        const preferredFast = modelThoughtPrefsActions.getFast(agentId, modelId);
        const fastConfigId = next.fastConfigId;
        const canApplyFast =
          !!preferredFast &&
          !!fastConfigId &&
          next.fastOptions.some((option) => option.id === preferredFast) &&
          next.currentFastId !== preferredFast;

        if (canApplyFast && preferredFast && fastConfigId) {
          next = await setConfigOption(threadId, fastConfigId, preferredFast);
        } else if (
          !preferredFast &&
          next.currentFastId &&
          next.fastOptions.some((option) => option.id === next.currentFastId)
        ) {
          modelThoughtPrefsActions.setFast(
            agentId,
            modelId,
            next.currentFastId,
          );
        }

        setConfig(next);
        if (next.currentModelId) {
          cacheModelConfig(
            next.currentModelId,
            next.thoughtLevels,
            next.fastOptions,
          );
        }
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "切换模型失败",
        }));
      }
    },
    [threadId, agentId, cacheModelConfig],
  );

  const value = useMemo(
    () => ({
      config,
      agentId,
      usesPerModelConfigProbe,
      thoughtLevelsByModel,
      fastOptionsByModel,
      ensureModelConfigForModel,
      changeMode,
      changeModel,
      changeThoughtLevel,
      changeFast,
      refresh,
      retryAfterAuth,
    }),
    [
      config,
      agentId,
      usesPerModelConfigProbe,
      thoughtLevelsByModel,
      fastOptionsByModel,
      ensureModelConfigForModel,
      changeMode,
      changeModel,
      changeThoughtLevel,
      changeFast,
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
