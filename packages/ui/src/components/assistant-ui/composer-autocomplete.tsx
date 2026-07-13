"use client";

import {
  listWorkspaceFiles,
  useTabsStore,
  type WorkspaceFileItem,
} from "@qenex/core";
import { useComposerRuntime } from "@assistant-ui/react";
import { FileIcon, FolderIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FC,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

type ComposerAutocompleteProps = {
  children: ReactNode;
};

/** Detect `@query` at caret (word-boundary). Returns start index of `@`. */
function parseMention(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = before.match(/(?:^|[\s([{"'])@([^\s]*)$/);
  if (!match || match.index == null) return null;
  const atIndex = match[0].startsWith("@")
    ? match.index
    : match.index + 1;
  return { query: match[1] ?? "", start: atIndex };
}

function getCaret(el: HTMLElement | null, fallback: number): number {
  if (
    el &&
    "selectionStart" in el &&
    typeof (el as HTMLTextAreaElement).selectionStart === "number"
  ) {
    return (el as HTMLTextAreaElement).selectionStart;
  }
  return fallback;
}

function matchesQuery(item: WorkspaceFileItem, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    item.name.toLowerCase().includes(needle) ||
    item.path.toLowerCase().includes(needle)
  );
}

export const ComposerAutocomplete: FC<ComposerAutocompleteProps> = ({
  children,
}) => {
  const composerRuntime = useComposerRuntime();
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const cwd = activeTab?.cwd ?? ".";

  const [query, setQuery] = useState("");
  const [start, setStart] = useState(-1);
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const refreshTrigger = useCallback(() => {
    const text = composerRuntime.getState().text ?? "";
    const el = wrapRef.current?.querySelector(
      "textarea, [contenteditable=true]",
    ) as HTMLElement | null;
    const caret = getCaret(el, text.length);
    const parsed = parseMention(text, caret);
    if (!parsed) {
      setOpen(false);
      setQuery("");
      setStart(-1);
      return;
    }
    setQuery(parsed.query);
    setStart(parsed.start);
    setOpen(true);
    setActiveIndex(0);
  }, [composerRuntime]);

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = query.replace(/^.*\//, "");
    const dir = query.includes("/")
      ? query.slice(0, query.lastIndexOf("/")) || "."
      : ".";
    void listWorkspaceFiles({ base: cwd, path: dir })
      .then((items) => {
        if (cancelled) return;
        const filtered = items
          .filter((item) => matchesQuery(item, q))
          .slice(0, 20);
        setFiles(filtered);
        setActiveIndex(0);
      })
      .catch((e) => {
        if (cancelled) return;
        setFiles([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, query, cwd]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-mention-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const replaceMention = (insert: string, close: boolean) => {
    if (start < 0) return;
    const text = composerRuntime.getState().text ?? "";
    const el = wrapRef.current?.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    const caret = getCaret(el, text.length);
    const next = `${text.slice(0, start)}${insert}${text.slice(caret)}`;
    composerRuntime.setText(next);
    if (close) {
      setOpen(false);
      setStart(-1);
      setQuery("");
    } else {
      queueMicrotask(refreshTrigger);
    }
  };

  const applyItem = (index: number) => {
    const item = files[index];
    if (!item) return;
    if (item.isDirectory) {
      replaceMention(`@${item.path}/`, false);
      return;
    }
    replaceMention(`@${item.path} `, true);
  };

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (!open) {
      queueMicrotask(refreshTrigger);
      return;
    }

    if (event.key === "ArrowDown") {
      if (files.length === 0) return;
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % files.length);
      return;
    }
    if (event.key === "ArrowUp") {
      if (files.length === 0) return;
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + files.length) % files.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      applyItem(activeIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    queueMicrotask(refreshTrigger);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <PopoverAnchor asChild>
        <div
          ref={wrapRef}
          className="relative flex min-h-0 w-full flex-col"
          onKeyDownCapture={onKeyDownCapture}
          onInput={refreshTrigger}
          onClick={refreshTrigger}
          onKeyUp={refreshTrigger}
        >
          {children}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-[min(100vw-2rem,22rem)] max-w-[var(--radix-popover-trigger-width,22rem)] p-1 shadow-lg"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target && wrapRef.current?.contains(target)) {
            event.preventDefault();
          }
        }}
        onFocusOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target && wrapRef.current?.contains(target)) {
            event.preventDefault();
          }
        }}
      >
        <div
          ref={listRef}
          className="flex max-h-64 flex-col overflow-y-auto"
          role="listbox"
          aria-label="引用文件"
        >
          {loading && files.length === 0 ? (
            <div className="text-muted-foreground px-3 py-2 text-xs">
              加载中…
            </div>
          ) : null}
          {error ? (
            <div className="text-destructive px-3 py-2 text-xs whitespace-pre-wrap">
              无法列出文件：{error}
            </div>
          ) : null}
          {!loading && !error && files.length === 0 ? (
            <div className="text-muted-foreground px-3 py-2 text-xs">
              没有匹配的文件
              {cwd ? (
                <span className="mt-1 block truncate opacity-70" title={cwd}>
                  工作目录：{cwd}
                </span>
              ) : null}
            </div>
          ) : null}
          {files.map((file, index) => (
            <button
              key={file.path}
              type="button"
              role="option"
              data-mention-index={index}
              aria-selected={index === activeIndex}
              className={`hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${
                index === activeIndex ? "bg-accent" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                applyItem(index);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {file.isDirectory ? (
                <FolderIcon className="text-muted-foreground size-3.5 shrink-0" />
              ) : (
                <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {file.name}
                {file.isDirectory ? "/" : ""}
              </span>
              <span className="text-muted-foreground max-w-[40%] shrink-0 truncate text-[10px]">
                {file.path}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
