export type QenexHostKind = "web" | "vscode" | "tauri" | "jetbrains";

export interface QenexHostStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface QenexHost {
  readonly kind: QenexHostKind;
  getBridgeBaseUrl(): Promise<string>;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  pickWorkspace(): Promise<string | null>;
  getDefaultWorkspace(): Promise<string | null>;
  storage: QenexHostStorage;
  onBridgeReady?(url: string): void;
  dispose?(): void;
}
