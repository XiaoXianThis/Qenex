"use client";

import { layoutConfig } from "@/layout/puck/config";
import { LayoutPanelActionBar } from "@/layout/puck/LayoutPanelActionBar";
import type { LayoutMetadata } from "@/layout/puck/types";
import {
  clonePuckData,
  getComponentTypeInZone,
  layoutActions,
  layoutZoneFromDestination,
  parentIdForDepth,
  useLayoutStore,
  wouldExceedMaxDepth,
} from "@qenex/core";
import {
  Puck,
  Render,
  createUsePuck,
  type Config,
  type Data,
} from "@puckeditor/core";
import "@puckeditor/core/puck.css";
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
    <div className="pointer-events-none fixed top-1/2 left-3 z-50 flex max-h-[min(80dvh,640px)] -translate-y-1/2">
      <div className="pointer-events-auto flex w-44 flex-col overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur-sm">
        <div className="border-b px-2 py-1.5 text-xs font-medium text-muted-foreground">
          组件
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          <Puck.Components />
        </div>
      </div>
    </div>
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
  const preset = useLayoutStore((s) => s.preset);
  const storePuckData = useLayoutStore((s) => s.puckData);
  const setPuckData = layoutActions.setPuckData;

  const draftRef = useRef<Data | null>(null);
  const [draftPuckData, setDraftPuckData] = useState<Data | null>(null);
  const storeSnapshotOnEnterRef = useRef<string | null>(null);
  const revertingRef = useRef(false);
  const puckDispatchRef = useRef<PuckDispatch | null>(null);

  useLayoutEffect(() => {
    if (editMode) {
      const snapshot = clonePuckData(storePuckData);
      draftRef.current = snapshot;
      setDraftPuckData(snapshot);
      storeSnapshotOnEnterRef.current = snapshotPuckData(storePuckData);
      return;
    }

    const draft = draftRef.current;
    const enterSnapshot = storeSnapshotOnEnterRef.current;
    if (
      draft !== null &&
      enterSnapshot !== null &&
      snapshotPuckData(storePuckData) === enterSnapshot
    ) {
      setPuckData(draft);
    }

    draftRef.current = null;
    setDraftPuckData(null);
    storeSnapshotOnEnterRef.current = null;
  }, [editMode, storePuckData, setPuckData]);

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
    const puckData = draftPuckData ?? clonePuckData(storePuckData);

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
          <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              <Puck.Preview />
            </div>
            <ComponentDrawer />
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
