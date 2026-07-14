import type { PanelId, WidthScope } from "./types.ts";

export type PanelKind = "anchor" | "widget" | "sub";

export type PanelDefinition = {
  id: PanelId;
  kind: PanelKind;
  defaultWidthScope: WidthScope;
  label: string;
  hideable: boolean;
  draggable: boolean;
  resizableWidthScope: WidthScope[];
};

const defs: PanelDefinition[] = [
  {
    id: "tabBar",
    kind: "anchor",
    defaultWidthScope: "viewport",
    label: "标签栏",
    hideable: true,
    draggable: true,
    resizableWidthScope: ["viewport", "content"],
  },
  {
    id: "messages",
    kind: "anchor",
    defaultWidthScope: "content",
    label: "消息",
    hideable: false,
    draggable: false,
    resizableWidthScope: ["content"],
  },
  {
    id: "composer",
    kind: "anchor",
    defaultWidthScope: "content",
    label: "输入框",
    hideable: true,
    draggable: true,
    resizableWidthScope: ["content", "viewport"],
  },
  {
    id: "followupSuggestions",
    kind: "anchor",
    defaultWidthScope: "content",
    label: "跟进建议",
    hideable: true,
    draggable: true,
    resizableWidthScope: ["content", "viewport"],
  },
  {
    id: "scrollToBottom",
    kind: "anchor",
    defaultWidthScope: "content",
    label: "滚到底部",
    hideable: true,
    draggable: true,
    resizableWidthScope: ["content", "viewport"],
  },
  {
    id: "welcomeSuggestions",
    kind: "anchor",
    defaultWidthScope: "content",
    label: "欢迎建议",
    hideable: true,
    draggable: true,
    resizableWidthScope: ["content", "viewport"],
  },
  {
    id: "sessionConfigBar",
    kind: "sub",
    defaultWidthScope: "content",
    label: "配置栏",
    hideable: true,
    draggable: false,
    resizableWidthScope: ["content"],
  },
  {
    id: "tokenStats",
    kind: "widget",
    defaultWidthScope: "viewport",
    label: "Token 统计",
    hideable: true,
    draggable: true,
    resizableWidthScope: ["viewport", "content"],
  },
  {
    id: "undoRedo",
    kind: "widget",
    defaultWidthScope: "content",
    label: "检查点",
    hideable: true,
    draggable: true,
    resizableWidthScope: ["content", "viewport"],
  },
  {
    id: "checklist",
    kind: "widget",
    defaultWidthScope: "viewport",
    label: "CheckList",
    hideable: true,
    draggable: true,
    resizableWidthScope: ["viewport", "content"],
  },
  {
    id: "approval",
    kind: "widget",
    defaultWidthScope: "viewport",
    label: "审批",
    hideable: true,
    draggable: true,
    resizableWidthScope: ["viewport", "content"],
  },
];

export const PANEL_REGISTRY: Record<PanelId, PanelDefinition> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
) as Record<PanelId, PanelDefinition>;

export const ALL_PANEL_IDS = defs.map((d) => d.id) as PanelId[];

export function getPanelDefinition(id: PanelId): PanelDefinition {
  return PANEL_REGISTRY[id];
}

export function cycleWidthScope(
  current: WidthScope,
  allowed: WidthScope[],
): WidthScope {
  if (allowed.length === 0) return current;
  const idx = allowed.indexOf(current);
  if (idx === -1) return allowed[0]!;
  return allowed[(idx + 1) % allowed.length]!;
}

export function defaultPanelMeta(id: PanelId) {
  const def = getPanelDefinition(id);
  return {
    visible: true,
    widthScope: def.defaultWidthScope,
  };
}

export function defaultAllPanelMeta(
  overrides?: Partial<Record<PanelId, Partial<{ visible: boolean; widthScope: WidthScope }>>>,
) {
  const result = {} as Record<PanelId, { visible: boolean; widthScope: WidthScope }>;
  for (const id of ALL_PANEL_IDS) {
    result[id] = {
      ...defaultPanelMeta(id),
      ...overrides?.[id],
    };
  }
  return result;
}
