"use client";

import {
  panelIdFromPuckType,
  useLayoutStore,
  type PanelId,
} from "@qenex/core";
import { cn } from "@qenex/core";
import type { FC, ReactNode } from "react";
import { WidthScopeWrapper } from "@/layout/puck/WidthScopeWrapper";
import type { PanelRenderContext } from "@/layout/puck/types";
import { renderPanel } from "@/layout/puck/panels";

type PanelWrapperProps = {
  puckType: string;
  ctx: PanelRenderContext;
  children?: ReactNode;
  puck?: { isEditing?: boolean };
};

export const PanelWrapper: FC<PanelWrapperProps> = ({
  puckType,
  ctx,
  children,
  puck,
}) => {
  const panelId = panelIdFromPuckType(puckType) as PanelId | null;
  if (!panelId) return null;

  const editMode = useLayoutStore((s) => s.editMode);
  const visible = useLayoutStore((s) => s.panels[panelId].visible);
  const widthScope = useLayoutStore((s) => s.panels[panelId].widthScope);

  const content = children ?? renderPanel(panelId, ctx);
  if (!content) return null;
  if (!visible && !editMode) return null;

  const isEditing = editMode || puck?.isEditing;

  const wrapped = (
    <WidthScopeWrapper scope={widthScope}>{content}</WidthScopeWrapper>
  );

  if (!isEditing) {
    return <div data-layout-panel={panelId}>{wrapped}</div>;
  }

  return (
    <div
      data-layout-panel={panelId}
      className={cn(
        "relative rounded-md border-2 border-dashed transition-opacity",
        visible
          ? "border-primary/40"
          : "border-muted-foreground/30 opacity-50",
        !visible && "min-h-14",
      )}
    >
      {visible ? (
        <div
          className="pointer-events-none select-none [&_*]:pointer-events-none"
          inert
        >
          {wrapped}
        </div>
      ) : (
        <div
          className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
          aria-hidden
        >
          {wrapped}
        </div>
      )}
    </div>
  );
};
