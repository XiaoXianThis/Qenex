/** Messages from webview to extension host */
export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "storage-get"; requestId: number; key: string }
  | { type: "storage-set"; requestId: number; key: string; value: string }
  | { type: "storage-remove"; requestId: number; key: string }
  | { type: "pick-workspace"; requestId: number };

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
