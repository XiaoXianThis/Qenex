"use client";

import {
  getPanelDefinition,
  panelIdFromPuckType,
  useLayoutStore,
  type PanelId,
} from "@qenex/core";
import { cn } from "@qenex/core";
import type { FC, ReactNode } from "react";
import { LayoutEditLabel } from "@/layout/puck/LayoutEditLabel";
import { layoutComponentHighlightClass } from "@/layout/layoutEditPanel";
import { WidthScopeWrapper } from "@/layout/puck/WidthScopeWrapper";
import type { PanelRenderContext } from "@/layout/puck/types";
import { renderPanel } from "@/layout/puck/panels";

type PanelWrapperProps = {
  puckType: string;
  /** Puck 实例 id，用于实例级样式挂点 */
  instanceId?: string;
  ctx: PanelRenderContext;
  children?: ReactNode;
  puck?: { isEditing?: boolean };
};

export const PanelWrapper: FC<PanelWrapperProps> = ({
  puckType,
  instanceId,
  ctx,
  children,
  puck,
}) => {
  const panelId = panelIdFromPuckType(puckType) as PanelId | null;
  if (!panelId) return null;

  const editMode = useLayoutStore((s) => s.editMode);
  const hoveredDrawerComponentType = useLayoutStore(
    (s) => s.hoveredDrawerComponentType,
  );
  const visible = useLayoutStore((s) => s.panels[panelId].visible);
  const widthScope = useLayoutStore((s) => s.panels[panelId].widthScope);

  const content = children ?? renderPanel(panelId, ctx);
  if (!content) return null;
  if (!visible && !editMode) return null;

  const isEditing = editMode || puck?.isEditing;
  const panelLabel = getPanelDefinition(panelId).label;
  const isHighlighted = hoveredDrawerComponentType === puckType;

  const wrapped = (
    <WidthScopeWrapper scope={widthScope}>{content}</WidthScopeWrapper>
  );

  if (!isEditing) {
    return (
      <div data-layout-panel={panelId} data-layout-instance={instanceId}>
        {wrapped}
      </div>
    );
  }

  return (
    <div
      data-layout-panel={panelId}
      data-layout-instance={instanceId}
      data-layout-puck-type={puckType}
      className={cn(
        "relative min-h-8 border-[1px] border-dashed transition-opacity",
        visible
          ? "border-primary/40"
          : "border-muted-foreground/30 opacity-50",
        !visible && "min-h-14",
        layoutComponentHighlightClass(isHighlighted),
      )}
    >
      <LayoutEditLabel label={panelLabel} />
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
