export const LAYOUT_EDIT_PANEL_SURFACE_CLASS =
  "rounded-xl border bg-background/95 shadow-lg backdrop-blur-sm";

export const LAYOUT_EDIT_PANEL_BODY_CLASS = "flex flex-col gap-1 p-2";

export const LAYOUT_EDIT_SIDEBAR_PANEL_BODY_CLASS = "flex flex-col gap-1";

export const LAYOUT_EDIT_SIDEBAR_CLASS = "px-4 pt-4";

export const LAYOUT_EDIT_PANEL_CLASS = `${LAYOUT_EDIT_PANEL_SURFACE_CLASS} ${LAYOUT_EDIT_PANEL_BODY_CLASS}`;

export const LAYOUT_EDIT_PANEL_WIDTH_CLASS = "w-40";

export const LAYOUT_EDIT_TOOL_BTN_CLASS =
  "inline-flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function layoutComponentHighlightClass(active?: boolean) {
  return active
    ? "bg-primary/5 outline outline-2 -outline-offset-2 outline-solid outline-primary transition-[outline-color,background-color]"
    : undefined;
}
