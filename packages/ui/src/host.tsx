import { createContext, useContext, type ReactNode } from "react";
import type { QenexHost } from "@qenex/core";

const QenexHostContext = createContext<QenexHost | null>(null);

export function QenexHostProvider({
  host,
  children,
}: {
  host: QenexHost;
  children: ReactNode;
}) {
  return (
    <QenexHostContext.Provider value={host}>{children}</QenexHostContext.Provider>
  );
}

export function useQenexHost(): QenexHost {
  const host = useContext(QenexHostContext);
  if (!host) {
    throw new Error("useQenexHost must be used within QenexHostProvider");
  }
  return host;
}
