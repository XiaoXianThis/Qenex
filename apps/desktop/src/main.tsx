import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QenexHostProvider } from "@qenex/core";
import { App } from "@qenex/ui";
import "@qenex/ui/styles.css";
import { createTauriHost } from "./host/tauri-host";

const host = createTauriHost();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QenexHostProvider host={host}>
      <App />
    </QenexHostProvider>
  </StrictMode>,
);
