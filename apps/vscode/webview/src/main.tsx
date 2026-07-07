import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QenexHostProvider } from "@qenex/core";
import { App } from "@qenex/ui";
import "@qenex/ui/styles.css";
import {
  createVscodeHost,
  installVscodeMessageBridge,
} from "./host/vscode-host";

const vscode = acquireVsCodeApi();
installVscodeMessageBridge(vscode);
const host = createVscodeHost(vscode);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QenexHostProvider host={host}>
      <App />
    </QenexHostProvider>
  </StrictMode>,
);
