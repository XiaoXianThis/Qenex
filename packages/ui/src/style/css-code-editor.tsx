"use client";

import { css } from "@codemirror/lang-css";
import type { Extension } from "@codemirror/state";
import { color } from "@uiw/codemirror-extensions-color";
import CodeMirror from "@uiw/react-codemirror";
import type { FC } from "react";

/** 模块级稳定引用，避免编辑器因 extensions 重建而闪烁 */
const STYLE_EDITOR_EXTENSIONS: Extension[] = [css(), color];

type CssEditorProps = {
  value: string;
  theme: "light" | "dark";
  height: string;
  onChange: (value: string) => void;
};

export const CssEditor: FC<CssEditorProps> = ({
  value,
  theme,
  height,
  onChange,
}) => (
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
