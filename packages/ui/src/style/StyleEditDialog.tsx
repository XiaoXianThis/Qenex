"use client";

import { css } from "@codemirror/lang-css";
import type { Extension } from "@codemirror/state";
import { color } from "@uiw/codemirror-extensions-color";
import CodeMirror from "@uiw/react-codemirror";
import {
  selectActiveCustomCss,
  selectActiveThemeCss,
  STYLE_THEME_PRESETS,
  styleActions,
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
import type { FC } from "react";

/** 模块级稳定引用，避免编辑器因 extensions 重建而闪烁 */
const STYLE_EDITOR_EXTENSIONS: Extension[] = [css(), color];

type CssEditorProps = {
  value: string;
  theme: "light" | "dark";
  height: string;
  onChange: (value: string) => void;
};

const CssEditor: FC<CssEditorProps> = ({ value, theme, height, onChange }) => (
  <div className="overflow-hidden rounded-md border border-border">
    <CodeMirror
      value={value}
      height={height}
      theme={theme}
      extensions={STYLE_EDITOR_EXTENSIONS}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
      }}
      className="text-[13px] [&_.cm-scroller]:overflow-auto"
      onChange={onChange}
    />
  </div>
);

export const StyleEditDialog: FC = () => {
  const open = useStyleStore((s) => s.editMode);
  const themeCss = useStyleStore(selectActiveThemeCss);
  const customCss = useStyleStore(selectActiveCustomCss);
  const editorTheme =
    themeCss.trim() === STYLE_THEME_PRESETS.dark.css.trim() ? "dark" : "light";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) styleActions.cancelEditMode();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(92dvh,820px)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 gap-1 border-b border-border px-5 py-4 text-start">
          <DialogTitle>CSS 编辑</DialogTitle>
          <DialogDescription>
            上方为主题 CSS（随主题切换）；下方为自定义 CSS（不随主题变化，优先级更高）。
            均支持 :root 与 [data-layout-panel]。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <section className="flex flex-col gap-2">
            <div className="text-xs font-medium text-foreground">主题 CSS</div>
            <CssEditor
              value={themeCss}
              theme={editorTheme}
              height="220px"
              onChange={(value) => styleActions.updateDraftThemeCss(value)}
            />
          </section>

          <section className="flex flex-col gap-2">
            <div className="text-xs font-medium text-foreground">自定义 CSS</div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              切换亮/暗主题不会覆盖此处内容；声明会覆盖主题 CSS。
            </p>
            <CssEditor
              value={customCss}
              theme={editorTheme}
              height="220px"
              onChange={(value) => styleActions.updateDraftCustomCss(value)}
            />
          </section>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-5 py-3 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => styleActions.resetToDefault()}
          >
            恢复默认
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => styleActions.cancelEditMode()}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => styleActions.setEditMode(false)}
            >
              完成
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
