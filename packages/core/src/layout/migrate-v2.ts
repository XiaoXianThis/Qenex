import type { ComponentData, Data } from "@puckeditor/core";
import { getPresetState } from "./presets.ts";
import {
  panelToComponentData,
  resetPuckIdCounter,
} from "./puck-data.ts";
import { defaultAllPanelMeta } from "./panel-registry.ts";
import type {
  DraggablePanelId,
  LayoutPersistedState,
  PanelId,
  WidthScope,
} from "./types.ts";
import { PUCK_PANEL_TYPE } from "./types.ts";

type LegacyCellWidth =
  | { kind: "fr"; value: number }
  | { kind: "px"; value: number }
  | "auto";

type LegacyBandCell = {
  id: string;
  width: LegacyCellWidth;
  panels: PanelId[];
};

type LegacyBandRow = {
  id: string;
  height: unknown;
  cells: LegacyBandCell[];
};

type LegacyScopeBands = Record<"top" | "center" | "bottom", LegacyBandRow[]>;

type LayoutV2State = {
  schemaVersion: 2;
  preset: string;
  shell: LegacyScopeBands;
  thread: LegacyScopeBands;
  panels: Record<
    PanelId,
    { visible: boolean; widthScope: WidthScope | "cell" }
  >;
};

type ShellPanelId = "tabBar" | "tokenStats" | "undoRedo";
type ThreadPanelId = Exclude<
  DraggablePanelId,
  ShellPanelId
>;

type V3PuckRootProps = {
  shellTop: ComponentData[];
  shellBottom: ComponentData[];
  threadTop: ComponentData[];
  threadBottom: ComponentData[];
};

let legacyIdCounter = 0;

function nextLegacyId(prefix: string): string {
  legacyIdCounter += 1;
  return `${prefix}-${legacyIdCounter}`;
}

function createLegacyColumn(
  rowType: "ShellLayoutColumn" | "ThreadLayoutColumn",
  panelIds: DraggablePanelId[],
): ComponentData {
  return {
    type: rowType,
    props: {
      id: nextLegacyId(rowType),
      panels: panelIds.map((id) => panelToComponentData(id)),
    },
  };
}

function createLegacyRow(
  rowType: "ShellLayoutRow" | "ThreadLayoutRow",
  columnType: "ShellLayoutColumn" | "ThreadLayoutColumn",
  columns: DraggablePanelId[][],
): ComponentData {
  return {
    type: rowType,
    props: {
      id: nextLegacyId(rowType),
      columns: columns.map((col) => createLegacyColumn(columnType, col)),
    },
  };
}

function buildV3PuckData(props: V3PuckRootProps): Data {
  return {
    content: [],
    root: { props: props as unknown as Data["root"]["props"] },
  };
}

function isV2State(value: unknown): value is LayoutV2State {
  return (
    !!value &&
    typeof value === "object" &&
    (value as LayoutV2State).schemaVersion === 2
  );
}

function mapWidthScope(scope: WidthScope | "cell"): WidthScope {
  if (scope === "cell") return "content";
  return scope;
}

function shellPanelsFromCells(cells: LegacyBandCell[]): ShellPanelId[][] {
  return cells.map((cell) =>
    cell.panels.filter(
      (p): p is ShellPanelId =>
        p === "tabBar" || p === "tokenStats" || p === "undoRedo",
    ),
  );
}

function threadPanelsFromCells(cells: LegacyBandCell[]): ThreadPanelId[][] {
  return cells.map((cell) =>
    cell.panels.filter(
      (p): p is ThreadPanelId =>
        p !== "tabBar" &&
        p !== "tokenStats" &&
        p !== "undoRedo" &&
        p !== "messages" &&
        p !== "sessionConfigBar",
    ),
  );
}

