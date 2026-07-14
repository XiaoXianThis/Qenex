"use client";

import {
  getPanelDefinition,
  layoutActions,
  panelIdFromPuckType,
  resolveStyleComponentTarget,
  styleActions,
  useLayoutStore,
  type PanelId,
} from "@qenex/core";
import { ActionBar, createUsePuck } from "@puckeditor/core";
import { Eye, EyeOff, Maximize2, PaintbrushVertical } from "lucide-react";
import type { FC, ReactNode, SyntheticEvent } from "react";

const usePuck = createUsePuck();

type LayoutPanelActionBarProps = {
  label?: string;
  parentAction?: ReactNode;
  children?: ReactNode;
};

export const LayoutPanelActionBar: FC<LayoutPanelActionBarProps> = ({
  label,
  parentAction,
  children,
}) => {
  const selectedType = usePuck((s) => s.selectedItem?.type ?? null);
  const selectedInstanceId = usePuck((s) => {
    const id = s.selectedItem?.props?.id;
    return typeof id === "string" ? id : null;
  });
  const panelId = selectedType
    ? (panelIdFromPuckType(selectedType) as PanelId | null)
    : null;
  const styleSession = resolveStyleComponentTarget(
    selectedType,
    selectedInstanceId,
  );

  const visible = useLayoutStore((s) =>
    panelId ? s.panels[panelId].visible : true,
  );
  const widthScope = useLayoutStore((s) =>
    panelId ? s.panels[panelId].widthScope : "content",
  );
  const setPanelVisible = layoutActions.setPanelVisible;
  const cyclePanelWidthScope = layoutActions.cyclePanelWidthScope;

  const def = panelId ? getPanelDefinition(panelId) : null;
  const canToggleVisibility = def?.hideable ?? false;
  const canCycleWidth = (def?.resizableWidthScope.length ?? 0) > 1;

  const stop = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <ActionBar>
      <ActionBar.Group>
        {parentAction}
        {label ? <ActionBar.Label label={label} /> : null}
      </ActionBar.Group>
      <ActionBar.Group>
        {styleSession ? (
          <ActionBar.Action
            label="编辑样式"
            onClick={(e) => {
              stop(e);
              styleActions.openComponentStyleEdit(styleSession);
            }}
          >
            <PaintbrushVertical size={16} />
          </ActionBar.Action>
        ) : null}
        {panelId && canCycleWidth ? (
          <ActionBar.Action
            label={`宽度: ${widthScope}`}
            onClick={(e) => {
              stop(e);
              cyclePanelWidthScope(panelId);
            }}
          >
            <Maximize2 size={16} />
          </ActionBar.Action>
        ) : null}
        {panelId && canToggleVisibility ? (
          <ActionBar.Action
            label={visible ? "隐藏" : "显示"}
            onClick={(e) => {
              stop(e);
              setPanelVisible(panelId, !visible);
            }}
          >
            {visible ? <Eye size={16} /> : <EyeOff size={16} />}
          </ActionBar.Action>
        ) : null}
        {children}
      </ActionBar.Group>
    </ActionBar>
  );
};
