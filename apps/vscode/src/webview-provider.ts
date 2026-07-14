import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ColorThemeKind,
  Uri,
  window,
  workspace,
  type ExtensionContext,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
  type WebviewViewResolveContext,
} from "vscode";
import type { BridgeManager } from "./bridge-manager";
import {
  hostThemeKindOnly,
  isWebviewMessage,
  mapVscodeColorThemeKind,
  type ExtensionToWebviewMessage,
  type WebviewToExtensionMessage,
} from "./messages";

const STORAGE_PREFIX = "qenex:";

function currentHostThemeSnapshot() {
  return hostThemeKindOnly(
    mapVscodeColorThemeKind(
      window.activeColorTheme.kind,
      ColorThemeKind,
    ),
  );
}

export class QenexWebviewProvider implements WebviewViewProvider {
  public static readonly viewType = "qenex.sidebar";

  private webview: Webview | null = null;

  constructor(
    private readonly context: ExtensionContext,
    private readonly bridgeManager: BridgeManager,
  ) {
    context.subscriptions.push(
      window.onDidChangeActiveColorTheme(() => {
        this.postToWebview({
          type: "theme-update",
          theme: currentHostThemeSnapshot(),
        });
      }),
    );
  }

  async resolveWebviewView(
    webviewView: WebviewView,
    _context: WebviewViewResolveContext,
  ): Promise<void> {
    this.webview = webviewView.webview;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [Uri.joinPath(this.context.extensionUri, "media")],
    };

    const nonce = getNonce();

    try {
      const bridgeUrl = await this.bridgeManager.start(
        webviewView.webview.cspSource,
      );
      const defaultWorkspace = getDefaultWorkspace();

      webviewView.webview.html = await buildWebviewHtml(
        this.context.extensionUri,
        webviewView.webview,
        nonce,
        bridgeUrl,
      );

      webviewView.webview.onDidReceiveMessage(
        (message: unknown) => {
          void this.handleMessage(message, defaultWorkspace, bridgeUrl);
        },
        undefined,
        this.context.subscriptions,
      );
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : String(error);
      console.error("[qenex] failed to resolve webview:", error);
      webviewView.webview.html = buildErrorHtml(nonce, detail);
    }
  }

  private async handleMessage(
    raw: unknown,
    defaultWorkspace: string | null,
    bridgeUrl: string,
  ): Promise<void> {
    if (!isWebviewMessage(raw) || !this.webview) {
      return;
    }

    const message = raw as WebviewToExtensionMessage;

    switch (message.type) {
      case "ready": {
        this.postToWebview({
          type: "bridge-ready",
          url: bridgeUrl,
          defaultWorkspace,
        });
        this.postToWebview({
          type: "theme-update",
          theme: currentHostThemeSnapshot(),
        });
        return;
      }
      case "storage-get": {
        const value =
          this.context.globalState.get<string>(
            `${STORAGE_PREFIX}${message.key}`,
          ) ?? null;
        this.postToWebview({
          type: "storage-result",
          requestId: message.requestId,
          value,
        });
        return;
      }
      case "storage-set": {
        await this.context.globalState.update(
          `${STORAGE_PREFIX}${message.key}`,
          message.value,
        );
        this.postToWebview({
          type: "storage-result",
          requestId: message.requestId,
        });
        return;
      }
      case "storage-remove": {
        await this.context.globalState.update(
          `${STORAGE_PREFIX}${message.key}`,
          undefined,
        );
        this.postToWebview({
          type: "storage-result",
          requestId: message.requestId,
        });
        return;
      }
      case "pick-workspace": {
        const folders = await window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: "选择工作目录",
        });
        const picked = folders?.[0]?.fsPath ?? null;
        this.postToWebview({
          type: "pick-workspace-result",
          requestId: message.requestId,
          path: picked,
        });
        return;
      }
      case "get-host-theme": {
        this.postToWebview({
          type: "host-theme-result",
          requestId: message.requestId,
          theme: currentHostThemeSnapshot(),
        });
        return;
      }
      default:
        return;
    }
  }

  private postToWebview(message: ExtensionToWebviewMessage): void {
    void this.webview?.postMessage(message);
  }
}

function getDefaultWorkspace(): string | null {
  return workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

async function buildWebviewHtml(
  extensionUri: Uri,
  webview: Webview,
  nonce: string,
  bridgeUrl: string,
): Promise<string> {
  const mediaDir = Uri.joinPath(extensionUri, "media");
  const indexPath = path.join(mediaDir.fsPath, "index.html");
  let html = await readFile(indexPath, "utf8");

  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `connect-src ${webview.cspSource} ${bridgeUrl} http://127.0.0.1:* http://localhost:*`,
  ].join("; ");

  html = html.replace(
    /<head>/i,
    `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`,
  );

  html = html.replace(
    /(href|src)="(\.?\/[^"]+)"/g,
    (_match, attr: string, assetPath: string) => {
      const normalized = assetPath.replace(/^\.\//, "");
      const resourceUri = webview.asWebviewUri(
        Uri.joinPath(mediaDir, normalized),
      );
      return `${attr}="${resourceUri}"`;
    },
  );

  html = html.replace(
    /<script\b([^>]*)>/gi,
    `<script nonce="${nonce}"$1>`,
  );

  return html;
}

function buildErrorHtml(nonce: string, detail: string): string {
  const escaped = detail
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>Qenex 启动失败</title>
  <style>
    body { font-family: sans-serif; padding: 16px; color: #ccc; background: #1e1e1e; }
    h2 { color: #f48771; margin-top: 0; }
    pre { white-space: pre-wrap; word-break: break-word; background: #2d2d2d; padding: 12px; border-radius: 6px; }
  </style>
</head>
<body>
  <h2>Qenex 启动失败</h2>
  <p>Bridge 子进程未能启动。请确认已运行 <code>bun run build:vscode</code>，且 8000 端口未被占用。</p>
  <pre>${escaped}</pre>
</body>
</html>`;
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
