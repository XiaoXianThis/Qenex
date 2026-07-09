import {
  getPanelDefinition,
  PANEL_REGISTRY,
} from "../layout/panel-registry.ts";
import { panelIdFromPuckType } from "../layout/puck-data.ts";
import type { PanelId } from "../layout/types.ts";

/** 可单独编辑 CSS 的组件目标 */
export type StyleComponentTarget = {
  id: string;
  label: string;
  /** 写入自定义 CSS 时使用的主选择器 */
  selector: string;
};

const LAYOUT_COMPONENT_LABELS: Record<string, string> = {
  LayoutRow: "行",
  LayoutColumn: "列",
  "root.top": "顶部",
  "root.bottom": "底部",
};

function markerStart(id: string): string {
  return `/* === agent-center:component ${id} === */`;
}

function markerEnd(id: string): string {
  return `/* === /agent-center:component ${id} === */`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 面板 → `[data-layout-panel]`；布局容器 → `[data-layout-component]` */
export function styleComponentSelector(id: string): string {
  if (id in PANEL_REGISTRY) {
    return `[data-layout-panel="${id}"]`;
  }
  return `[data-layout-component="${id}"]`;
}

function targetForPanelId(panelId: PanelId): StyleComponentTarget {
  return {
    id: panelId,
    label: getPanelDefinition(panelId).label,
    selector: styleComponentSelector(panelId),
  };
}

/** 由 Puck selectedItem.type（TabBar / LayoutRow / root.top…）解析目标 */
export function resolveStyleComponentTarget(
  selectedType: string | null | undefined,
): StyleComponentTarget | null {
  if (!selectedType) return null;

  if (selectedType in PANEL_REGISTRY) {
    return targetForPanelId(selectedType as PanelId);
  }

  const fromPuck = panelIdFromPuckType(selectedType);
  if (fromPuck) return targetForPanelId(fromPuck);

  if (selectedType in LAYOUT_COMPONENT_LABELS) {
    return {
      id: selectedType,
      label: LAYOUT_COMPONENT_LABELS[selectedType]!,
      selector: styleComponentSelector(selectedType),
    };
  }

  return null;
}

export function defaultComponentCss(selector: string): string {
  return `${selector} {\n  \n}\n`;
}

type CssRuleRange = {
  start: number;
  end: number;
  selector: string;
  full: string;
};

/** 跳过 /* *\/ 与 // 行注释、字符串，找到下一个非空白索引 */
function skipTrivia(css: string, from: number): number {
  let i = from;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (ch === "/" && css[i + 1] === "/") {
      const end = css.indexOf("\n", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    break;
  }
  return i;
}

function skipString(css: string, from: number): number {
  const quote = css[from]!;
  let i = from + 1;
  while (i < css.length) {
    if (css[i] === "\\") {
      i += 2;
      continue;
    }
    if (css[i] === quote) return i + 1;
    i += 1;
  }
  return css.length;
}

/** 从 `{` 起找到匹配的 `}`（忽略字符串与注释） */
function scanBalancedBlock(css: string, openBrace: number): number {
  let depth = 0;
  let i = openBrace;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === "'" || ch === '"') {
      i = skipString(css, i);
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      i += 1;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  return css.length;
}

/**
 * 扫描顶层规则（不含 @media 等 at-rule 内部）。
 * 用于把已有的未标记面板规则迁入组件编辑器。
 */
export function findTopLevelRules(css: string): CssRuleRange[] {
  const rules: CssRuleRange[] = [];
  let i = 0;
  while (i < css.length) {
    i = skipTrivia(css, i);
    if (i >= css.length) break;

    // 跳过 at-rule（整段，含块或到分号）
    if (css[i] === "@") {
      const brace = css.indexOf("{", i);
      const semi = css.indexOf(";", i);
      if (brace !== -1 && (semi === -1 || brace < semi)) {
        i = scanBalancedBlock(css, brace);
      } else {
        i = semi === -1 ? css.length : semi + 1;
      }
      continue;
    }

    const selStart = i;
    let j = i;
    while (j < css.length) {
      const ch = css[j]!;
      if (ch === "'" || ch === '"') {
        j = skipString(css, j);
        continue;
      }
      if (ch === "/" && css[j + 1] === "*") {
        const end = css.indexOf("*/", j + 2);
        j = end === -1 ? css.length : end + 2;
        continue;
      }
      if (ch === "{") break;
      j += 1;
    }
    if (j >= css.length || css[j] !== "{") {
      i = j + 1;
      continue;
    }

    const selector = css.slice(selStart, j).trim();
    const end = scanBalancedBlock(css, j);
    const full = css.slice(selStart, end);
    rules.push({ start: selStart, end, selector, full });
    i = end;
  }
  return rules;
}

function selectorTargetsComponent(selector: string, componentSelector: string): boolean {
  // 选择器中出现完整挂点即视为该组件相关（含后代：`[data-layout-panel="x"] .foo`）
  return selector.includes(componentSelector);
}

function findMarkedBlockRange(
  css: string,
  id: string,
): { start: number; end: number; body: string } | null {
  const startToken = markerStart(id);
  const endToken = markerEnd(id);
  const start = css.indexOf(startToken);
  if (start === -1) return null;
  const bodyStart = start + startToken.length;
  const end = css.indexOf(endToken, bodyStart);
  if (end === -1) return null;
  const body = css.slice(bodyStart, end).replace(/^\n/, "").replace(/\n$/, "");
  const rangeEnd = end + endToken.length;
  // 吞掉结束标记后的一个换行，避免留下空行堆积
  const absEnd =
    css[rangeEnd] === "\n" ? rangeEnd + 1 : rangeEnd;
  return { start, end: absEnd, body };
}

/** 取出组件已有 CSS（标记块优先；否则收集匹配的顶层规则；都没有则给空模板） */
export function extractComponentCss(
  customCss: string,
  id: string,
  selector: string,
): string {
  const marked = findMarkedBlockRange(customCss, id);
  if (marked) {
    return marked.body.endsWith("\n") ? marked.body : `${marked.body}\n`;
  }

  const matched = findTopLevelRules(customCss).filter((r) =>
    selectorTargetsComponent(r.selector, selector),
  );
  if (matched.length > 0) {
    return `${matched.map((r) => r.full.trimEnd()).join("\n\n")}\n`;
  }

  return defaultComponentCss(selector);
}

function removeRange(css: string, start: number, end: number): string {
  return css.slice(0, start) + css.slice(end);
}

function collapseExtraBlankLines(css: string): string {
  return css.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

/**
 * 将组件 CSS 写回自定义 CSS：只替换该组件标记块 / 匹配规则，其余原文保留。
 * `nextCss` 为空（或仅空白）时删除该组件段落。
 */
export function replaceComponentCss(
  customCss: string,
  id: string,
  selector: string,
  nextCss: string,
): string {
  let rest = customCss;

  const marked = findMarkedBlockRange(rest, id);
  if (marked) {
    rest = removeRange(rest, marked.start, marked.end);
  }

  // 反复移除匹配的顶层规则（索引会变）
  for (;;) {
    const hit = findTopLevelRules(rest).find((r) =>
      selectorTargetsComponent(r.selector, selector),
    );
    if (!hit) break;
    rest = removeRange(rest, hit.start, hit.end);
  }

  rest = collapseExtraBlankLines(rest);
  const trimmed = nextCss.trim();
  if (!trimmed) {
    return rest ? `${rest}\n` : "";
  }

  // 若用户没写选择器，包一层默认挂点，避免写飘
  const body = trimmed.includes("{")
    ? trimmed
    : `${selector} {\n${trimmed}\n}`;

  const block = `${markerStart(id)}\n${body}\n${markerEnd(id)}`;
  if (!rest) return `${block}\n`;
  return `${rest}\n\n${block}\n`;
}

/** 检测自定义 CSS 中是否已有该组件样式（标记或匹配规则） */
export function hasComponentCss(
  customCss: string,
  id: string,
  selector: string,
): boolean {
  if (findMarkedBlockRange(customCss, id)) return true;
  return findTopLevelRules(customCss).some((r) =>
    selectorTargetsComponent(r.selector, selector),
  );
}

export function componentMarkerPattern(id: string): RegExp {
  return new RegExp(
    `${escapeRegExp(markerStart(id))}[\\s\\S]*?${escapeRegExp(markerEnd(id))}`,
  );
}
