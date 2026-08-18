import { describe, expect, test } from "bun:test";
import { hydrateHostAppState } from "./HostContext.tsx";

describe("hydrateHostAppState", () => {
  test("does not await discover before finishing", async () => {
    let discoverResolved = false;
    let merged = false;
    let agentsHydrated = false;
    let parallelHydrated = false;
    let tabEnsured = false;

    let resolveDiscover: (value: { agents: [] }) => void = () => {};
    const discoverPending = new Promise<{ agents: [] }>((resolve) => {
      resolveDiscover = resolve;
    });

    const finished = hydrateHostAppState({
      hydrateAgents: async () => {
        agentsHydrated = true;
      },
      discoverAgents: () => discoverPending,
      mergeDetectedAgents: () => {
        merged = true;
      },
      hydrateParallelStores: async () => {
        parallelHydrated = true;
      },
      ensureInitialTab: async () => {
        tabEnsured = true;
      },
    });

    await finished;
    expect(agentsHydrated).toBe(true);
    expect(parallelHydrated).toBe(true);
    expect(tabEnsured).toBe(true);
    expect(discoverResolved).toBe(false);
    expect(merged).toBe(false);

    discoverResolved = true;
    resolveDiscover({ agents: [] });
    await discoverPending;
    await Promise.resolve();
    expect(merged).toBe(true);
  });

  test("discover failure is ignored", async () => {
    await hydrateHostAppState({
      hydrateAgents: async () => {},
      discoverAgents: async () => {
        throw new Error("bridge starting");
      },
      mergeDetectedAgents: () => {
        throw new Error("should not merge");
      },
      hydrateParallelStores: async () => {},
      ensureInitialTab: async () => {},
    });
  });
});
