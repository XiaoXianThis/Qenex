import { describe, expect, test } from "bun:test";

/**
 * Mirrors useAutoCollapsibleOpen resolution (uncontrolled):
 * userOpen ?? autoOpen ?? defaultOpen
 */
function resolveOpen(
  userOpen: boolean | null,
  autoOpen: boolean,
  defaultOpen = false,
): boolean {
  return userOpen ?? autoOpen ?? defaultOpen;
}

function isPreview(
  userOpen: boolean | null,
  autoOpen: boolean,
  defaultOpen = false,
): boolean {
  const isOpen = resolveOpen(userOpen, autoOpen, defaultOpen);
  return autoOpen === true && isOpen && userOpen === null;
}

/**
 * 工具三态点击：previewClickExpands=true 时。
 * 返回下一拍的 userOpen。
 */
function nextUserOpenOnToggle(
  userOpen: boolean | null,
  autoOpen: boolean,
  wantOpen: boolean,
): boolean | null {
  const preview = isPreview(userOpen, autoOpen);
  // 预览 → 完全展开
  if (preview && !wantOpen) return true;
  // 完全展开 → 收起
  if (userOpen === true && !wantOpen) return false;
  // 收起 → 回到预览（有 autoOpen）或完全展开
  if (userOpen === false && wantOpen) return autoOpen ? null : true;
  return wantOpen;
}

/** Cursor-aligned: shell / file-changing tools default to preview */
function toolAutoOpen(
  kind: "read" | "grep" | "shell" | "edit" | "write" | "generic",
): boolean {
  return kind === "shell" || kind === "edit" || kind === "write";
}

describe("auto collapsible open semantics", () => {
  test("follows autoOpen while user has not toggled", () => {
    expect(resolveOpen(null, true)).toBe(true);
    expect(resolveOpen(null, false)).toBe(false);
  });

  test("manual toggle takes over permanently", () => {
    expect(resolveOpen(true, false)).toBe(true);
    expect(resolveOpen(false, true)).toBe(false);
  });

  test("read/grep stay collapsed; shell/edit/write default preview", () => {
    expect(resolveOpen(null, toolAutoOpen("read"))).toBe(false);
    expect(resolveOpen(null, toolAutoOpen("grep"))).toBe(false);
    expect(resolveOpen(null, toolAutoOpen("shell"))).toBe(true);
    expect(isPreview(null, toolAutoOpen("shell"))).toBe(true);
    expect(resolveOpen(null, toolAutoOpen("edit"))).toBe(true);
    expect(resolveOpen(null, toolAutoOpen("write"))).toBe(true);
  });

  test("shell three-state: preview → expanded → collapsed → preview", () => {
    const auto = true;
    let user: boolean | null = null;
    expect(isPreview(user, auto)).toBe(true);

    user = nextUserOpenOnToggle(user, auto, false);
    expect(user).toBe(true);
    expect(isPreview(user, auto)).toBe(false);
    expect(resolveOpen(user, auto)).toBe(true);

    user = nextUserOpenOnToggle(user, auto, false);
    expect(user).toBe(false);
    expect(resolveOpen(user, auto)).toBe(false);

    user = nextUserOpenOnToggle(user, auto, true);
    expect(user).toBe(null);
    expect(isPreview(user, auto)).toBe(true);
  });

  test("read stays binary: collapsed ↔ expanded", () => {
    const auto = false;
    let user: boolean | null = null;
    expect(resolveOpen(user, auto)).toBe(false);

    user = nextUserOpenOnToggle(user, auto, true);
    // without previewClick path, normal setUserOpen(true)
    user = true;
    expect(resolveOpen(user, auto)).toBe(true);

    user = false;
    expect(resolveOpen(user, auto)).toBe(false);
  });

  test("reasoning still uses streaming autoOpen", () => {
    let streaming = true;
    expect(resolveOpen(null, streaming)).toBe(true);
    streaming = false;
    expect(resolveOpen(null, streaming)).toBe(false);
  });
});
