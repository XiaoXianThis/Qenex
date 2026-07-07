import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@qenex/ui";
import "@qenex/ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
