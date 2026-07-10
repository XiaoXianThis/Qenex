import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  type AttachmentAdapter,
  type CompleteAttachment,
  type PendingAttachment,
} from "@assistant-ui/react";

/**
 * 文本附件：比官方 SimpleTextAttachmentAdapter 更宽的 accept。
 * - `text/*` 覆盖 `text/plain;charset=utf-8`（Bun / 部分浏览器）
 * - 扩展名兜底（拖入时 MIME 可能为空）
 */
class TextFileAttachmentAdapter implements AttachmentAdapter {
  accept =
    "text/*,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.css,.svg,.yml,.yaml,.toml,.ini,.log,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.rs,.go,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cs,.php,.rb,.sh,.bash,.zsh,.sql";

  async add(state: { file: File }): Promise<PendingAttachment> {
    return {
      id: state.file.name,
      type: "document",
      name: state.file.name,
      contentType: state.file.type || "text/plain",
      file: state.file,
      status: {
        type: "requires-action",
        reason: "composer-send",
      },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const text = await attachment.file!.text();
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "text",
          text: `<attachment name=${attachment.name}>\n${text}\n</attachment>`,
        },
      ],
    };
  }

  async remove(): Promise<void> {}
}

/**
 * Composer 附件适配器：图片（拖入/粘贴/点选）+ 常见文本文件。
 * 挂到 useAgUiRuntime({ adapters: { attachments } }) 后，
 * AttachmentDropzone / AddAttachment / Input 粘贴才会真正生效。
 */
export function createComposerAttachmentAdapter(): AttachmentAdapter {
  return new CompositeAttachmentAdapter([
    new SimpleImageAttachmentAdapter(),
    new TextFileAttachmentAdapter(),
  ]);
}

export const COMPOSER_ATTACHMENT_ACCEPT = createComposerAttachmentAdapter().accept;
