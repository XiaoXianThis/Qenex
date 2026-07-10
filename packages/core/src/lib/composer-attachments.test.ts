import { describe, expect, test } from "bun:test";
import {
  COMPOSER_ATTACHMENT_ACCEPT,
  createComposerAttachmentAdapter,
} from "./composer-attachments.ts";
import type { PendingAttachment } from "@assistant-ui/react";

async function asPending(
  result: PendingAttachment | AsyncGenerator<PendingAttachment, void>,
): Promise<PendingAttachment> {
  if (result && typeof (result as AsyncGenerator<PendingAttachment>).next === "function") {
    const next = await (result as AsyncGenerator<PendingAttachment>).next();
    if (!next.value) throw new Error("empty attachment generator");
    return next.value;
  }
  return result as PendingAttachment;
}

describe("createComposerAttachmentAdapter", () => {
  test("accepts images and text (incl. wildcards / extensions)", () => {
    const adapter = createComposerAttachmentAdapter();
    expect(adapter.accept).toBe(COMPOSER_ATTACHMENT_ACCEPT);
    expect(adapter.accept).toContain("image/*");
    expect(adapter.accept).toContain("text/*");
    expect(adapter.accept).toContain(".txt");
  });

  test("add + send image produces image content part", async () => {
    const adapter = createComposerAttachmentAdapter();
    const file = new File([Uint8Array.from([137, 80, 78, 71])], "shot.png", {
      type: "image/png",
    });

    const attachment = await asPending(await adapter.add({ file }));
    expect(attachment.type).toBe("image");
    expect(attachment.name).toBe("shot.png");
    expect(attachment.contentType).toBe("image/png");

    const complete = await adapter.send(attachment);
    expect(complete.status.type).toBe("complete");
    expect(complete.content).toHaveLength(1);
    expect(complete.content[0]?.type).toBe("image");
    if (complete.content[0]?.type === "image") {
      expect(complete.content[0].image).toMatch(/^data:image\/png;base64,/);
    }
  });

  test("add + send text file produces text content part", async () => {
    const adapter = createComposerAttachmentAdapter();
    // Bun may append ;charset=utf-8 — adapter must still match via text/*
    const file = new File(["hello attach"], "note.txt", {
      type: "text/plain",
    });
    expect(file.type).toContain("text/plain");

    const attachment = await asPending(await adapter.add({ file }));
    expect(attachment.type).toBe("document");
    expect(attachment.name).toBe("note.txt");

    const complete = await adapter.send(attachment);
    expect(complete.status.type).toBe("complete");
    expect(complete.content[0]?.type).toBe("text");
    if (complete.content[0]?.type === "text") {
      expect(complete.content[0].text).toContain("hello attach");
      expect(complete.content[0].text).toContain("note.txt");
    }
  });

  test("matches text files by extension when MIME is empty", async () => {
    const adapter = createComposerAttachmentAdapter();
    const file = new File(["by ext"], "readme.md", { type: "" });
    const attachment = await asPending(await adapter.add({ file }));
    expect(attachment.type).toBe("document");
    const complete = await adapter.send(attachment);
    expect(complete.content[0]?.type).toBe("text");
  });

  test("rejects unsupported binary types", async () => {
    const adapter = createComposerAttachmentAdapter();
    const file = new File([Uint8Array.from([0, 1, 2])], "blob.bin", {
      type: "application/octet-stream",
    });
    let threw = false;
    try {
      await adapter.add({ file });
    } catch (error) {
      threw = true;
      expect(String(error)).toMatch(/No matching adapter/);
    }
    expect(threw).toBe(true);
  });
});
