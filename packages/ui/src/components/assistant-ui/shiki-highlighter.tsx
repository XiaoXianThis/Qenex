"use client";

import type { FC } from "react";
import { useShikiHighlighter, type ShikiHighlighterProps } from "react-shiki/core";
import { useAui, useAuiState } from "@assistant-ui/react";
import type { SyntaxHighlighterProps as AUIProps } from "@assistant-ui/react-markdown";
import { cn } from "@qenex/core";
import {
  PlainCode,
  shikiContainerClassName,
} from "@/components/assistant-ui/code-block-fallback";
import {
  SHIKI_THEME,
  useCoreHighlighter,
  type CoreHighlighter,
} from "@/components/assistant-ui/shiki-core";
import { resolveShikiLang } from "@/components/assistant-ui/shiki-langs";

/**
 * Props for the SyntaxHighlighter component
 */
export type HighlighterProps = Omit<
  ShikiHighlighterProps,
  "children" | "theme"
> & {
  theme?: ShikiHighlighterProps["theme"];
} & Pick<AUIProps, "language" | "code"> &
  Partial<Pick<AUIProps, "node" | "components">>;

const HighlightedCode: FC<{
  code: string;
  language: string;
  theme: NonNullable<HighlighterProps["theme"]>;
  options: Omit<ShikiHighlighterProps, "children" | "language" | "theme">;
  highlighter: CoreHighlighter;
}> = ({ code, language, theme, options, highlighter }) => {
  const highlighted = useShikiHighlighter(code, language, theme, {
    ...options,
    highlighter,
    defaultColor: "light-dark()",
  });
  return <>{highlighted ?? <PlainCode code={code} />}</>;
};

/**
 * SyntaxHighlighter component, using react-shiki/core with a small lang set.
 * Use it by passing to `defaultComponents` in `markdown-text.tsx`
 *
 * Skips tokenization while the message part is streaming and renders the
 * plain code in the same container, so streaming costs no Shiki work and
 * settling is a color change rather than a layout shift.
 */
export const SyntaxHighlighter: FC<HighlighterProps> = ({
  code,
  language,
  theme = SHIKI_THEME,
  className,
  style,
  // Inert: useShikiHighlighter output has no default styles or language label.
  addDefaultStyles: _addDefaultStyles,
  showLanguage: _showLanguage,
  delay = 150, // the part settles before smooth streaming finishes draining, so code keeps changing for a few frames
  node: _node,
  components: _components,
  ...options
}) => {
  const aui = useAui();
  const hasPart = aui.part.source !== null;
  const isStreaming = useAuiState(
    (s) => hasPart && s.part.status.type === "running",
  );
  const trimmed = code.trim();
  const resolvedLang = resolveShikiLang(
    typeof language === "string" ? language : undefined,
  );
  const highlighter = useCoreHighlighter();

  return (
    <div
      className={cn(
        shikiContainerClassName,
        isStreaming && "aui-shiki-streaming",
        className,
      )}
      style={style}
    >
      {isStreaming || !highlighter ? (
        <PlainCode code={trimmed} />
      ) : (
        <HighlightedCode
          code={trimmed}
          language={resolvedLang}
          theme={theme}
          highlighter={highlighter}
          options={{ ...options, delay }}
        />
      )}
    </div>
  );
};

SyntaxHighlighter.displayName = "SyntaxHighlighter";
