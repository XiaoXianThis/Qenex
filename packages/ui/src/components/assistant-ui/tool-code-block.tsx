"use client";

import type { FC } from "react";
import { useShikiHighlighter } from "react-shiki/core";
import { cn } from "@qenex/core";
import { PlainCode } from "@/components/assistant-ui/code-block-fallback";
import {
  SHIKI_THEME,
  useCoreHighlighter,
  type CoreHighlighter,
} from "@/components/assistant-ui/shiki-core";
import { resolveShikiLang } from "@/components/assistant-ui/shiki-langs";
import {
  prettifyToolCodeText,
  truncateText,
  type ToolViewKind,
} from "@/components/assistant-ui/tool-call-format";

const toolCodeBlockClassName =
  "aui-tool-code-block [&_pre]:m-0 [&_pre]:overflow-visible [&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:font-mono [&_pre]:text-[11px] [&_pre]:leading-[1.55] [&_pre]:whitespace-pre-wrap [&_pre]:break-all [&_code]:font-mono [&_code]:text-[11px] [&_code]:leading-[1.55]";

const HighlightedToolCode: FC<{
  code: string;
  language: string;
  highlighter: CoreHighlighter;
}> = ({ code, language, highlighter }) => {
  const highlighted = useShikiHighlighter(code, language, SHIKI_THEME, {
    highlighter,
    defaultColor: "light-dark()",
  });
  return <>{highlighted ?? <PlainCode code={code} />}</>;
};

export type ToolCodeBlockProps = {
  text: string;
  language?: string;
  kind?: ToolViewKind;
  path?: string;
  streaming?: boolean;
  className?: string;
};

export const ToolCodeBlock: FC<ToolCodeBlockProps> = ({
  text,
  language,
  kind,
  path,
  streaming = false,
  className,
}) => {
  const { text: shown, truncated } = truncateText(text);
  const { text: displayText, language: resolvedLanguage } = prettifyToolCodeText(
    shown,
    language,
    { kind, path },
  );
  const lang = resolveShikiLang(resolvedLanguage);
  const highlighter = useCoreHighlighter();
  const usePlain = streaming || !highlighter || lang === "text";

  return (
    <div className={cn("font-mono text-[11px] leading-[1.55]", className)}>
      <div className={cn(toolCodeBlockClassName, streaming && "opacity-90")}>
        {usePlain ? (
          <PlainCode code={displayText} />
        ) : (
          <HighlightedToolCode
            code={displayText}
            language={lang}
            highlighter={highlighter}
          />
        )}
      </div>
      {truncated ? (
        <div className="text-muted-foreground px-3 py-1.5 text-[10px]">
          … 已截断
        </div>
      ) : null}
    </div>
  );
};
