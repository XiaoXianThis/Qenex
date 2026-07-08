"use client";

import {
  cn,
  LAYOUT_PRESETS,
  layoutActions,
  useLayoutStore,
  type LayoutPresetId,
} from "@qenex/core";
import { Check, Pencil, RotateCcw, X } from "lucide-react";
import type { FC } from "react";

const PRESET_LABELS: Record<Exclude<LayoutPresetId, "custom">, string> = {
  classic: "经典",
  composerTop: "输入置顶",
  tabsBottom: "标签栏底部",
  minimal: "极简",
  workspace: "工作区",
};

const toolBtnClass =
  "inline-flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors";

export const LayoutEditToolbar: FC = () => {
  const editMode = useLayoutStore((s) => s.editMode);
  const preset = useLayoutStore((s) => s.preset);
  const setEditMode = layoutActions.setEditMode;
  const applyPreset = layoutActions.applyPreset;
  const resetToDefault = layoutActions.resetToDefault;
  const sessionConfigVisible = useLayoutStore(
    (s) => s.panels.sessionConfigBar.visible,
  );
  const setPanelVisible = layoutActions.setPanelVisible;

  return (
    <div
      className={cn(
        "pointer-events-none fixed top-1/2 z-50 -translate-y-1/2",
        editMode ? "left-[calc(0.75rem+11.5rem)]" : "left-3",
      )}
    >
      <div className="pointer-events-auto flex w-36 flex-col gap-1 rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setEditMode(!editMode)}
          className={cn(
            toolBtnClass,
            "text-sm",
            editMode
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted",
          )}
        >
          {editMode ? (
            <X className="h-4 w-4 shrink-0" />
          ) : (
            <Pencil className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate">{editMode ? "完成" : "编辑布局"}</span>
        </button>

        {editMode ? (
          <>
            <div className="bg-border my-0.5 h-px w-full" />

            <div className="flex flex-col gap-0.5">
              {(Object.keys(LAYOUT_PRESETS) as Array<
                Exclude<LayoutPresetId, "custom">
              >).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyPreset(id)}
                  className={cn(
                    toolBtnClass,
                    preset === id
                      ? "bg-muted font-medium"
                      : "hover:bg-muted/60",
                  )}
                >
                  {preset === id ? (
                    <Check className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{PRESET_LABELS[id]}</span>
                </button>
              ))}
            </div>

            <div className="bg-border my-0.5 h-px w-full" />

            <button
              type="button"
              onClick={resetToDefault}
              className={cn(toolBtnClass, "hover:bg-muted")}
            >
              <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">恢复默认</span>
            </button>

            <button
              type="button"
              onClick={() =>
                setPanelVisible("sessionConfigBar", !sessionConfigVisible)
              }
              className={cn(
                toolBtnClass,
                "hover:bg-muted",
                sessionConfigVisible && "bg-muted font-medium",
              )}
            >
              <span className="w-3.5 shrink-0" />
              <span className="truncate">配置栏</span>
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
};
