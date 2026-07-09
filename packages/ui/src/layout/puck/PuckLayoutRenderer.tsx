"use client";

import { layoutConfig } from "@/layout/puck/config";
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
  clonePuckData,
  cn,
  getComponentTypeInZone,
  layoutActions,
  layoutZoneFromDestination,
  parentIdForDepth,
  useLayoutStore,
  wouldExceedMaxDepth,
  type LayoutPresetId,
} from "@qenex/core";
import {
  Puck,
  Render,
  createUsePuck,
  type Config,
  type Data,
} from "@puckeditor/core";
import "@puckeditor/core/no-external.css";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type RefObject,
} from "react";

type PuckLayoutRendererProps = {
  metadata: LayoutMetadata;
};

type PuckDispatch = (action: {
  type: "setData";
  data: Data;
  recordHistory?: boolean;
}) => void;

const usePuck = createUsePuck();

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
        "flex h-full shrink-0 flex-col border-r-[0.5px] border-border",
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

const puckConfig = layoutConfig as Config;

function isDepthLimitedAction(action: { type: string }): action is {
  type: "insert" | "move";
  destinationZone: string;
  componentType?: string;
  sourceZone?: string;
  sourceIndex?: number;
} {
  return action.type === "insert" || action.type === "move";
}

function snapshotPuckData(data: Data): string {
  return JSON.stringify(data);
}

export const PuckLayoutRenderer: FC<PuckLayoutRendererProps> = ({ metadata }) => {
  const editMode = useLayoutStore((s) => s.editMode);
  const discardEditDraft = useLayoutStore((s) => s.discardEditDraft);
  const preset = useLayoutStore((s) => s.preset);
  const storePuckData = useLayoutStore((s) => s.puckData);
  const setPuckData = layoutActions.setPuckData;
  const clearDiscardEditDraft = layoutActions.clearDiscardEditDraft;

  const draftRef = useRef<Data | null>(null);
  const [draftPuckData, setDraftPuckData] = useState<Data | null>(null);
  const draftPresetRef = useRef<LayoutPresetId | null>(null);
  const storeSnapshotOnEnterRef = useRef<string | null>(null);
  const revertingRef = useRef(false);
  const puckDispatchRef = useRef<PuckDispatch | null>(null);

  useLayoutEffect(() => {
    if (editMode) {
      const snapshot = clonePuckData(storePuckData);
      draftRef.current = snapshot;
      setDraftPuckData(snapshot);
      draftPresetRef.current = preset;
      storeSnapshotOnEnterRef.current = snapshotPuckData(storePuckData);
      return;
    }

    const shouldDiscard = discardEditDraft;
    const draft = draftRef.current;
    const enterSnapshot = storeSnapshotOnEnterRef.current;
    if (
      !shouldDiscard &&
      draft !== null &&
      enterSnapshot !== null &&
      snapshotPuckData(storePuckData) === enterSnapshot
    ) {
      setPuckData(draft);
    }

    draftRef.current = null;
    setDraftPuckData(null);
    draftPresetRef.current = null;
    storeSnapshotOnEnterRef.current = null;
    if (shouldDiscard) {
      clearDiscardEditDraft();
    }
  }, [
    editMode,
    discardEditDraft,
    storePuckData,
    preset,
    setPuckData,
    clearDiscardEditDraft,
  ]);

  const handleDepthViolation = (prevData: Data) => {
    revertingRef.current = true;
    const cloned = clonePuckData(prevData);
    puckDispatchRef.current?.({
      type: "setData",
      data: cloned,
      recordHistory: false,
    });
    draftRef.current = cloned;
    setDraftPuckData(cloned);
    queueMicrotask(() => {
      revertingRef.current = false;
    });
  };

  const updateDraft = (data: Data) => {
    draftRef.current = data;
    setDraftPuckData(data);
  };

  const renderPuckData = useMemo(
    () => clonePuckData(storePuckData),
    [storePuckData],
  );

  if (editMode) {
    const puckData =
      draftPuckData !== null && draftPresetRef.current === preset
        ? draftPuckData
        : clonePuckData(storePuckData);

    return (
      <div className="h-dvh min-h-0 overflow-hidden" data-layout-editing="">
        <Puck
          key={`puck-edit-${preset}`}
          config={puckConfig}
          data={puckData}
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
          onChange={(data) => {
            if (revertingRef.current) return;
            updateDraft(data);
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
              handleDepthViolation(prevAppState.data);
            }
          }}
        >
          <PuckDispatchBridge dispatchRef={puckDispatchRef} />
          <div className="flex h-dvh min-h-0 min-w-0 overflow-hidden">
            <ComponentDrawer />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <Puck.Preview />
            </div>
          </div>
        </Puck>
      </div>
    );
  }

  return (
    <Render config={puckConfig} data={renderPuckData} metadata={metadata} />
  );
};

function parseZoneFromAction(action: {
  destinationZone: string;
}): { parentId: string } {
  const idx = action.destinationZone.indexOf(":");
  if (idx === -1) return { parentId: "root" };
  return { parentId: action.destinationZone.slice(0, idx) };
}
