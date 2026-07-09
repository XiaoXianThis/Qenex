"use client";

import { css } from "@codemirror/lang-css";
import type { Extension } from "@codemirror/state";
import { color } from "@uiw/codemirror-extensions-color";
import CodeMirror from "@uiw/react-codemirror";
import {
  extractComponentCss,
  replaceComponentCss,
  selectActiveCustomCss,
  selectActiveThemeCss,
  STYLE_THEME_PRESETS,
  styleActions,
  styleStore,
  useStyleStore,
} from "@qenex/core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useState, type FC } from "react";

const STYLE_EDITOR_EXTENSIONS: Extension[] = [css(), color];

export const ComponentStyleDialog: FC = () => {
  const target = useStyleStore((s) => s.componentStyleEdit);
  const themeCss = useStyleStore(selectActiveThemeCss);
  const editorTheme =
    themeCss.trim() === STYLE_THEME_PRESETS.dark.css.trim() ? "dark" : "light";

  const [draft, setDraft] = useState("");

  // 仅在打开/切换目标时载入，避免应用后 customCss 变化冲掉编辑中内容
  useEffect(() => {
    if (!target) {
      setDraft("");
      return;
    }
    const latest = selectActiveCustomCss(styleStore);
    setDraft(extractComponentCss(latest, target.id, target.selector));
  }, [target]);

  const open = target != null;

  const applyToCustomCss = (nextComponentCss: string) => {
    if (!target) return;
    const base = selectActiveCustomCss(styleStore);
    const next = replaceComponentCss(
      base,
      target.id,
      target.selector,
      nextComponentCss,
    );
    styleActions.setCustomCss(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) styleActions.closeComponentStyleEdit();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(92dvh,720px)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 gap-1 border-b border-border px-5 py-4 text-start">
          <DialogTitle>
            编辑样式{target ? ` · ${target.label}` : ""}
          </DialogTitle>
          <DialogDescription>
            仅修改该组件在自定义 CSS 中的段落，其它内容保持不变。选择器：
            <code className="ms-1 rounded bg-muted px-1 py-0.5 text-[11px]">
              {target?.selector}
            </code>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
          <div className="overflow-hidden rounded-md border border-border">
            <CodeMirror
              value={draft}
              height="360px"
              theme={editorTheme}
              extensions={STYLE_EDITOR_EXTENSIONS}
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
              }}
              className="text-[13px] [&_.cm-scroller]:overflow-auto"
              onChange={setDraft}
            />
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-5 py-3 sm:justify-end">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => styleActions.closeComponentStyleEdit()}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                applyToCustomCss(draft);
                styleActions.closeComponentStyleEdit();
              }}
            >
              应用
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
