"use client";

import { useEffect, useState } from "react";
import {
  createHighlighterCore,
  createOnigurumaEngine,
} from "react-shiki/core";

export type CoreHighlighter = Awaited<ReturnType<typeof createHighlighterCore>>;

export const SHIKI_THEME = {
  dark: "github-dark-default",
  light: "github-light-default",
} as const;

let highlighterPromise: Promise<CoreHighlighter> | null = null;

export function getCoreHighlighter(): Promise<CoreHighlighter> {
  highlighterPromise ??= createHighlighterCore({
    themes: [
      import("@shikijs/themes/github-dark-default"),
      import("@shikijs/themes/github-light-default"),
    ],
    langs: [
      import("@shikijs/langs/typescript"),
      import("@shikijs/langs/tsx"),
      import("@shikijs/langs/javascript"),
      import("@shikijs/langs/jsx"),
      import("@shikijs/langs/json"),
      import("@shikijs/langs/css"),
      import("@shikijs/langs/html"),
      import("@shikijs/langs/markdown"),
      import("@shikijs/langs/bash"),
      import("@shikijs/langs/python"),
      import("@shikijs/langs/rust"),
      import("@shikijs/langs/go"),
      import("@shikijs/langs/yaml"),
      import("@shikijs/langs/toml"),
      import("@shikijs/langs/sql"),
      import("@shikijs/langs/diff"),
      import("@shikijs/langs/xml"),
      import("@shikijs/langs/java"),
      import("@shikijs/langs/c"),
      import("@shikijs/langs/cpp"),
      import("@shikijs/langs/jsonc"),
      import("@shikijs/langs/dockerfile"),
      import("@shikijs/langs/scss"),
    ],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });
  return highlighterPromise;
}

export function useCoreHighlighter(): CoreHighlighter | null {
  const [highlighter, setHighlighter] = useState<CoreHighlighter | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getCoreHighlighter().then((next) => {
      if (!cancelled) setHighlighter(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return highlighter;
}
