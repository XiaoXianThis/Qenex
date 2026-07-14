"use client";

import {
  DEFAULT_AGENT_ICON,
  getAgentIconCandidates,
  resolveLocalIconComponent,
  type AgentSvgIcon,
} from "@/config/agent-icons";
import { cn } from "@qenex/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ImgHTMLAttributes,
  type SVGProps,
  type SyntheticEvent,
} from "react";

type AgentIconProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt"
> & {
  agentId: string;
  remoteIcon?: string | null;
  alt?: string;
  /**
   * 本地 SVG 用 React 组件（默认 true）。
   * false 时强制走 img（PNG / 远程）。
   */
  adaptiveColor?: boolean;
  /**
   * 着色方式：
   * - foreground：主题主文字色（默认）
   * - contrast：按最近不透明背景明暗，黑或白
   * - inherit：继承父级 color
   */
  ink?: "foreground" | "contrast" | "inherit";
};

type Rgba = { r: number; g: number; b: number; a: number };

let colorProbeCtx: CanvasRenderingContext2D | null | undefined;

function getColorProbeCtx(): CanvasRenderingContext2D | null {
  if (colorProbeCtx !== undefined) return colorProbeCtx;
  if (typeof document === "undefined") {
    colorProbeCtx = null;
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  colorProbeCtx = canvas.getContext("2d", { willReadFrequently: true });
  return colorProbeCtx;
}

function parseRgbLike(color: string): Rgba | null {
  if (!color || color === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const rgbaMatch = color.match(
    /rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i,
  );
  if (rgbaMatch) {
    const aRaw = rgbaMatch[4];
    let a = 1;
    if (aRaw != null) {
      a = aRaw.endsWith("%") ? parseFloat(aRaw) / 100 : parseFloat(aRaw);
    }
    return { r: +rgbaMatch[1]!, g: +rgbaMatch[2]!, b: +rgbaMatch[3]!, a };
  }

  const hex = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) {
      h = [...h].map((c) => c + c).join("");
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

/**
 * 把任意 CSS 颜色（含 oklch）转成 sRGB。
 * 新版 Chrome 的 canvas.fillStyle / getComputedStyle 都会保留 oklch 字符串，
 * 所以用 1×1 像素绘制再 readImageData。
 */
function cssColorToRgba(color: string): Rgba | null {
  const direct = parseRgbLike(color);
  if (direct) return direct;

  const ctx = getColorProbeCtx();
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return { r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]! / 255 };
  } catch {
    return null;
  }
}

function relativeLuminance(r: number, g: number, b: number): number {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/** WCAG：背景相对亮度 > 0.179 → 黑，否则白 */
function contrastingInk(backgroundColor: string): "#000" | "#fff" {
  const parsed = cssColorToRgba(backgroundColor);
  if (!parsed || parsed.a < 0.08) return "#fff";
  return relativeLuminance(parsed.r, parsed.g, parsed.b) > 0.179
    ? "#000"
    : "#fff";
}

function resolveOpaqueBackground(el: Element): string {
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    const parsed = cssColorToRgba(bg);
    if (parsed && parsed.a >= 0.5) return bg;
    node = node.parentElement;
  }
  return getComputedStyle(document.body).backgroundColor || "rgb(255, 255, 255)";
}

/**
 * Agent icon: bundled SVG → React 组件；
 * PNG / 远程 URL → img fallback。
 */
export function AgentIcon({
  agentId,
  remoteIcon,
  className,
  alt = "",
  adaptiveColor = true,
  ink = "foreground",
  onError,
  style,
  ...rest
}: AgentIconProps) {
  const LocalSvg = adaptiveColor
    ? resolveLocalIconComponent(agentId)
    : undefined;

  const candidates = getAgentIconCandidates(agentId, remoteIcon);
  const [index, setIndex] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [contrastColor, setContrastColor] = useState<"#000" | "#fff">("#fff");
  const measureRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setIndex(0);
    setExhausted(false);
  }, [agentId, remoteIcon]);

  useLayoutEffect(() => {
    if (ink !== "contrast") return;
    const node = measureRef.current;
    if (!node) return;

    const update = () => {
      setContrastColor(contrastingInk(resolveOpaqueBackground(node)));
    };
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [ink, agentId, LocalSvg, index, exhausted]);

  const handleError = useCallback(
    (event: SyntheticEvent<HTMLImageElement, Event>) => {
      onError?.(event);
      setIndex((current) => {
        if (current + 1 < candidates.length) return current + 1;
        setExhausted(true);
        return current;
      });
    },
    [candidates.length, onError],
  );

  const colorStyle: CSSProperties | undefined =
    ink === "contrast" ? { ...style, color: contrastColor } : style;

  const renderSvg = (Comp: AgentSvgIcon) => {
    const svgProps = rest as SVGProps<SVGSVGElement>;
    if (ink === "contrast") {
      return (
        <span
          ref={measureRef}
          className={cn(
            "inline-flex shrink-0 items-center justify-center",
            className,
          )}
          style={colorStyle}
        >
          <Comp
            {...svgProps}
            aria-label={alt || undefined}
            aria-hidden={alt ? undefined : true}
            className="size-full max-h-full max-w-full"
          />
        </span>
      );
    }
    return (
      <Comp
        {...svgProps}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={cn(
          "shrink-0",
          ink === "foreground" && "text-foreground",
          className,
        )}
        style={style}
      />
    );
  };

  if (LocalSvg) return renderSvg(LocalSvg);
  if (exhausted || candidates.length === 0) {
    return renderSvg(DEFAULT_AGENT_ICON);
  }

  const src = candidates[index];
  if (!src) return renderSvg(DEFAULT_AGENT_ICON);

  return (
    <span
      ref={ink === "contrast" ? measureRef : undefined}
      className={cn("inline-flex shrink-0", className)}
    >
      <img
        {...rest}
        src={src}
        alt={alt}
        className="size-full object-contain"
        style={
          ink === "contrast"
            ? {
                ...style,
                filter: contrastColor === "#fff" ? "invert(1)" : undefined,
              }
            : style
        }
        onError={handleError}
      />
    </span>
  );
}