function bandsToShellRows(bands: LegacyBandRow[]): ComponentData[] {
  const rows: ComponentData[] = [];
  for (const row of bands) {
    if (row.cells.length === 0) continue;
    const columns = shellPanelsFromCells(row.cells);
    if (columns.every((col) => col.length === 0)) continue;
    rows.push(createLegacyRow("ShellLayoutRow", "ShellLayoutColumn", columns));
  }
  return rows;
}

function bandsToThreadRows(bands: LegacyBandRow[]): ComponentData[] {
  const rows: ComponentData[] = [];
  for (const row of bands) {
    if (row.cells.length === 0) continue;
    const columns = threadPanelsFromCells(row.cells);
    if (columns.every((col) => col.length === 0)) continue;
    rows.push(createLegacyRow("ThreadLayoutRow", "ThreadLayoutColumn", columns));
  }
  return rows;
}

function collectOrphanThreadPanels(
  thread: LegacyScopeBands,
): ThreadPanelId[] {
  const orphans: ThreadPanelId[] = [];
  for (const row of thread.center) {
    for (const cell of row.cells) {
      for (const panelId of cell.panels) {
        if (panelId === "messages" || panelId === "sessionConfigBar") continue;
        if (
          panelId === "checklist" ||
          panelId === "approval" ||
          panelId === "composer" ||
          panelId === "followupSuggestions" ||
          panelId === "scrollToBottom" ||
          panelId === "welcomeSuggestions"
        ) {
          orphans.push(panelId);
        }
      }
    }
  }
  return orphans;
}

function rowContainsPanel(row: ComponentData, puckType: string): boolean {
  const columns = row.props?.columns;
  if (!Array.isArray(columns)) return false;
  for (const col of columns as ComponentData[]) {
    const panels = col.props?.panels;
    if (!Array.isArray(panels)) continue;
    for (const panel of panels as ComponentData[]) {
      if (panel.type === puckType) return true;
    }
  }
  return false;
}

type LayoutV3State = {
  schemaVersion: 3;
  preset: LayoutPersistedState["preset"];
  puckData: import("@puckeditor/core").Data;
  panels: LayoutPersistedState["panels"];
};

export function migrateV2ToV3(v2: LayoutV2State): LayoutV3State {
  resetPuckIdCounter();
  legacyIdCounter = 0;

  const shellTop = bandsToShellRows(v2.shell.top);
  const shellBottom = bandsToShellRows(v2.shell.bottom);
  const threadTop = bandsToThreadRows(v2.thread.top);
  let threadBottom = bandsToThreadRows(v2.thread.bottom);

  const orphans = collectOrphanThreadPanels(v2.thread);
  for (const panelId of orphans) {
    const alreadyPlaced = threadBottom.some((row) =>
      rowContainsPanel(row, PUCK_PANEL_TYPE[panelId]),
    );
    if (!alreadyPlaced) {
      threadBottom = [
        ...threadBottom,
        createLegacyRow("ThreadLayoutRow", "ThreadLayoutColumn", [[panelId]]),
      ];
    }
  }

  const panels = defaultAllPanelMeta();
  for (const id of Object.keys(v2.panels) as PanelId[]) {
    if (!panels[id] || !v2.panels[id]) continue;
    panels[id] = {
      visible: v2.panels[id].visible,
      widthScope: mapWidthScope(v2.panels[id].widthScope),
    };
  }

  return {
    schemaVersion: 3,
    preset: v2.preset === "custom" ? "custom" : (v2.preset as LayoutPersistedState["preset"]),
    puckData: buildV3PuckData({
      shellTop,
      shellBottom,
      threadTop,
      threadBottom,
    }),
    panels,
  };
}

export function migrateLayoutToV3(value: unknown): LayoutV3State | LayoutPersistedState {
  if (!value || typeof value !== "object") {
    return getPresetState("classic");
  }

  if ("schemaVersion" in value && (value as { schemaVersion: number }).schemaVersion === 3) {
    return value as LayoutV3State;
  }

  if (isV2State(value)) {
    return migrateV2ToV3(value);
  }

  return getPresetState("classic");
}
