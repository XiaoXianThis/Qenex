import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import { themeToCss } from "../style/css-theme.ts";
import {
  cloneDefaultTheme,
  createDefaultStyleState,
  DEFAULT_CUSTOM_CSS,
  DEFAULT_STYLE_CSS,
} from "../style/defaults.ts";
import {
  STYLE_THEME_PRESETS,
  type StyleThemePresetId,
} from "../style/presets.ts";
import type { StyleComponentTarget } from "../style/panel-css.ts";
import type {
  DeepPartialTheme,
  StylePersistedState,
  StylePersistedStateV1,
  StylePersistedStateV2,
  ThemeTokens,
} from "../style/types.ts";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";
import { layoutActions } from "./layout-store.ts";

export const STYLE_PERSIST_KEY = "agent-center-style";

export type StyleState = StylePersistedState & {
  editMode: boolean;
  /** 退出编辑时是否丢弃草稿（取消） */
  discardEditDraft: boolean;
  draftThemeCss: string | null;
  draftCustomCss: string | null;
  /** 布局编辑中：单独编辑某组件 CSS（不持久化） */
  componentStyleEdit: StyleComponentTarget | null;
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

function migratePersistedStyle(persisted: unknown): StylePersistedState {
  if (!persisted || typeof persisted !== "object") {
    return createDefaultStyleState();
  }

  // Intersection of v1/v2/v3 collapses to `never` (schemaVersion literals conflict).
  const record = persisted as Partial<StylePersistedState> &
    Partial<StylePersistedStateV2> &
    Partial<StylePersistedStateV1> & {
      themeCss?: string;
      customCss?: string;
      css?: string;
      theme?: ThemeTokens;
    };

  if (
    record.schemaVersion === 3 &&
    typeof record.themeCss === "string" &&
    typeof record.customCss === "string"
  ) {
    return {
      schemaVersion: 3,
      themeCss: record.themeCss,
      customCss: record.customCss,
    };
  }

  // v2：整段 css 视为主题 CSS，自定义为空
  if (record.schemaVersion === 2 && typeof record.css === "string") {
    return {
      schemaVersion: 3,
      themeCss: record.css,
      customCss: DEFAULT_CUSTOM_CSS,
    };
  }

  if (record.schemaVersion === 1 && isThemeTokens(record.theme)) {
    const theme = mergeTheme(cloneDefaultTheme(), record.theme);
    return {
      schemaVersion: 3,
      themeCss: themeToCss(theme),
      customCss: DEFAULT_CUSTOM_CSS,
    };
  }

  if (typeof record.themeCss === "string") {
    return {
      schemaVersion: 3,
      themeCss: record.themeCss,
      customCss:
        typeof record.customCss === "string"
          ? record.customCss
          : DEFAULT_CUSTOM_CSS,
    };
  }

  if (typeof record.css === "string") {
    return {
      schemaVersion: 3,
      themeCss: record.css,
      customCss: DEFAULT_CUSTOM_CSS,
    };
  }

  if (isThemeTokens(record.theme)) {
    const theme = mergeTheme(cloneDefaultTheme(), record.theme);
    return {
      schemaVersion: 3,
      themeCss: themeToCss(theme),
      customCss: DEFAULT_CUSTOM_CSS,
    };
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
});

export const styleActions = {
  setEditMode(editMode: boolean) {
    if (editMode) {
      // 允许在布局编辑中打开 CSS 编辑，不再互斥退出布局
      styleStore.discardEditDraft = false;
      styleStore.draftThemeCss = styleStore.themeCss;
      styleStore.draftCustomCss = styleStore.customCss;
      styleStore.editMode = true;
      return;
    }

    // 完成：提交草稿
    if (!styleStore.discardEditDraft) {
      if (styleStore.draftThemeCss != null) {
        styleStore.themeCss = styleStore.draftThemeCss;
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

  /** 丢弃本次编辑草稿并退出编辑模式 */
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

  /**
   * 更新自定义 CSS。
   * 样式编辑模式中写草稿；否则直接写入持久化字段（供组件级 CSS 弹窗使用）。
   */
  setCustomCss(css: string) {
    if (styleStore.editMode) {
      styleStore.draftCustomCss = css;
      return;
    }
    styleStore.customCss = css;
  },

  openComponentStyleEdit(target: StyleComponentTarget) {
    styleStore.componentStyleEdit = target;
  },

  closeComponentStyleEdit() {
    styleStore.componentStyleEdit = null;
  },

  /** 恢复主题默认 CSS；自定义 CSS 清空 */
  resetToDefault() {
    if (styleStore.editMode) {
      styleStore.draftThemeCss = DEFAULT_STYLE_CSS;
      styleStore.draftCustomCss = DEFAULT_CUSTOM_CSS;
      return;
    }
    styleStore.themeCss = DEFAULT_STYLE_CSS;
    styleStore.customCss = DEFAULT_CUSTOM_CSS;
  },

  /** 应用亮/暗主题预设（只改主题 CSS，不动自定义 CSS） */
  applyThemePreset(id: StyleThemePresetId) {
    const preset = STYLE_THEME_PRESETS[id];
    if (!preset) return;
    if (styleStore.editMode) {
      styleStore.draftThemeCss = preset.css;
      return;
    }
    styleStore.themeCss = preset.css;
  },
};

export function useStyleStore<T>(selector: (state: StyleState) => T): T {
  const snap = useSnapshot(styleStore) as StyleState;
  return selector(snap);
}

/** 当前主题 CSS（编辑中用 draft） */
export function selectActiveThemeCss(state: StyleState): string {
  if (state.editMode && state.draftThemeCss != null) return state.draftThemeCss;
  return state.themeCss;
}

/** 当前自定义 CSS（编辑中用 draft） */
export function selectActiveCustomCss(state: StyleState): string {
  if (state.editMode && state.draftCustomCss != null) {
    return state.draftCustomCss;
  }
  return state.customCss;
}

/** @deprecated 使用 selectActiveThemeCss */
export function selectActiveCss(state: StyleState): string {
  return selectActiveThemeCss(state);
}

export async function hydrateStyleStore(): Promise<void> {
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
      };
    },
  });
}

let unsubscribeStylePersist: (() => void) | null = null;

export function startStylePersist(): () => void {
  unsubscribeStylePersist?.();
  unsubscribeStylePersist = subscribeValtioPersist(
    STYLE_PERSIST_KEY,
    styleStore,
    {
      partialize: (state) => ({
        schemaVersion: 3 as const,
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
