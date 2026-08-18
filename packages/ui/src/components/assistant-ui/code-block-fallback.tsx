import type { CSSProperties, FC } from "react";
import { cn } from "@qenex/core";

export const shikiContainerClassName =
  "aui-shiki-base [&_pre]:border-border/50 [&_pre]:bg-muted/30! [&_.line]:px-0! [&_pre]:overflow-x-auto [&_pre]:rounded-t-none [&_pre]:rounded-b-xl [&_pre]:border [&_pre]:border-t-0 [&_pre]:p-3.5 [&_pre]:text-[13px] [&_pre]:leading-relaxed";

export const mermaidChromeClassName =
  "aui-mermaid-diagram border-border/50 bg-muted/30 flex min-h-32 items-center justify-center gap-3 overflow-x-auto rounded-t-none rounded-b-xl border border-t-0 p-3.5";

export const PlainCode: FC<{ code: string }> = ({ code }) => (
  <pre>
    <code>{code}</code>
  </pre>
);

export const ShikiPlainFallback: FC<{
  code: string;
  className?: string;
  style?: CSSProperties;
  streaming?: boolean;
}> = ({ code, className, style, streaming }) => (
  <div
    className={cn(
      shikiContainerClassName,
      streaming && "aui-shiki-streaming",
      className,
    )}
    style={style}
  >
    <PlainCode code={code} />
  </div>
);

export const MermaidSkeleton: FC<{ className?: string }> = ({ className }) => (
  <div
    data-slot="mermaid-skeleton"
    aria-label="Rendering diagram"
    className={cn(mermaidChromeClassName, "animate-pulse", className)}
  >
    <div className="bg-muted-foreground/20 h-8 w-20 rounded-md" />
    <div className="bg-muted-foreground/20 h-px w-10" />
    <div className="bg-muted-foreground/20 h-8 w-20 rounded-md" />
    <div className="bg-muted-foreground/20 h-px w-10" />
    <div className="bg-muted-foreground/20 h-8 w-20 rounded-md" />
  </div>
);
