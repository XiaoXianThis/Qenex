"use client";

import {
  LAYOUT_EDIT_PANEL_WIDTH_CLASS,
  LAYOUT_EDIT_SIDEBAR_CLASS,
  LAYOUT_EDIT_SIDEBAR_PANEL_BODY_CLASS,
} from "@/layout/layoutEditPanel";
import {
  LayoutEditFooterControls,
  LayoutEditPanelControls,
} from "@/layout/LayoutEditPanelControls";
import { LayoutThemePanel } from "@/layout/LayoutThemePanel";
import { LayoutDrawerItem } from "@/layout/puck/LayoutDrawerItem";
import { LayoutPanelActionBar } from "@/layout/puck/LayoutPanelActionBar";
import type { LayoutMetadata } from "@/layout/puck/types";
import {
  cn,
  getComponentTypeInZone,
  layoutZoneFromDestination,
  parentIdForDepth,
  selectActiveThemeCss,
  useStyleStore,
  wouldExceedMaxDepth,
  type LayoutPresetId,
} from "@qenex/core";
import {
  Puck,
  createUsePuck,
  type Config,
  type Data,
} from "@puckeditor/core";
import "@puckeditor/core/no-external.css";
import {
  useEffect,
  useLayoutEffect,
  type FC,
  type RefObject,
} from "react";

export type PuckDispatch = (action: {
  type: "setData";
  data: Data;
  recordHistory?: boolean;
}) => void;

export type PuckLayoutEditorProps = {
  config: Config;
  data: Data;
  metadata: LayoutMetadata;
  preset: LayoutPresetId;
  dispatchRef: RefObject<PuckDispatch | null>;
  revertingRef: RefObject<boolean>;
  onDraftChange: (data: Data) => void;
  onDepthViolation: (prevData: Data) => void;
};

const usePuck = createUsePuck();

function paintIframeDocumentTheme(doc: Document) {
  const rootStyles = getComputedStyle(document.documentElement);
  const background = rootStyles.getPropertyValue("--background").trim();
  const foreground = rootStyles.getPropertyValue("--foreground").trim();
  const colorScheme = document.documentElement.style.colorScheme ||
    rootStyles.colorScheme;

  if (background) {
    doc.documentElement.style.backgroundColor = background;
    doc.body.style.backgroundColor = background;
  }
  if (foreground) {
    doc.documentElement.style.color = foreground;
    doc.body.style.color = foreground;
  }
  if (colorScheme === "light" || colorScheme === "dark") {
    doc.documentElement.style.colorScheme = colorScheme;
    doc.documentElement.dataset.colorScheme = colorScheme;
    doc.documentElement.classList.toggle("dark", colorScheme === "dark");
  }
}

/** iframe srcDoc 默认白底；样式镜像完成前先涂上宿主主题色，避免进编辑闪白 */
function PuckIframeThemeBridge() {
  const themeCss = useStyleStore(selectActiveThemeCss);

  useLayoutEffect(() => {
    let cancelled = false;
    let iframe: HTMLIFrameElement | null = null;

    const paint = () => {
      if (cancelled) return;
      iframe = document.querySelector("iframe#preview-frame");
      const doc = iframe?.contentDocument;
      if (!doc?.body) return;
      paintIframeDocumentTheme(doc);
    };

    const onLoad = () => paint();

    paint();
    const poll = window.setInterval(paint, 32);
    const stopPoll = window.setTimeout(() => window.clearInterval(poll), 2500);

    const attach = () => {
      const next = document.querySelector("iframe#preview-frame");
      if (next === iframe) return;
      iframe?.removeEventListener("load", onLoad);
      iframe = next;
      iframe?.addEventListener("load", onLoad);
    };
    attach();
    const attachPoll = window.setInterval(attach, 50);
    const stopAttach = window.setTimeout(
      () => window.clearInterval(attachPoll),
      2500,
    );

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(stopPoll);
      window.clearInterval(attachPoll);
      window.clearTimeout(stopAttach);
      iframe?.removeEventListener("load", onLoad);
    };
  }, [themeCss]);

  return null;
}

function PuckDispatchBridge({
  dispatchRef,
}: {
  dispatchRef: RefObject<PuckDispatch | null>;
}) {
  const dispatch = usePuck((s) => s.dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch as PuckDispatch;
  }, [dispatch, dispatchRef]);
  return null;
}

