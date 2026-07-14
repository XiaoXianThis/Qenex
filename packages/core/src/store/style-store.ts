import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import type { HostThemeSnapshot, QenexHostKind } from "@qenex/platform";
import { themeToCss } from "../style/css-theme.ts";
import {
  cloneDefaultTheme,
  createDefaultStyleState,
  DEFAULT_CUSTOM_CSS,
  DEFAULT_STYLE_CSS,
  getSystemPrefersColorScheme,
  resolveDefaultThemeSource,
} from "../style/defaults.ts";
import { mapHostThemeToCss } from "../style/host-theme.ts";
import {
  STYLE_THEME_PRESETS,
  type StyleThemePresetId,
} from "../style/presets.ts";
import type {
  StyleComponentEditSession,
  StyleComponentScope,
} from "../style/panel-css.ts";
import type {
  DeepPartialTheme,
  StylePersistedState,
  StylePersistedStateV1,
  StylePersistedStateV2,
  StylePersistedStateV3,
  ThemeSource,
  ThemeTokens,
} from "../style/types.ts";
import { getHostPersistStorage } from "../lib/host-storage.ts";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";
import { layoutActions } from "./layout-store.ts";

function normalizeThemeSource(value: unknown): ThemeSource {
  if (value === "followHost" || value === "followSystem") return value;
  return "preset";
}

export const STYLE_PERSIST_KEY = "agent-center-style";

export type StyleState = StylePersistedState & {
  editMode: boolean;
  /** 退出编辑时是否丢弃草稿（取消） */
  discardEditDraft: boolean;
  draftThemeCss: string | null;
  draftCustomCss: string | null;
  /** 布局编辑中：单独编辑某组件 CSS（不持久化） */
  componentStyleEdit: StyleComponentEditSession | null;
  /**
   * followHost 时由宿主推送的明暗（供 color-scheme；不持久化）。
   * 未收到快照前为 null。
   */
  hostThemeKind: HostThemeSnapshot["kind"] | null;
};

function mergeTheme(
  base: ThemeTokens,
  partial: DeepPartialTheme = {},
): ThemeTokens {
  return {
    colors: { ...base.colors, ...partial.colors },
    radii: { ...base.radii, ...partial.radii },
    shadows: { ...base.shadows, ...partial.shadows },
    sizes: { ...base.sizes, ...partial.sizes },
    composer: { ...base.composer, ...partial.composer },
  };
}

function isThemeTokens(value: unknown): value is ThemeTokens {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<ThemeTokens>;
  return (
    !!t.colors &&
    !!t.radii &&
    !!t.shadows &&
    !!t.sizes &&
    !!t.composer &&
    typeof t.colors === "object" &&
    typeof t.radii === "object" &&
    typeof t.shadows === "object" &&
    typeof t.sizes === "object" &&
    typeof t.composer === "object"
  );
}

function toV4(
  themeCss: string,
  customCss: string,
  themeSource: ThemeSource = "preset",
): StylePersistedState {
  return {
    schemaVersion: 4,
    themeSource,
    themeCss,
    customCss,
  };
}

/** @internal 测试与 hydrate 共用 */
export function migratePersistedStyle(persisted: unknown): StylePersistedState {
  if (!persisted || typeof persisted !== "object") {
    return createDefaultStyleState();
  }

  const record = persisted as Partial<StylePersistedState> &
    Partial<StylePersistedStateV3> &
    Partial<StylePersistedStateV2> &
    Partial<StylePersistedStateV1> & {
      themeCss?: string;
      customCss?: string;
      css?: string;
      theme?: ThemeTokens;
      themeSource?: ThemeSource;
    };

  if (
    record.schemaVersion === 4 &&
    typeof record.themeCss === "string" &&
    typeof record.customCss === "string"
  ) {
    const themeSource = normalizeThemeSource(record.themeSource);
    return toV4(record.themeCss, record.customCss, themeSource);
  }

  if (
    record.schemaVersion === 3 &&
    typeof record.themeCss === "string" &&
    typeof record.customCss === "string"
  ) {
    return toV4(record.themeCss, record.customCss);
  }

  if (record.schemaVersion === 2 && typeof record.css === "string") {
    return toV4(record.css, DEFAULT_CUSTOM_CSS);
  }

  if (record.schemaVersion === 1 && isThemeTokens(record.theme)) {
    const theme = mergeTheme(cloneDefaultTheme(), record.theme);
    return toV4(themeToCss(theme), DEFAULT_CUSTOM_CSS);
  }

  if (typeof record.themeCss === "string") {
    return toV4(
      record.themeCss,
      typeof record.customCss === "string"
        ? record.customCss
        : DEFAULT_CUSTOM_CSS,
      normalizeThemeSource(record.themeSource),
    );
  }

  if (typeof record.css === "string") {
    return toV4(record.css, DEFAULT_CUSTOM_CSS);
  }

  if (isThemeTokens(record.theme)) {
    const theme = mergeTheme(cloneDefaultTheme(), record.theme);
    return toV4(themeToCss(theme), DEFAULT_CUSTOM_CSS);
  }

  return createDefaultStyleState();
}

