"use client";

import { layoutConfig } from "@/layout/puck/config";
import type { LayoutMetadata } from "@/layout/puck/types";
import {
  clonePuckData,
  layoutActions,
  useLayoutStore,
  type LayoutPresetId,
} from "@qenex/core";
import { Render } from "@puckeditor/core/rsc";
import type { Config, Data } from "@puckeditor/core";
import {
  lazy,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";

type PuckLayoutRendererProps = {
  metadata: LayoutMetadata;
};

type PuckDispatch = (action: {
  type: "setData";
  data: Data;
  recordHistory?: boolean;
}) => void;

const PuckLayoutEditorLazy = lazy(() =>
  import("@/layout/puck/PuckLayoutEditor").then((mod) => ({
    default: mod.PuckLayoutEditor,
  })),
);

const puckConfig = layoutConfig as Config;

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

  const puckData =
    draftPuckData !== null && draftPresetRef.current === preset
      ? draftPuckData
      : renderPuckData;

  // 编辑时仍挂载 live Render（视觉隐藏），避免卸载 AgentRuntimeProvider 导致聊天中断。
  // Puck iframe 预览用独立 stub runtime，只服务布局编辑。
  return (
    <>
      <div
        className={
          editMode
            ? "pointer-events-none invisible absolute inset-0 h-0 w-0 overflow-hidden"
            : undefined
        }
        aria-hidden={editMode || undefined}
        data-layout-live-keepalive={editMode ? "" : undefined}
      >
        <Render config={puckConfig} data={renderPuckData} metadata={metadata} />
      </div>
      {editMode ? (
        <Suspense
          fallback={
            <div
              className="bg-background h-dvh min-h-0 overflow-hidden"
              data-layout-editing=""
            />
          }
        >
          <PuckLayoutEditorLazy
            config={puckConfig}
            data={puckData}
            metadata={metadata}
            preset={preset}
            dispatchRef={puckDispatchRef}
            revertingRef={revertingRef}
            onDraftChange={updateDraft}
            onDepthViolation={handleDepthViolation}
          />
        </Suspense>
      ) : null}
    </>
  );
};
