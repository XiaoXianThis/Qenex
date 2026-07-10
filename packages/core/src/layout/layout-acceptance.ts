/**
 * Layout schema v4 acceptance checks.
 * Run: bun packages/core/src/layout/layout-acceptance.ts
 */
import { defaultAllPanelMeta } from "./panel-registry.ts";
import {
  canInsertAtDepth,
  wouldExceedMaxDepth,
} from "./layout-depth.ts";
import { migrateLayoutToV4 } from "./migrate-v3.ts";
import {
  buildPuckData,
  columnOfPanels,
  createLayoutColumn,
  createLayoutRow,
  findPanelZone,
  panelToComponentData,
  resetPuckIdCounter,
} from "./puck-data.ts";
import { LAYOUT_PRESETS } from "./presets.ts";
import type { ComponentData, Data } from "@puckeditor/core";
import type { LayoutPresetId } from "./types.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${message}`);
  }
}

function buildV3PuckData(props: {
  shellTop?: ComponentData[];
  shellBottom?: ComponentData[];
  threadTop?: ComponentData[];
  threadBottom?: ComponentData[];
}): Data {
  return {
    content: [],
    root: { props: props as unknown as Data["root"]["props"] },
  };
}

function legacyRow(
  rowType: "ShellLayoutRow" | "ThreadLayoutRow",
  colType: "ShellLayoutColumn" | "ThreadLayoutColumn",
  columns: Parameters<typeof panelToComponentData>[0][][],
): ComponentData {
  return {
    type: rowType,
    props: {
      id: `row-${Math.random()}`,
      columns: columns.map((col) => ({
        type: colType,
        props: {
          id: `col-${Math.random()}`,
          panels: col.map((p) => panelToComponentData(p)),
        },
      })),
    },
  };
}

console.log("Layout v4 acceptance\n");

console.log("Presets (schemaVersion === 4):");
for (const preset of [
  "classic",
  "composerTop",
  "tabsBottom",
  "minimal",
  "workspace",
] as const satisfies readonly Exclude<LayoutPresetId, "custom">[]) {
  assert(
    LAYOUT_PRESETS[preset].schemaVersion === 4,
    `preset ${preset} is schema v4`,
  );
}

console.log("\nMigration v3 → v4:");
const v3Classic = {
  schemaVersion: 3 as const,
  preset: "classic" as const,
  panels: defaultAllPanelMeta(),
  puckData: buildV3PuckData({
    shellTop: [legacyRow("ShellLayoutRow", "ShellLayoutColumn", [["tabBar"]])],
    shellBottom: [],
    threadTop: [],
    threadBottom: [
      legacyRow("ThreadLayoutRow", "ThreadLayoutColumn", [
        ["followupSuggestions", "scrollToBottom", "composer", "welcomeSuggestions"],
      ]),
    ],
  }),
};
const classicV4 = migrateLayoutToV4(v3Classic);
assert(
  findPanelZone(classicV4.puckData, "tabBar") === "top",
  "v3 classic → tabBar in top",
);
assert(
  findPanelZone(classicV4.puckData, "composer") === "bottom",
  "v3 classic → composer in bottom",
);

const v3ComposerTop = {
  schemaVersion: 3 as const,
  preset: "composerTop" as const,
  panels: defaultAllPanelMeta(),
  puckData: buildV3PuckData({
    shellTop: [legacyRow("ShellLayoutRow", "ShellLayoutColumn", [["tabBar"]])],
    threadTop: [legacyRow("ThreadLayoutRow", "ThreadLayoutColumn", [["composer"]])],
    shellBottom: [],
    threadBottom: [
      legacyRow("ThreadLayoutRow", "ThreadLayoutColumn", [
        ["followupSuggestions", "scrollToBottom", "welcomeSuggestions"],
      ]),
    ],
  }),
};
const composerTopV4 = migrateLayoutToV4(v3ComposerTop);
assert(
  findPanelZone(composerTopV4.puckData, "composer") === "top",
  "v3 composerTop → composer in top",
);

console.log("\nfindPanelZone:");
assert(
  findPanelZone(LAYOUT_PRESETS.classic.puckData, "tabBar") === "top",
  "classic tabBar → top",
);
assert(
  findPanelZone(LAYOUT_PRESETS.classic.puckData, "composer") === "bottom",
  "classic composer → bottom",
);
assert(
  findPanelZone(LAYOUT_PRESETS.classic.puckData, "approval") === "bottom",
  "classic approval → bottom",
);
assert(
  LAYOUT_PRESETS.classic.panels.approval.visible === false,
  "classic approval hidden by default",
);
assert(
  findPanelZone(LAYOUT_PRESETS.tabsBottom.puckData, "tabBar") === "bottom",
  "tabsBottom tabBar → bottom",
);

console.log("\nDepth limit (max 4):");
assert(canInsertAtDepth(4), "depth 4 allowed");
assert(!canInsertAtDepth(5), "depth 5 rejected");

resetPuckIdCounter();
const c4 = createLayoutColumn([]);
const c3 = createLayoutColumn([c4]);
const c2 = createLayoutColumn([c3]);
const c1 = createLayoutColumn([c2]);
const deepestParentId = c4.props.id as string;
const deepData = buildPuckData({ top: [c1], bottom: [] });
assert(
  wouldExceedMaxDepth(deepData, "top", deepestParentId, "Composer"),
  "insert at depth 5 rejected",
);
assert(
  !wouldExceedMaxDepth(deepData, "top", "root", "LayoutColumn"),
  "insert column at zone root allowed",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