export const styleStore = proxy<StyleState>({
  ...createDefaultStyleState(),
  editMode: false,
  discardEditDraft: false,
  draftThemeCss: null,
  draftCustomCss: null,
  componentStyleEdit: null,
  hostThemeKind: null,
});

export const styleActions = {
  setEditMode(editMode: boolean) {
    if (editMode) {
      styleStore.discardEditDraft = false;
      styleStore.draftThemeCss = styleStore.themeCss;
      styleStore.draftCustomCss = styleStore.customCss;
      styleStore.editMode = true;
      return;
    }

    if (!styleStore.discardEditDraft) {
      if (styleStore.draftThemeCss != null) {
        const themeChanged = styleStore.draftThemeCss !== styleStore.themeCss;
        styleStore.themeCss = styleStore.draftThemeCss;
        // 手动改了主题 CSS 则退出跟随 IDE / 系统（仅改 customCss 仍保持）
        if (
          themeChanged &&
          (styleStore.themeSource === "followHost" ||
            styleStore.themeSource === "followSystem")
        ) {
          styleStore.themeSource = "preset";
          styleStore.hostThemeKind = null;
        }
      }
      if (styleStore.draftCustomCss != null) {
        styleStore.customCss = styleStore.draftCustomCss;
      }
    }
    styleStore.draftThemeCss = null;
    styleStore.draftCustomCss = null;
    styleStore.discardEditDraft = false;
    styleStore.editMode = false;
  },

  cancelEditMode() {
    styleStore.discardEditDraft = true;
    styleStore.draftThemeCss = null;
    styleStore.draftCustomCss = null;
    styleStore.editMode = false;
  },

  clearDiscardEditDraft() {
    styleStore.discardEditDraft = false;
  },

  updateDraftThemeCss(css: string) {
    if (!styleStore.editMode) return;
    styleStore.draftThemeCss = css;
  },

  updateDraftCustomCss(css: string) {
    if (!styleStore.editMode) return;
    styleStore.draftCustomCss = css;
  },

  setCustomCss(css: string) {
    if (styleStore.editMode) {
      styleStore.draftCustomCss = css;
      return;
    }
    styleStore.customCss = css;
  },

  openComponentStyleEdit(session: StyleComponentEditSession) {
    styleStore.componentStyleEdit = session;
  },

  setComponentStyleScope(scope: StyleComponentScope) {
    const session = styleStore.componentStyleEdit;
    if (!session) return;
    if (scope === "instance" && !session.instanceTarget) return;
    styleStore.componentStyleEdit = { ...session, activeScope: scope };
  },

  closeComponentStyleEdit() {
    styleStore.componentStyleEdit = null;
  },

  resetToDefault() {
    if (styleStore.editMode) {
      styleStore.draftThemeCss = DEFAULT_STYLE_CSS;
      styleStore.draftCustomCss = DEFAULT_CUSTOM_CSS;
      return;
    }
    styleStore.themeSource = "preset";
    styleStore.hostThemeKind = null;
    styleStore.themeCss = DEFAULT_STYLE_CSS;
    styleStore.customCss = DEFAULT_CUSTOM_CSS;
  },

  /** 应用亮/暗主题预设（退出跟随 IDE / 系统） */
  applyThemePreset(id: StyleThemePresetId) {
    const preset = STYLE_THEME_PRESETS[id];
    if (!preset) return;
    styleStore.themeSource = "preset";
    styleStore.hostThemeKind = null;
    if (styleStore.editMode) {
      styleStore.draftThemeCss = preset.css;
      return;
    }
    styleStore.themeCss = preset.css;
  },

  /** 开启「跟随 IDE」；真正的色值由 applyHostTheme / HostThemeSync 写入 */
  enableFollowHost() {
    styleStore.themeSource = "followHost";
  },

  /** 开启「跟随系统」；按 prefers-color-scheme 套用亮/暗预设 */
  enableFollowSystem() {
    styleStore.themeSource = "followSystem";
    styleStore.hostThemeKind = null;
    styleActions.applySystemColorScheme(getSystemPrefersColorScheme());
  },

  /**
   * 按系统明暗写入对应预设 CSS。仅在 `themeSource === "followSystem"` 时生效。
   */
  applySystemColorScheme(scheme: "light" | "dark") {
    if (styleStore.themeSource !== "followSystem") return;
    const preset = STYLE_THEME_PRESETS[scheme];
    if (!preset) return;
    if (styleStore.editMode) {
      styleStore.draftThemeCss = preset.css;
      return;
    }
    styleStore.themeCss = preset.css;
  },

  /**
   * 首次使用：按宿主类型写入默认主题来源。
   * IDE → followHost；Web/Desktop → followSystem；其它 → 亮色预设。
   */
  applyDefaultThemeForHost(kind: QenexHostKind) {
    const source = resolveDefaultThemeSource(kind);
    if (source === "followHost") {
      styleActions.enableFollowHost();
      return;
    }
    if (source === "followSystem") {
      styleActions.enableFollowSystem();
      return;
    }
    styleActions.applyThemePreset("light");
  },

  /**
   * 应用宿主主题快照。仅在 `themeSource === "followHost"` 且非编辑模式时生效。
   */
  applyHostTheme(snapshot: HostThemeSnapshot) {
    if (styleStore.themeSource !== "followHost") return;
    if (styleStore.editMode) {
      styleStore.hostThemeKind = snapshot.kind;
      return;
    }
    styleStore.hostThemeKind = snapshot.kind;
    styleStore.themeCss = mapHostThemeToCss(snapshot);
  },
};

