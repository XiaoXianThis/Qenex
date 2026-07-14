export type QenexHostKind = "web" | "vscode" | "tauri" | "jetbrains";

export interface QenexHostStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** IDE / 宿主主题明暗（含高对比） */
export type HostThemeKind =
  | "light"
  | "dark"
  | "highContrast"
  | "highContrastLight";

/**
 * 宿主提供的表面色（CSS 色值，如 `#1e1e1e` / `rgb(...)`）。
 * 未提供的字段由应用侧用预设补齐。
 */
export type HostThemeColors = {
  background?: string;
  foreground?: string;
  muted?: string;
  mutedForeground?: string;
  border?: string;
  card?: string;
  primary?: string;
  primaryForeground?: string;
  accent?: string;
  accentForeground?: string;
  destructive?: string;
  input?: string;
  secondary?: string;
  secondaryForeground?: string;
  popover?: string;
  popoverForeground?: string;
  cardForeground?: string;
};

export type HostThemeSnapshot = {
  kind: HostThemeKind;
  colors: HostThemeColors;
};

export interface QenexHost {
  readonly kind: QenexHostKind;
  getBridgeBaseUrl(): Promise<string>;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  pickWorkspace(): Promise<string | null>;
  getDefaultWorkspace(): Promise<string | null>;
  storage: QenexHostStorage;
  onBridgeReady?(url: string): void;
  dispose?(): void;
  /**
   * IDE 宿主可实现：读取当前 IDE 主题色。
   * Web / Desktop 返回 `null`。
   */
  getHostTheme?(): Promise<HostThemeSnapshot | null>;
  /** IDE 主题变化时回调；返回取消订阅函数 */
  onHostThemeChange?(
    cb: (theme: HostThemeSnapshot) => void,
  ): () => void;
}
