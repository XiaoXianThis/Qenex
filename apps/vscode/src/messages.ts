/** IDE 主题明暗（与 @qenex/platform HostThemeKind 对齐） */
export type HostThemeKind =
  | "light"
  | "dark"
  | "highContrast"
  | "highContrastLight";

export type HostThemeSnapshot = {
  kind: HostThemeKind;
  colors: Record<string, string>;
};

/** Messages from webview to extension host */
export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "storage-get"; requestId: number; key: string }
  | { type: "storage-set"; requestId: number; key: string; value: string }
  | { type: "storage-remove"; requestId: number; key: string }
  | { type: "pick-workspace"; requestId: number }
  | { type: "get-host-theme"; requestId: number };

/** Messages from extension host to webview */
export type ExtensionToWebviewMessage =
  | {
      type: "bridge-ready";
      url: string;
      defaultWorkspace: string | null;
    }
  | {
      type: "storage-result";
      requestId: number;
      value?: string | null;
    }
  | {
      type: "pick-workspace-result";
      requestId: number;
      path: string | null;
    }
  | {
      type: "host-theme-result";
      requestId: number;
      theme: HostThemeSnapshot;
    }
  | {
      type: "theme-update";
      theme: HostThemeSnapshot;
    };

export function isWebviewMessage(
  value: unknown,
): value is WebviewToExtensionMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

export function mapVscodeColorThemeKind(
  kind: number,
  ColorThemeKind: {
    Light: number;
    Dark: number;
    HighContrast: number;
    HighContrastLight: number;
  },
): HostThemeKind {
  if (kind === ColorThemeKind.HighContrast) return "highContrast";
  if (kind === ColorThemeKind.HighContrastLight) return "highContrastLight";
  if (kind === ColorThemeKind.Dark) return "dark";
  return "light";
}

/** 扩展侧只推 kind；webview 采 `--vscode-*` 色值后拼完整 snapshot */
export function hostThemeKindOnly(kind: HostThemeKind): HostThemeSnapshot {
  return { kind, colors: {} };
}