const ComponentDrawer: FC = () => {
  return (
    <aside
      className={cn(
        "bg-background flex h-full shrink-0 flex-col border-r-[0.5px] border-border",
        LAYOUT_EDIT_SIDEBAR_CLASS,
        LAYOUT_EDIT_PANEL_WIDTH_CLASS,
      )}
    >
      <div className={cn(LAYOUT_EDIT_SIDEBAR_PANEL_BODY_CLASS, "shrink-0")}>
        <LayoutEditFooterControls />
      </div>

      <div className="bg-border mx-2 my-3 h-px shrink-0" />

      <div className={cn(LAYOUT_EDIT_SIDEBAR_PANEL_BODY_CLASS, "shrink-0")}>
        <div className="px-2.5 pb-1 pt-0.5 text-start text-sm font-bold text-foreground">
          主题修改
        </div>
        <LayoutThemePanel />
      </div>

      <div className="bg-border mx-2 my-3 h-px shrink-0" />

      <div className={cn(LAYOUT_EDIT_SIDEBAR_PANEL_BODY_CLASS, "shrink-0")}>
        <div className="px-2.5 pb-1 pt-0.5 text-start text-sm font-bold text-foreground">
          布局编辑
        </div>
        <LayoutEditPanelControls />
      </div>

      <div
        data-layout-component-drawer=""
        className={cn(
          LAYOUT_EDIT_SIDEBAR_PANEL_BODY_CLASS,
          "bg-background/95 backdrop-blur-sm",
          "min-h-0 flex-1 overflow-hidden pb-4",
        )}
      >
        <div
          data-layout-component-list=""
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          <Puck.Components />
        </div>
      </div>
    </aside>
  );
};

function isDepthLimitedAction(action: { type: string }): action is {
  type: "insert" | "move";
  destinationZone: string;
  componentType?: string;
  sourceZone?: string;
  sourceIndex?: number;
} {
  return action.type === "insert" || action.type === "move";
}

function parseZoneFromAction(action: {
  destinationZone: string;
}): { parentId: string } {
  const idx = action.destinationZone.indexOf(":");
  if (idx === -1) return { parentId: "root" };
  return { parentId: action.destinationZone.slice(0, idx) };
}

export const PuckLayoutEditor: FC<PuckLayoutEditorProps> = ({
  config,
  data,
  metadata,
  preset,
  dispatchRef,
  revertingRef,
  onDraftChange,
  onDepthViolation,
}) => {
  return (
    <div
      className="bg-background h-dvh min-h-0 overflow-hidden"
      data-layout-editing=""
    >
      <Puck
        key={`puck-edit-${preset}`}
        config={config}
        data={data}
        metadata={metadata}
        iframe={{ enabled: true }}
        ui={{ leftSideBarVisible: false, rightSideBarVisible: false }}
        overrides={{
          header: () => <></>,
          headerActions: () => <></>,
          actionBar: (props) => <LayoutPanelActionBar {...props} />,
          drawerItem: ({ children, name }) => (
            <LayoutDrawerItem name={name}>{children}</LayoutDrawerItem>
          ),
        }}
        onChange={(next) => {
          if (revertingRef.current) return;
          onDraftChange(next);
        }}
        onAction={(action, _appState, prevAppState) => {
          if (!isDepthLimitedAction(action)) return;

          const layoutZone = layoutZoneFromDestination(
            prevAppState.data,
            action.destinationZone,
          );
          if (!layoutZone) return;

          const { parentId } = parseZoneFromAction(action);
          const insertedType =
            action.type === "insert"
              ? action.componentType
              : getComponentTypeInZone(
                  prevAppState.data,
                  action.sourceZone ?? "",
                  action.sourceIndex ?? -1,
                );

          if (!insertedType) return;

          if (
            wouldExceedMaxDepth(
              prevAppState.data,
              layoutZone,
              parentIdForDepth(parentId),
              insertedType,
            )
          ) {
            onDepthViolation(prevAppState.data);
          }
        }}
      >
        <PuckDispatchBridge dispatchRef={dispatchRef} />
        <PuckIframeThemeBridge />
        <div className="flex h-dvh min-h-0 min-w-0 overflow-hidden bg-background">
          <ComponentDrawer />
          <div className="bg-background min-h-0 min-w-0 flex-1 overflow-hidden">
            <Puck.Preview />
          </div>
        </div>
      </Puck>
    </div>
  );
};