export function useStyleStore<T>(selector: (state: StyleState) => T): T {
  const snap = useSnapshot(styleStore) as StyleState;
  return selector(snap);
}

export function selectActiveThemeCss(state: StyleState): string {
  if (state.editMode && state.draftThemeCss != null) return state.draftThemeCss;
  return state.themeCss;
}

export function selectActiveCustomCss(state: StyleState): string {
  if (state.editMode && state.draftCustomCss != null) {
    return state.draftCustomCss;
  }
  return state.customCss;
}

export function selectThemeSource(state: StyleState): ThemeSource {
  return state.themeSource;
}

export function selectHostThemeKind(
  state: StyleState,
): HostThemeSnapshot["kind"] | null {
  return state.hostThemeKind;
}

/** @deprecated 使用 selectActiveThemeCss */
export function selectActiveCss(state: StyleState): string {
  return selectActiveThemeCss(state);
}

export async function hydrateStyleStore(): Promise<boolean> {
  const storage = getHostPersistStorage();
  const raw = await storage.getItem(STYLE_PERSIST_KEY);
  if (!raw) return false;

  await hydrateValtioStore(STYLE_PERSIST_KEY, styleStore, {
    merge: (persisted) => {
      const migrated = migratePersistedStyle(persisted);
      return {
        ...migrated,
        editMode: false,
        discardEditDraft: false,
        draftThemeCss: null,
        draftCustomCss: null,
        componentStyleEdit: null,
        hostThemeKind: null,
      };
    },
  });
  return true;
}

let unsubscribeStylePersist: (() => void) | null = null;

export function startStylePersist(): () => void {
  unsubscribeStylePersist?.();
  unsubscribeStylePersist = subscribeValtioPersist(
    STYLE_PERSIST_KEY,
    styleStore,
    {
      partialize: (state) => ({
        schemaVersion: 4 as const,
        themeSource: state.themeSource,
        themeCss: state.themeCss,
        customCss: state.customCss,
      }),
    },
  );
  return () => {
    unsubscribeStylePersist?.();
    unsubscribeStylePersist = null;
  };
}

/** 进入布局编辑时退出样式编辑（避免 layout ↔ style 循环依赖） */
const prevLayoutSetEditMode = layoutActions.setEditMode;
layoutActions.setEditMode = (editMode: boolean) => {
  if (editMode && styleStore.editMode) {
    styleActions.cancelEditMode();
  }
  prevLayoutSetEditMode(editMode);
};

/** 测试用：重置 store（不写存储） */
export function resetStyleStoreForTests(): void {
  const defaults = createDefaultStyleState();
  styleStore.schemaVersion = defaults.schemaVersion;
  styleStore.themeSource = defaults.themeSource;
  styleStore.themeCss = defaults.themeCss;
  styleStore.customCss = defaults.customCss;
  styleStore.editMode = false;
  styleStore.discardEditDraft = false;
  styleStore.draftThemeCss = null;
  styleStore.draftCustomCss = null;
  styleStore.componentStyleEdit = null;
  styleStore.hostThemeKind = null;
}
