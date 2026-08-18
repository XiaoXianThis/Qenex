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
  authChallengeFromError,
  formatBridgeError,
  getAisdkSessionConfig,
  getAisdkSessionModelConfig,
  isAisdkSessionId,
  setAisdkSessionMode,
  setAisdkSessionModel,
  setAisdkSessionConfigOption,
  type AisdkModelConfig,
} from "../lib/aisdk-session.ts";
import { isAuthRequiredError } from "../lib/bridge-client.ts";
import { getAgentPreset } from "../store/agents-store.ts";
import {
  EMPTY_SESSION_CONFIG,
  hasModelConfigOptions,
  planNewSessionBootstrapActions,
  planPreferredThoughtFastActions,
  splitThinkingToggleFromCachedOptions,
  type ModelConfigAxes,
  type SessionConfig,
  type SessionOption,
} from "../lib/session-config.ts";
import { modelConfigCacheActions } from "../store/model-config-cache-store.ts";
import { modelThoughtPrefsActions } from "../store/model-thought-prefs-store.ts";

type ModelConfigSnapshot = {
  thoughtLevels: SessionOption[];
  fastOptions: SessionOption[];
  contextOptions: SessionOption[];
  thinkingOptions: SessionOption[];
};

function preferenceModelId(
  modelId: string,
  thoughtLevels: SessionOption[],
): string {
  for (const level of thoughtLevels) {
    const suffix = `[${level.id}]`;
    if (modelId.endsWith(suffix)) return modelId.slice(0, -suffix.length);
  }
  return modelId;
}

function readThoughtPreference(
  agentId: string,
  modelId: string,
  thoughtLevels: SessionOption[],
): string | null {
  const canonicalId = preferenceModelId(modelId, thoughtLevels);
  return (
    modelThoughtPrefsActions.get(agentId, canonicalId) ??
    (canonicalId === modelId
      ? null
      : modelThoughtPrefsActions.get(agentId, modelId))
  );
}

function readFastPreference(
  agentId: string,
  modelId: string,
  thoughtLevels: SessionOption[],
): string | null {
  const canonicalId = preferenceModelId(modelId, thoughtLevels);
  return (
    modelThoughtPrefsActions.getFast(agentId, canonicalId) ??
    (canonicalId === modelId
      ? null
      : modelThoughtPrefsActions.getFast(agentId, modelId))
  );
}

