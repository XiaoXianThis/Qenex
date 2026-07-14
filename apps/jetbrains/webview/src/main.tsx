import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary, QenexHostProvider } from "@qenex/core";
import { App } from "@qenex/ui";
import "@qenex/ui/styles.css";
import {
  createJetbrainsHost,
  installJetbrainsMessageBridge,
} from "./host/jetbrains-host";

installJetbrainsMessageBridge();
const host = createJetbrainsHost();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary label="Root">
      <QenexHostProvider host={host}>
        <App />
      </QenexHostProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
