import { window, type ExtensionContext } from "vscode";
import { BridgeManager } from "./bridge-manager";
import { QenexWebviewProvider } from "./webview-provider";

let bridgeManager: BridgeManager | null = null;

export async function activate(context: ExtensionContext): Promise<void> {
  bridgeManager = new BridgeManager(context);

  const provider = new QenexWebviewProvider(context, bridgeManager);
  context.subscriptions.push(
    window.registerWebviewViewProvider(
      QenexWebviewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
}

export async function deactivate(): Promise<void> {
  if (bridgeManager) {
    await bridgeManager.stop();
    bridgeManager = null;
  }
}
