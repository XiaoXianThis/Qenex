"use client";

import { LayoutPageRoot } from "@/layout/puck/LayoutPageRoot";
import { PanelWrapper } from "@/layout/puck/PanelWrapper";
import type { LayoutMetadata, PanelRenderContext } from "@/layout/puck/types";
import {
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
      render: ({ children: Children }) => (
        <div className="">
          <div>Row →</div>
          <Children className="flex w-full gap-2 [&>*]:min-w-0 [&>*]:flex-1 border-2 p-8" />
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
      render: ({ children: Children }) => (
        <div className="">
          <div>Colum ↓</div>
          <Children className="flex w-full flex-col gap-2 border-2 p-8" />
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
      render: ({ children: Children }) => (
        <Children className="flex w-full gap-2 [&>*]:min-w-0 [&>*]:flex-1" />
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
      render: ({ children: Children }) => (
        <Children className="flex w-full flex-col gap-2" />
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
