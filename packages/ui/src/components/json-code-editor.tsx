"use client";

import { json } from "@codemirror/lang-json";
import type { Extension } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import type { FC } from "react";

const JSON_EDITOR_EXTENSIONS: Extension[] = [json()];

type JsonCodeEditorProps = {
  value: string;
  theme: "light" | "dark";
  height?: string;
  onChange: (value: string) => void;
};

export const JsonCodeEditor: FC<JsonCodeEditorProps> = ({
  value,
  theme,
  height = "360px",
  onChange,
}) => (
  <div className="overflow-hidden rounded-md border border-border">
    <CodeMirror
      value={value}
      height={height}
      theme={theme}
      extensions={JSON_EDITOR_EXTENSIONS}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
      }}
      className="text-[13px] [&_.cm-scroller]:overflow-auto"
      onChange={onChange}
    />
  </div>
);
