"use client";

import { LayoutContainerSlot } from "@/layout/puck/LayoutContainerSlot";
import { LayoutPageRoot } from "@/layout/puck/LayoutPageRoot";
import { PanelWrapper } from "@/layout/puck/PanelWrapper";
import type { LayoutMetadata, PanelRenderContext } from "@/layout/puck/types";
import {
  cn,
  containerAtMaxChildDepth,
  getPanelDefinition,
  panelIdFromPuckType,
  PUCK_PANEL_TYPE,
  type PanelId,
} from "@qenex/core";
import type {
  AppState,
  Config,
  DefaultComponentProps,
  PuckComponent,
} from "@puckeditor/core";

export const LAYOUT_SLOT_ALLOW = [
  "LayoutRow",
  "LayoutColumn",
  ...Object.values(PUCK_PANEL_TYPE),
] as const;

/** Base layout on Puck slot / Children (no edit-only spacing). */
const LAYOUT_ROW_SLOT_BASE =
  "flex w-full gap-2 [&>*]:min-w-0 [&>*]:flex-1";

const LAYOUT_COLUMN_SLOT_BASE = "flex w-full flex-col gap-2";

const LAYOUT_ROOT_SLOT_BASE = "flex w-full flex-col gap-2";

const LAYOUT_CONTAINER_EDIT_PADDING = "p-4";

const LAYOUT_CONTAINER_EDIT_CLASS =
  "relative min-h-16 border-[1px] border-dashed border-primary/25";

export const LAYOUT_ROOT_TOP_LABEL = "顶部";
export const LAYOUT_ROOT_BOTTOM_LABEL = "底部";

export function layoutRootSlotClass(editing?: boolean) {
  return cn(
    LAYOUT_ROOT_SLOT_BASE,
    editing && LAYOUT_CONTAINER_EDIT_PADDING,
    editing && LAYOUT_CONTAINER_EDIT_CLASS,
  );
}

function layoutContainerSlotClass(
  type: "row" | "column",
  editing?: boolean,
) {
  return cn(
    type === "row" ? LAYOUT_ROW_SLOT_BASE : LAYOUT_COLUMN_SLOT_BASE,
    editing && LAYOUT_CONTAINER_EDIT_PADDING,
    editing && LAYOUT_CONTAINER_EDIT_CLASS,
  );
}

function panelCtx(metadata: LayoutMetadata): PanelRenderContext {
  return { shell: metadata.shell, isEmpty: false };
}

function panelConfig(puckType: string, panelId: PanelId) {
  const def = getPanelDefinition(panelId);
  const render: PuckComponent<DefaultComponentProps> = ({ puck }) => (
    <PanelWrapper
      puckType={puckType}
      ctx={panelCtx(puck.metadata as LayoutMetadata)}
      puck={puck}
    />
  );
  return {
    label: def.label,
    permissions: {
      drag: def.draggable,
      delete: def.hideable,
      duplicate: false,
    },
    render,
  };
}

function containerResolvePermissions(
  data: { props?: { id?: string } },
  params: { appState: AppState },
) {
  const id = data.props?.id;
  if (!id) return {};
  if (containerAtMaxChildDepth(params.appState.data, id)) {
    return { insert: false };
  }
  return {};
}

export type LayoutPageProps = {
  top: import("@puckeditor/core").SlotComponent;
  bottom: import("@puckeditor/core").SlotComponent;
};

export const layoutConfig_test = {
  components: {
    LayoutRow: {
      label: "行 (Row)",
      permissions: { drag: true, delete: true, duplicate: false },
      resolvePermissions: containerResolvePermissions,
      fields: {
        children: {
          type: "slot",
          allow: [...LAYOUT_SLOT_ALLOW],
        },
      },
      render: ({ children: Children, puck }) => (
        <div className="">
          <div>Row →</div>
          <LayoutContainerSlot
            label="行"
            componentType="LayoutRow"
            editing={puck.isEditing}
            className={layoutContainerSlotClass("row", puck.isEditing)}
          >
            {Children}
          </LayoutContainerSlot>
        </div>
      ),
    },
    LayoutColumn: {
      label: "列 (Column)",
      permissions: { drag: true, delete: true, duplicate: false },
      resolvePermissions: containerResolvePermissions,
      fields: {
        children: {
          type: "slot",
          allow: [...LAYOUT_SLOT_ALLOW],
        },
      },
      render: ({ children: Children, puck }) => (
        <div className="">
          <div>Colum ↓</div>
          <LayoutContainerSlot
            label="列"
            componentType="LayoutColumn"
            editing={puck.isEditing}
            className={layoutContainerSlotClass("column", puck.isEditing)}
          >
            {Children}
          </LayoutContainerSlot>
        </div>
      ),
    },
  }
}

export const layoutConfig = {
  categories: {
    layout: {
      title: "布局",
      components: ["LayoutRow", "LayoutColumn"],
    },
    panels: {
      title: "面板",
      components: Object.values(PUCK_PANEL_TYPE),
    },
  },
  root: {
    fields: {
      top: {
        type: "slot",
        allow: [...LAYOUT_SLOT_ALLOW],
      },
      bottom: {
        type: "slot",
        allow: [...LAYOUT_SLOT_ALLOW],
      },
    },
    defaultProps: {
      top: [],
      bottom: [],
    },
    render: LayoutPageRoot,
  },
  components: {
    LayoutRow: {
      label: "行 (Row)",
      permissions: { drag: true, delete: true, duplicate: false },
      resolvePermissions: containerResolvePermissions,
      fields: {
        children: {
          type: "slot",
          allow: [...LAYOUT_SLOT_ALLOW],
        },
      },
      render: ({ children: Children, puck }) => (
        <LayoutContainerSlot
          label="行"
          componentType="LayoutRow"
          editing={puck.isEditing}
          className={layoutContainerSlotClass("row", puck.isEditing)}
        >
          {Children}
        </LayoutContainerSlot>
      ),
    },
    LayoutColumn: {
      label: "列 (Column)",
      permissions: { drag: true, delete: true, duplicate: false },
      resolvePermissions: containerResolvePermissions,
      fields: {
        children: {
          type: "slot",
          allow: [...LAYOUT_SLOT_ALLOW],
        },
      },
      render: ({ children: Children, puck }) => (
        <LayoutContainerSlot
          label="列"
          componentType="LayoutColumn"
          editing={puck.isEditing}
          className={layoutContainerSlotClass("column", puck.isEditing)}
        >
          {Children}
        </LayoutContainerSlot>
      ),
    },
    TabBar: panelConfig("TabBar", "tabBar"),
    TokenStats: panelConfig("TokenStats", "tokenStats"),
    UndoRedo: panelConfig("UndoRedo", "undoRedo"),
    Composer: panelConfig("Composer", "composer"),
    FollowupSuggestions: panelConfig("FollowupSuggestions", "followupSuggestions"),
    ScrollToBottom: panelConfig("ScrollToBottom", "scrollToBottom"),
    WelcomeSuggestions: panelConfig("WelcomeSuggestions", "welcomeSuggestions"),
    Checklist: panelConfig("Checklist", "checklist"),
    Approval: panelConfig("Approval", "approval"),
  },
} satisfies Config;

export function puckTypeToPanelId(type: string): PanelId | null {
  return panelIdFromPuckType(type);
}

export type LayoutPuckRoot = {
  top: unknown;
  bottom: unknown;
};
