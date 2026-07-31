import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, QenexHostProvider } from "@qenex/ui/index.ts";
import "@qenex/ui/styles.css";
import "./index.css";
import { createWebHost } from "./host.ts";

const host = createWebHost();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QenexHostProvider host={host}>
      <App />
    </QenexHostProvider>
  </StrictMode>,
);
