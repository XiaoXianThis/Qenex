"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useScrollLock } from "@assistant-ui/react";

const DEFAULT_ANIMATION_MS = 200;

type UseAutoCollapsibleOpenOptions = {
  /**
   * 自动展开条件（streaming / tool running / 审批中）。
   * 为 true 时自动展开；变 false 且用户未手动干预时自动收起。
   */
  autoOpen: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  animationDurationMs?: number;
  /**
   * 工具三态：预览时点击 → 完全展开；完全展开再点 → 收起；
   * 收起后再点 → 回到预览（autoOpen 时）或展开。
   */
  previewClickExpands?: boolean;
};

/**
 * 与 ReasoningRoot 相同语义：自动跟随 `autoOpen`，首次手动 toggle 后永久接管。
 * `isPreview`：仍处自动模式且已打开（工具默认预览 / reasoning 流式预览）。
 */
export function useAutoCollapsibleOpen({
  autoOpen,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  animationDurationMs = DEFAULT_ANIMATION_MS,
  previewClickExpands = false,
}: UseAutoCollapsibleOpenOptions) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const initialOpenRef = useRef(defaultOpen);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const lockScroll = useScrollLock(collapsibleRef, animationDurationMs);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled
    ? controlledOpen
    : (userOpen ?? autoOpen ?? initialOpenRef.current);
  const isAutoMode = !isControlled && userOpen === null;
  const isPreview = autoOpen === true && isOpen && isAutoMode;

  const prevAutoOpenRef = useRef(autoOpen);
  useLayoutEffect(() => {
    if (prevAutoOpenRef.current === autoOpen) return;
    prevAutoOpenRef.current = autoOpen;
    if (!isControlled && userOpen === null) lockScroll();
  }, [autoOpen, isControlled, userOpen, lockScroll]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      lockScroll();
      if (!isControlled) {
        if (previewClickExpands) {
          // 预览 → 完全展开
          if (isPreview && !next) {
            setUserOpen(true);
            controlledOnOpenChange?.(true);
            return;
          }
          // 完全展开 → 收起
          if (userOpen === true && !next) {
            setUserOpen(false);
            controlledOnOpenChange?.(false);
            return;
          }
          // 收起 → 回到预览（有 autoOpen）或完全展开
          if (userOpen === false && next) {
            setUserOpen(autoOpen ? null : true);
            controlledOnOpenChange?.(true);
            return;
          }
        }
        setUserOpen(next);
      }
      controlledOnOpenChange?.(next);
    },
    [
      lockScroll,
      isControlled,
      controlledOnOpenChange,
      previewClickExpands,
      isPreview,
      userOpen,
      autoOpen,
    ],
  );

  return {
    collapsibleRef,
    isOpen,
    isPreview,
    handleOpenChange,
    animationDurationMs,
  };
}
