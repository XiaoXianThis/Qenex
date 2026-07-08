import type { ComponentData, Data } from "@puckeditor/core";
import { getPresetState } from "./presets.ts";
import { buildPuckData } from "./puck-data.ts";
import { defaultAllPanelMeta } from "./panel-registry.ts";
import type { LayoutPersistedState } from "./types.ts";

type V3PuckRootProps = {
  shellTop?: ComponentData[];
  shellBottom?: ComponentData[];
  threadTop?: ComponentData[];
  threadBottom?: ComponentData[];
};

type LayoutV3State = {
  schemaVersion: 3;
  preset: string;
  puckData: Data;
  panels: LayoutPersistedState["panels"];
};

function isV3State(value: unknown): value is LayoutV3State {
  return (
    !!value &&
    typeof value === "object" &&
    (value as LayoutV3State).schemaVersion === 3
  );
}

const TYPE_MAP: Record<string, string> = {
  ShellLayoutRow: "LayoutRow",
  ShellLayoutColumn: "LayoutColumn",
  ThreadLayoutRow: "LayoutRow",
  ThreadLayoutColumn: "LayoutColumn",
};

function remapNode(node: ComponentData): ComponentData {
  const mappedType = TYPE_MAP[node.type] ?? node.type;
  const props = { ...node.props } as Record<string, unknown>;

  if (mappedType === "LayoutRow" || mappedType === "LayoutColumn") {
    const legacyColumns = props.columns;
    const legacyPanels = props.panels;
    if (Array.isArray(legacyColumns) && !props.children) {
      props.children = (legacyColumns as ComponentData[]).map(remapNode);
      delete props.columns;
    }
    if (Array.isArray(legacyPanels) && !props.children) {
      props.children = (legacyPanels as ComponentData[]).map(remapNode);
      delete props.panels;
    }
    const children = props.children;
    if (Array.isArray(children)) {
      props.children = children.map(remapNode);
    }
  }

  return { type: mappedType, props: props as ComponentData["props"] };
}

function remapZone(nodes: ComponentData[] | undefined): ComponentData[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map(remapNode);
}

function mergeZones(...zones: (ComponentData[] | undefined)[]): ComponentData[] {
  const result: ComponentData[] = [];
  for (const zone of zones) {
    if (Array.isArray(zone)) result.push(...remapZone(zone));
  }
  return result;
}

export function migrateV3ToV4(v3: LayoutV3State): LayoutPersistedState {
  const root = v3.puckData.root?.props as V3PuckRootProps | undefined;
  const top = mergeZones(root?.shellTop, root?.threadTop);
  const bottom = mergeZones(root?.shellBottom, root?.threadBottom);

  return {
    schemaVersion: 4,
    preset:
      v3.preset === "custom"
        ? "custom"
        : (v3.preset as LayoutPersistedState["preset"]),
    puckData: buildPuckData({ top, bottom }),
    panels: { ...defaultAllPanelMeta(), ...v3.panels },
  };
}

export function migrateLayoutToV4(value: unknown): LayoutPersistedState {
  if (!value || typeof value !== "object") {
    return getPresetState("classic");
  }

  if ("schemaVersion" in value && (value as LayoutPersistedState).schemaVersion === 4) {
    return value as LayoutPersistedState;
  }

  if (isV3State(value)) {
    return migrateV3ToV4(value);
  }

  return getPresetState("classic");
}