type SessionConfigContextValue = {
  config: SessionConfig;
  agentId: string;
  /** Per-model thought level options (GET cache / live session snapshot). */
  thoughtLevelsByModel: Record<string, SessionOption[]>;
  /** Per-model Fast options (GET cache / live session snapshot). */
  fastOptionsByModel: Record<string, SessionOption[]>;
  contextOptionsByModel: Record<string, SessionOption[]>;
  thinkingOptionsByModel: Record<string, SessionOption[]>;
  /** Ensure thought/fast/context/thinking options for a model. */
  ensureModelConfigForModel: (modelId: string) => Promise<ModelConfigSnapshot>;
  changeMode: (modeId: string) => Promise<void>;
  changeModel: (modelId: string) => Promise<void>;
  changeThoughtLevel: (value: string) => Promise<void>;
  changeFast: (value: string) => Promise<void>;
  changeContext: (value: string) => Promise<void>;
  changeThinking: (value: string) => Promise<void>;
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
  tabId: _tabId,
  threadId,
  agentId,
  cwd: _cwd,
  agentCommand: _agentCommand,
  agentSessionId: _agentSessionId,
  children,
}: SessionConfigProviderProps) {
  const [config, setConfig] = useState<SessionConfig>({
    ...EMPTY_SESSION_CONFIG,
    loading: true,
  });
  const [thoughtLevelsByModel, setThoughtLevelsByModel] = useState<
    Record<string, SessionOption[]>
  >(() => {
    const seeded: Record<string, SessionOption[]> = {};
    for (const [modelId, entry] of Object.entries(
      modelConfigCacheActions.getAgent(agentId),
    )) {
      if (entry.thoughtLevels.length > 0) {
        seeded[modelId] = entry.thoughtLevels;
      }
    }
    return seeded;
  });
  const [fastOptionsByModel, setFastOptionsByModel] = useState<
    Record<string, SessionOption[]>
  >(() => {
    const seeded: Record<string, SessionOption[]> = {};
    for (const [modelId, entry] of Object.entries(
      modelConfigCacheActions.getAgent(agentId),
    )) {
      if (entry.fastOptions.length > 0) {
        seeded[modelId] = entry.fastOptions;
      }
    }
    return seeded;
  });
  const [contextOptionsByModel, setContextOptionsByModel] = useState<
    Record<string, SessionOption[]>
  >(() => {
    const seeded: Record<string, SessionOption[]> = {};
    for (const [modelId, entry] of Object.entries(
      modelConfigCacheActions.getAgent(agentId),
    )) {
      if (entry.contextOptions.length > 0) {
        seeded[modelId] = entry.contextOptions;
      }
    }
    return seeded;
  });
  const [thinkingOptionsByModel, setThinkingOptionsByModel] = useState<
    Record<string, SessionOption[]>
  >(() => {
    const seeded: Record<string, SessionOption[]> = {};
    for (const [modelId, entry] of Object.entries(
      modelConfigCacheActions.getAgent(agentId),
    )) {
      if (entry.thinkingOptions.length > 0) {
        seeded[modelId] = entry.thinkingOptions;
      }
    }
    return seeded;
  });
  const thoughtLevelsByModelRef = useRef(thoughtLevelsByModel);
  thoughtLevelsByModelRef.current = thoughtLevelsByModel;
  const fastOptionsByModelRef = useRef(fastOptionsByModel);
  fastOptionsByModelRef.current = fastOptionsByModel;
  const contextOptionsByModelRef = useRef(contextOptionsByModel);
  contextOptionsByModelRef.current = contextOptionsByModel;
  const thinkingOptionsByModelRef = useRef(thinkingOptionsByModel);
  thinkingOptionsByModelRef.current = thinkingOptionsByModel;
  const fetchInFlightRef = useRef<
    Map<string, Promise<ModelConfigSnapshot>>
  >(new Map());
  const fetchQueueRef = useRef(Promise.resolve());
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;
  // Mounted with a pending placeholder → this is the create path.
  // Already bound Bridge id → resume; never overwrite with global prefs.
  const [applyAgentPrefs] = useState(() => !isAisdkSessionId(threadId));

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

  const cacheContextOptions = useCallback(
    (modelId: string, options: SessionOption[]) => {
      setContextOptionsByModel((current) => {
        if (sameOptions(current[modelId], options)) {
          return current;
        }
        return { ...current, [modelId]: options };
      });
    },
    [],
  );

  const cacheThinkingOptions = useCallback(
    (modelId: string, options: SessionOption[]) => {
      setThinkingOptionsByModel((current) => {
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
      contextOptions: SessionOption[] = [],
      thinkingOptions: SessionOption[] = [],
    ) => {
      const split = splitThinkingToggleFromCachedOptions({
        thoughtLevels,
        thinkingOptions,
      });
      cacheThoughtLevels(modelId, split.thoughtLevels);
      cacheFastOptions(modelId, fastOptions);
      cacheContextOptions(modelId, contextOptions);
      cacheThinkingOptions(modelId, split.thinkingOptions);
      if (
        split.thoughtLevels.length > 0 ||
        fastOptions.length > 0 ||
        contextOptions.length > 0 ||
        split.thinkingOptions.length > 0
      ) {
        modelConfigCacheActions.set(
          agentIdRef.current,
          modelId,
          split.thoughtLevels,
          fastOptions,
          contextOptions,
          split.thinkingOptions,
        );
      }
    },
    [
      cacheThoughtLevels,
      cacheFastOptions,
      cacheContextOptions,
      cacheThinkingOptions,
    ],
  );

  const seedModelConfigs = useCallback(
    (configs: Record<string, ModelConfigAxes> | undefined) => {
      if (!configs) return;
      for (const [modelId, axes] of Object.entries(configs)) {
        cacheModelConfig(
          modelId,
          axes.thoughtLevels,
          axes.fastOptions,
          axes.contextOptions,
          axes.thinkingOptions,
        );
      }
    },
    [cacheModelConfig],
  );

  const applyModelConfigPrefs = useCallback(
    (snapshot: AisdkModelConfig) => {
      const modelId = snapshot.modelId;
      if (
        snapshot.currentThoughtLevelId &&
        snapshot.thoughtLevels.some(
          (level) => level.id === snapshot.currentThoughtLevelId,
        ) &&
        !modelThoughtPrefsActions.get(agentId, modelId)
      ) {
        modelThoughtPrefsActions.set(
          agentId,
          modelId,
          snapshot.currentThoughtLevelId,
        );
      }
      if (
        snapshot.currentFastId &&
        snapshot.fastOptions.some((option) => option.id === snapshot.currentFastId) &&
        !modelThoughtPrefsActions.getFast(agentId, modelId)
      ) {
        modelThoughtPrefsActions.setFast(
          agentId,
          modelId,
          snapshot.currentFastId,
        );
      }
      if (
        snapshot.currentContextId &&
        snapshot.contextOptions.some(
          (option) => option.id === snapshot.currentContextId,
        ) &&
        !modelThoughtPrefsActions.getContext(agentId, modelId)
      ) {
        modelThoughtPrefsActions.setContext(
          agentId,
          modelId,
          snapshot.currentContextId,
        );
      }
      if (
        snapshot.currentThinkingId &&
        snapshot.thinkingOptions.some(
          (option) => option.id === snapshot.currentThinkingId,
        ) &&
        !modelThoughtPrefsActions.getThinking(agentId, modelId)
      ) {
        modelThoughtPrefsActions.setThinking(
          agentId,
          modelId,
          snapshot.currentThinkingId,
        );
      }
    },
    [agentId],
  );

  const applyPreferredThoughtFast = useCallback(
    async (snapshot: SessionConfig, modelId: string): Promise<SessionConfig> => {
      let next = snapshot;
      const preferenceKey = preferenceModelId(modelId, next.thoughtLevels);
      const preferredThought = readThoughtPreference(
        agentId,
        modelId,
        next.thoughtLevels,
      );
      const thoughtPlan = planPreferredThoughtFastActions({
        applyPreferred: true,
        thoughtLevels: next.thoughtLevels,
        fastOptions: next.fastOptions,
        thoughtLevelConfigId: next.thoughtLevelConfigId,
        fastConfigId: next.fastConfigId,
        currentThoughtLevelId: next.currentThoughtLevelId,
        currentFastId: next.currentFastId,
        preferredThought,
        preferredFast: null,
      });
      if (thoughtPlan.setThought) {
        next = await setAisdkSessionConfigOption(
          threadId,
          thoughtPlan.setThought.configId,
          thoughtPlan.setThought.value,
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
          preferenceKey,
          next.currentThoughtLevelId,
        );
      }

      const preferredFast = readFastPreference(
        agentId,
        modelId,
        next.thoughtLevels,
      );
      const fastPlan = planPreferredThoughtFastActions({
        applyPreferred: true,
        thoughtLevels: next.thoughtLevels,
        fastOptions: next.fastOptions,
        thoughtLevelConfigId: next.thoughtLevelConfigId,
        fastConfigId: next.fastConfigId,
        currentThoughtLevelId: next.currentThoughtLevelId,
        currentFastId: next.currentFastId,
        preferredThought: null,
        preferredFast,
      });
      if (fastPlan.setFast) {
        next = await setAisdkSessionConfigOption(
          threadId,
          fastPlan.setFast.configId,
          fastPlan.setFast.value,
        );
      } else if (
        !preferredFast &&
        next.currentFastId &&
        next.fastOptions.some((option) => option.id === next.currentFastId)
      ) {
        modelThoughtPrefsActions.setFast(
          agentId,
          preferenceKey,
          next.currentFastId,
        );
      }

      const preferredContext = modelThoughtPrefsActions.getContext(
        agentId,
        preferenceKey,
      );
      if (
        preferredContext &&
        next.contextConfigId &&
        preferredContext !== next.currentContextId &&
        next.contextOptions.some((option) => option.id === preferredContext)
      ) {
        next = await setAisdkSessionConfigOption(
          threadId,
          next.contextConfigId,
          preferredContext,
        );
      }
      const preferredThinking = modelThoughtPrefsActions.getThinking(
        agentId,
        preferenceKey,
      );
      if (
        preferredThinking &&
        next.thinkingConfigId &&
        preferredThinking !== next.currentThinkingId &&
        next.thinkingOptions.some((option) => option.id === preferredThinking)
      ) {
        next = await setAisdkSessionConfigOption(
          threadId,
          next.thinkingConfigId,
          preferredThinking,
        );
      }
      return next;
    },
    [agentId, threadId],
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
      const hasContext = Object.prototype.hasOwnProperty.call(
        contextOptionsByModelRef.current,
        modelId,
      );
      const hasThinking = Object.prototype.hasOwnProperty.call(
        thinkingOptionsByModelRef.current,
        modelId,
      );
      if (hasThought || hasFast || hasContext || hasThinking) {
        const snapshot = {
          thoughtLevels: thoughtLevelsByModelRef.current[modelId] ?? [],
          fastOptions: fastOptionsByModelRef.current[modelId] ?? [],
          contextOptions: contextOptionsByModelRef.current[modelId] ?? [],
          thinkingOptions: thinkingOptionsByModelRef.current[modelId] ?? [],
        };
        if (hasModelConfigOptions(snapshot)) {
          return snapshot;
        }
      }

      const persisted = modelConfigCacheActions.get(agentId, modelId);
      if (persisted && hasModelConfigOptions(persisted)) {
        cacheModelConfig(
          modelId,
          persisted.thoughtLevels,
          persisted.fastOptions,
          persisted.contextOptions,
          persisted.thinkingOptions,
        );
        return {
          thoughtLevels: persisted.thoughtLevels,
          fastOptions: persisted.fastOptions,
          contextOptions: persisted.contextOptions,
          thinkingOptions: persisted.thinkingOptions,
        };
      }
      return null;
    },
    [agentId, cacheModelConfig],
  );

  const bootstrap = useCallback(async (signal?: AbortSignal): Promise<"ok" | "auth" | "error"> => {
    // Wait until AgentRuntimeProvider binds a real Bridge sessionId (ses_…).
    if (!isAisdkSessionId(threadId)) {
      if (signal?.aborted) return "error";
      setConfig({
        ...EMPTY_SESSION_CONFIG,
        loading: true,
        error: null,
        authChallenge: null,
      });
      return "ok";
    }

    setConfig((current) => ({
      ...current,
      loading: true,
      error: null,
      authChallenge: null,
    }));

    try {
      let next = await getAisdkSessionConfig(threadId);
      if (signal?.aborted) return "error";

      const plan = planNewSessionBootstrapActions({
        isNewSession: applyAgentPrefs,
        currentModeId: next.currentModeId,
        currentModelId: next.currentModelId,
        modes: next.modes,
        models: next.models,
        preferredMode: modelThoughtPrefsActions.getPreferredMode(agentId),
        preferredModel: modelThoughtPrefsActions.getPreferredModel(agentId),
      });
      if (plan.setMode) {
        next = await setAisdkSessionMode(threadId, plan.setMode);
        if (signal?.aborted) return "error";
      }
      if (plan.setModel) {
        next = await setAisdkSessionModel(threadId, plan.setModel);
        if (signal?.aborted) return "error";
      }
      if (applyAgentPrefs) {
        const modelId = next.currentModelId ?? plan.setModel;
        if (modelId) {
          next = await applyPreferredThoughtFast(next, modelId);
          if (signal?.aborted) return "error";
        }
      }

      seedModelConfigs(next.modelConfigs);

      if (next.currentModelId && hasModelConfigOptions(next)) {
        cacheModelConfig(
          next.currentModelId,
          next.thoughtLevels,
          next.fastOptions,
          next.contextOptions,
          next.thinkingOptions,
        );
      } else if (
        next.currentModelId &&
        !hasModelConfigOptions(next)
      ) {
        const snapshot = await getAisdkSessionModelConfig(
          threadId,
          next.currentModelId,
        );
        if (signal?.aborted) return "error";
        cacheModelConfig(
          snapshot.modelId,
          snapshot.thoughtLevels,
          snapshot.fastOptions,
          snapshot.contextOptions,
          snapshot.thinkingOptions,
        );
        applyModelConfigPrefs(snapshot);
        next = {
          ...next,
          thoughtLevels: snapshot.thoughtLevels,
          fastOptions: snapshot.fastOptions,
          contextOptions: snapshot.contextOptions,
          thinkingOptions: snapshot.thinkingOptions,
          thoughtLevelConfigId:
            snapshot.thoughtLevelConfigId ?? next.thoughtLevelConfigId,
          currentThoughtLevelId:
            snapshot.currentThoughtLevelId ?? next.currentThoughtLevelId,
          fastConfigId: snapshot.fastConfigId ?? next.fastConfigId,
          currentFastId: snapshot.currentFastId ?? next.currentFastId,
          contextConfigId: snapshot.contextConfigId ?? next.contextConfigId,
          currentContextId: snapshot.currentContextId ?? next.currentContextId,
          thinkingConfigId: snapshot.thinkingConfigId ?? next.thinkingConfigId,
          currentThinkingId: snapshot.currentThinkingId ?? next.currentThinkingId,
        };
        if (applyAgentPrefs) {
          next = await applyPreferredThoughtFast(next, next.currentModelId);
          if (signal?.aborted) return "error";
        }
        if (next.currentModelId && hasModelConfigOptions(next)) {
          cacheModelConfig(
            next.currentModelId,
            next.thoughtLevels,
            next.fastOptions,
            next.contextOptions,
            next.thinkingOptions,
          );
        }
      }
      setConfig(next);
      return "ok";
    } catch (error) {
      if (signal?.aborted) return "error";
      if (isAuthRequiredError(error)) {
        const authChallenge = authChallengeFromError(
          error,
          getAgentPreset(agentId).name,
        );
        setConfig({
          ...EMPTY_SESSION_CONFIG,
          loading: false,
          ready: false,
          error: authChallenge.detail,
          authChallenge,
        });
        return "auth";
      }
      setConfig({
        ...EMPTY_SESSION_CONFIG,
        loading: false,
        ready: false,
        error: formatBridgeError(error, "加载会话配置失败"),
        authChallenge: null,
      });
      return "error";
    }
  }, [threadId, agentId, applyAgentPrefs, cacheModelConfig, applyPreferredThoughtFast, applyModelConfigPrefs, seedModelConfigs]);

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
    if (modelId && !modelThoughtPrefsActions.getPreferredModel(agentId)) {
      modelThoughtPrefsActions.setPreferredModel(agentId, modelId);
    }
    const modeId = config.currentModeId;
    if (modeId && !modelThoughtPrefsActions.getPreferredMode(agentId)) {
      modelThoughtPrefsActions.setPreferredMode(agentId, modeId);
    }
    const thoughtId = config.currentThoughtLevelId;
    if (
      modelId &&
      thoughtId &&
      config.thoughtLevels.length > 0 &&
      config.thoughtLevels.some((level) => level.id === thoughtId) &&
      !readThoughtPreference(agentId, modelId, config.thoughtLevels)
    ) {
      modelThoughtPrefsActions.set(
        agentId,
        preferenceModelId(modelId, config.thoughtLevels),
        thoughtId,
      );
    }

    const fastId = config.currentFastId;
    if (
      modelId &&
      fastId &&
      config.fastOptions.length > 0 &&
      config.fastOptions.some((option) => option.id === fastId) &&
      !readFastPreference(agentId, modelId, config.thoughtLevels)
    ) {
      modelThoughtPrefsActions.setFast(
        agentId,
        preferenceModelId(modelId, config.thoughtLevels),
        fastId,
      );
    }
    const contextId = config.currentContextId;
    if (
      modelId &&
      contextId &&
      config.contextOptions.length > 0 &&
      config.contextOptions.some((option) => option.id === contextId) &&
      !modelThoughtPrefsActions.getContext(agentId, modelId)
    ) {
      modelThoughtPrefsActions.setContext(agentId, modelId, contextId);
    }
    const thinkingId = config.currentThinkingId;
    if (
      modelId &&
      thinkingId &&
      config.thinkingOptions.length > 0 &&
      config.thinkingOptions.some((option) => option.id === thinkingId) &&
      !modelThoughtPrefsActions.getThinking(agentId, modelId)
    ) {
      modelThoughtPrefsActions.setThinking(agentId, modelId, thinkingId);
    }
  }, [
    agentId,
    config.ready,
    config.loading,
    config.currentModelId,
    config.currentModeId,
    config.currentThoughtLevelId,
    config.thoughtLevels,
    config.currentFastId,
    config.fastOptions,
    config.currentContextId,
    config.contextOptions,
    config.currentThinkingId,
    config.thinkingOptions,
  ]);

  // Keep the live session model cache in sync when thought/fast options change.
  useEffect(() => {
    if (
      !config.ready ||
      config.loading ||
      !config.currentModelId ||
      !hasModelConfigOptions(config)
    ) {
      return;
    }
    cacheModelConfig(
      config.currentModelId,
      config.thoughtLevels,
      config.fastOptions,
      config.contextOptions,
      config.thinkingOptions,
    );
  }, [
    cacheModelConfig,
    config.ready,
    config.loading,
    config.currentModelId,
    config.thoughtLevels,
    config.fastOptions,
    config.contextOptions,
    config.thinkingOptions,
  ]);

  const refresh = useCallback(async () => {
    if (!isAisdkSessionId(threadId)) {
      return;
    }
    try {
      const next = await getAisdkSessionConfig(threadId);
      seedModelConfigs(next.modelConfigs);
      if (next.currentModelId && hasModelConfigOptions(next)) {
        cacheModelConfig(
          next.currentModelId,
          next.thoughtLevels,
          next.fastOptions,
          next.contextOptions,
          next.thinkingOptions,
        );
      }
      setConfig(next);
    } catch (error) {
      setConfig((current) => ({
        ...current,
        loading: false,
        error: formatBridgeError(error, "加载配置失败"),
      }));
    }
  }, [threadId, cacheModelConfig, seedModelConfigs]);

  const fetchModelConfig = useCallback(
    async (modelId: string): Promise<AisdkModelConfig> => {
      const run = fetchQueueRef.current.then(() =>
        getAisdkSessionModelConfig(threadId, modelId),
      );
      fetchQueueRef.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [threadId],
  );

  const ensureModelConfigForModel = useCallback(
    async (modelId: string): Promise<ModelConfigSnapshot> => {
      const cached = readCachedSnapshot(modelId);
      if (cached) {
        return cached;
      }

      if (
        config.currentModelId === modelId &&
        hasModelConfigOptions(config)
      ) {
        cacheModelConfig(modelId, config.thoughtLevels, config.fastOptions, config.contextOptions, config.thinkingOptions);
        return {
          thoughtLevels: config.thoughtLevels,
          fastOptions: config.fastOptions,
          contextOptions: config.contextOptions,
          thinkingOptions: config.thinkingOptions,
        };
      }

      const inflight = fetchInFlightRef.current.get(modelId);
      if (inflight) {
        return inflight;
      }

      const fetchPromise = (async () => {
        try {
          const snapshot = await fetchModelConfig(modelId);
          cacheModelConfig(
            snapshot.modelId,
            snapshot.thoughtLevels,
            snapshot.fastOptions,
            snapshot.contextOptions,
            snapshot.thinkingOptions,
          );
          applyModelConfigPrefs(snapshot);
          setConfig((current) => {
            if (
              current.currentModelId !== modelId &&
              current.currentModelId !== snapshot.modelId
            ) {
              return current;
            }
            return {
              ...current,
              thoughtLevels: snapshot.thoughtLevels,
              fastOptions: snapshot.fastOptions,
              contextOptions: snapshot.contextOptions,
              thinkingOptions: snapshot.thinkingOptions,
              thoughtLevelConfigId:
                snapshot.thoughtLevelConfigId ?? current.thoughtLevelConfigId,
              currentThoughtLevelId:
                snapshot.currentThoughtLevelId ?? current.currentThoughtLevelId,
              fastConfigId: snapshot.fastConfigId ?? current.fastConfigId,
              currentFastId: snapshot.currentFastId ?? current.currentFastId,
              contextConfigId:
                snapshot.contextConfigId ?? current.contextConfigId,
              currentContextId:
                snapshot.currentContextId ?? current.currentContextId,
              thinkingConfigId:
                snapshot.thinkingConfigId ?? current.thinkingConfigId,
              currentThinkingId:
                snapshot.currentThinkingId ?? current.currentThinkingId,
            };
          });
          return {
            thoughtLevels: snapshot.thoughtLevels,
            fastOptions: snapshot.fastOptions,
            contextOptions: snapshot.contextOptions,
            thinkingOptions: snapshot.thinkingOptions,
          };
        } finally {
          fetchInFlightRef.current.delete(modelId);
        }
      })();

      fetchInFlightRef.current.set(modelId, fetchPromise);
      return fetchPromise;
    },
    [
      cacheModelConfig,
      config.currentModelId,
      config.thoughtLevels,
      config.fastOptions,
      config.contextOptions,
      config.thinkingOptions,
      readCachedSnapshot,
      fetchModelConfig,
      applyModelConfigPrefs,
    ],
  );

  const changeMode = useCallback(
    async (modeId: string) => {
      if (!isAisdkSessionId(threadId)) {
        return;
      }
      setConfig((current) => ({ ...current, loading: true, error: null }));
      try {
        const next = await setAisdkSessionMode(threadId, modeId);
        modelThoughtPrefsActions.setPreferredMode(agentId, modeId);
        setConfig(next);
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error: formatBridgeError(error, "切换 Agent 模式失败"),
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

      setConfig((current) => ({ ...current, loading: true, error: null }));
      try {
        const next = await setAisdkSessionConfigOption(
          threadId,
          configId,
          value,
        );
        if (next.currentModelId) {
          modelThoughtPrefsActions.set(
            agentId,
            next.currentModelId,
            next.currentThoughtLevelId ?? value,
          );
          cacheModelConfig(
            next.currentModelId,
            next.thoughtLevels,
            next.fastOptions,
            next.contextOptions,
            next.thinkingOptions,
          );
        }
        setConfig(next);
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error: formatBridgeError(error, "切换思考强度失败"),
        }));
      }
    },
    [threadId, config.thoughtLevelConfigId, agentId, cacheModelConfig],
  );

  const changeFast = useCallback(
    async (value: string) => {
      const configId = config.fastConfigId;
      if (!configId) {
        return;
      }

      setConfig((current) => ({ ...current, loading: true, error: null }));
      try {
        const next = await setAisdkSessionConfigOption(
          threadId,
          configId,
          value,
        );
        if (next.currentModelId) {
          modelThoughtPrefsActions.setFast(
            agentId,
            next.currentModelId,
            next.currentFastId ?? value,
          );
          cacheModelConfig(
            next.currentModelId,
            next.thoughtLevels,
            next.fastOptions,
            next.contextOptions,
            next.thinkingOptions,
          );
        }
        setConfig(next);
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error: formatBridgeError(error, "切换 Fast 模式失败"),
        }));
      }
    },
    [threadId, config.fastConfigId, agentId, cacheModelConfig],
  );

  const changeContext = useCallback(
    async (value: string) => {
      const configId = config.contextConfigId;
      if (!configId) {
        return;
      }
      setConfig((current) => ({ ...current, loading: true, error: null }));
      try {
        const next = await setAisdkSessionConfigOption(
          threadId,
          configId,
          value,
        );
        if (next.currentModelId) {
          modelThoughtPrefsActions.setContext(
            agentId,
            next.currentModelId,
            next.currentContextId ?? value,
          );
          cacheModelConfig(
            next.currentModelId,
            next.thoughtLevels,
            next.fastOptions,
            next.contextOptions,
            next.thinkingOptions,
          );
        }
        setConfig(next);
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error: formatBridgeError(error, "切换上下文长度失败"),
        }));
      }
    },
    [threadId, config.contextConfigId, agentId, cacheModelConfig],
  );

  const changeThinking = useCallback(
    async (value: string) => {
      const configId = config.thinkingConfigId;
      if (!configId) {
        return;
      }
      setConfig((current) => ({ ...current, loading: true, error: null }));
      try {
        const next = await setAisdkSessionConfigOption(
          threadId,
          configId,
          value,
        );
        if (next.currentModelId) {
          modelThoughtPrefsActions.setThinking(
            agentId,
            next.currentModelId,
            next.currentThinkingId ?? value,
          );
          cacheModelConfig(
            next.currentModelId,
            next.thoughtLevels,
            next.fastOptions,
            next.contextOptions,
            next.thinkingOptions,
          );
        }
        setConfig(next);
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error: formatBridgeError(error, "切换思考开关失败"),
        }));
      }
    },
    [threadId, config.thinkingConfigId, agentId, cacheModelConfig],
  );

  const changeModel = useCallback(
    async (modelId: string) => {
      if (!isAisdkSessionId(threadId)) {
        return;
      }
      setConfig((current) => ({ ...current, loading: true, error: null }));
      try {
        let next = await setAisdkSessionModel(threadId, modelId);
        modelThoughtPrefsActions.setPreferredModel(agentId, modelId);
        next = await applyPreferredThoughtFast(next, modelId);

        setConfig(next);
        if (next.currentModelId) {
          cacheModelConfig(
            next.currentModelId,
            next.thoughtLevels,
            next.fastOptions,
            next.contextOptions,
            next.thinkingOptions,
          );
        }
      } catch (error) {
        setConfig((current) => ({
          ...current,
          loading: false,
          error: formatBridgeError(error, "切换模型失败"),
        }));
      }
    },
    [threadId, agentId, cacheModelConfig, applyPreferredThoughtFast],
  );

  const value = useMemo(
    () => ({
      config,
      agentId,
      thoughtLevelsByModel,
      fastOptionsByModel,
      contextOptionsByModel,
      thinkingOptionsByModel,
      ensureModelConfigForModel,
      changeMode,
      changeModel,
      changeThoughtLevel,
      changeFast,
      changeContext,
      changeThinking,
      refresh,
      retryAfterAuth,
    }),
    [
      config,
      agentId,
      thoughtLevelsByModel,
      fastOptionsByModel,
      contextOptionsByModel,
      thinkingOptionsByModel,
      ensureModelConfigForModel,
      changeMode,
      changeModel,
      changeThoughtLevel,
      changeFast,
      changeContext,
      changeThinking,
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
