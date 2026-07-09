"use client";

import { LAYOUT_EDIT_TOOL_BTN_CLASS } from "@/layout/layoutEditPanel";
import { cn, layoutActions } from "@qenex/core";
import { Check, RotateCcw, X } from "lucide-react";
import type { FC } from "react";

const toolBtnClass = LAYOUT_EDIT_TOOL_BTN_CLASS;

/** 布局编辑区：恢复默认 */
export const LayoutEditPanelControls: FC = () => {
  const resetToDefault = layoutActions.resetToDefault;

  return (
    <button
      type="button"
      onClick={resetToDefault}
      className={cn(
        toolBtnClass,
        "hover:bg-foreground/10 active:bg-foreground/15",
      )}
    >
      <RotateCcw className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">恢复默认</span>
    </button>
  );
};

/** 侧栏底部：应用 / 放弃 */
export const LayoutEditFooterControls: FC = () => {
  const setEditMode = layoutActions.setEditMode;
  const cancelEditMode = layoutActions.cancelEditMode;
  const footerBtnClass = cn(toolBtnClass, "py-3");

  return (
    <>
      <button
        type="button"
        onClick={() => setEditMode(false)}
        className={cn(
          footerBtnClass,
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        )}
      >
        <Check className="h-4 w-4 shrink-0" />
        <span className="truncate">应用</span>
      </button>

      <button
        type="button"
        onClick={() => cancelEditMode()}
        className={cn(
          footerBtnClass,
          "hover:bg-foreground/10 active:bg-foreground/15",
        )}
      >
        <X className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">退出</span>
      </button>
    </>
  );
};
