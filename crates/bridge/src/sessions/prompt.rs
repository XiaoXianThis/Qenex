use agent_client_protocol::schema::v1::{ContentBlock, ImageContent, TextContent};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;

/// Build ACP prompt content blocks from an AG-UI run input (`{ messages: [...] }`).
pub fn build_prompt_blocks(input: &Value) -> Vec<ContentBlock> {
    let messages = input.get("messages").and_then(|m| m.as_array());
    let mut blocks = Vec::new();

    if let Some(messages) = messages {
        if let Some(last) = messages.last() {
            push_content_blocks(last.get("content"), &mut blocks);
            push_legacy_attachment_blocks(last.get("attachments"), &mut blocks);
        }
    }

    if blocks.is_empty() {
        blocks.push(ContentBlock::Text(TextContent::new("")));
    }

    blocks
}

fn push_content_blocks(content: Option<&Value>, blocks: &mut Vec<ContentBlock>) {
    let Some(content) = content else {
        return;
    };

    if let Some(text) = content.as_str() {
        if !text.is_empty() {
            blocks.push(ContentBlock::Text(TextContent::new(text)));
        }
        return;
    }

    let Some(parts) = content.as_array() else {
        return;
    };

    for part in parts {
        let part_type = part.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match part_type {
            "text" => {
                if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        blocks.push(ContentBlock::Text(TextContent::new(text)));
                    }
                }
            }
            "image" => {
                if let Some((data, mime)) = extract_media_payload(part, "image/png") {
                    blocks.push(ContentBlock::Image(ImageContent::new(data, mime)));
                }
            }
            "file" | "document" | "binary" => {
                push_file_like_block(part, blocks);
            }
            // audio/video: keep as named placeholder until ACP media blocks are wired
            "audio" | "video" => {
                let name = part
                    .get("metadata")
                    .and_then(|m| m.get("filename"))
                    .and_then(|n| n.as_str())
                    .unwrap_or(part_type);
                blocks.push(ContentBlock::Text(TextContent::new(format!(
                    "[{part_type}: {name}]"
                ))));
            }
            _ => {}
        }
    }
}

fn push_file_like_block(part: &Value, blocks: &mut Vec<ContentBlock>) {
    let name = part
        .get("metadata")
        .and_then(|m| m.get("filename"))
        .and_then(|n| n.as_str())
        .or_else(|| part.get("filename").and_then(|n| n.as_str()))
        .or_else(|| part.get("name").and_then(|n| n.as_str()))
        .unwrap_or("unnamed");

    let Some((data, mime)) = extract_media_payload(part, "application/octet-stream") else {
        blocks.push(ContentBlock::Text(TextContent::new(format!(
            "[File: {name}]"
        ))));
        return;
    };

    if mime.starts_with("image/") {
        blocks.push(ContentBlock::Image(ImageContent::new(data, mime)));
        return;
    }

    if mime.starts_with("text/")
        || mime == "application/json"
        || mime == "application/xml"
        || mime == "application/javascript"
    {
        let decoded = STANDARD
            .decode(&data)
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap_or_else(|_| data);
        blocks.push(ContentBlock::Text(TextContent::new(format!(
            "[File: {name}]\n```\n{decoded}\n```"
        ))));
        return;
    }

    blocks.push(ContentBlock::Text(TextContent::new(format!(
        "[File: {name} ({mime}, {} bytes base64)]",
        data.len()
    ))));
}

/// Supports AG-UI `{ source: { type, value, mimeType } }`, legacy `{ data, mimeType }`,
/// and data-URL strings on `image` / `data` / `url`.
fn extract_media_payload(part: &Value, default_mime: &str) -> Option<(String, String)> {
    if let Some(source) = part.get("source") {
        let value = source.get("value").and_then(|v| v.as_str())?;
        let mime = source
            .get("mimeType")
            .and_then(|m| m.as_str())
            .unwrap_or(default_mime)
            .to_string();
        return Some((
            strip_data_url(value),
            mime_from_data_url(value).unwrap_or(mime),
        ));
    }

    if let Some(image) = part.get("image").and_then(|v| v.as_str()) {
        let mime = mime_from_data_url(image).unwrap_or_else(|| default_mime.to_string());
        return Some((strip_data_url(image), mime));
    }

    if let Some(data) = part.get("data").and_then(|v| v.as_str()) {
        let mime = part
            .get("mimeType")
            .and_then(|m| m.as_str())
            .map(str::to_string)
            .or_else(|| mime_from_data_url(data))
            .unwrap_or_else(|| default_mime.to_string());
        return Some((strip_data_url(data), mime));
    }

    if let Some(url) = part.get("url").and_then(|v| v.as_str()) {
        let mime = part
            .get("mimeType")
            .and_then(|m| m.as_str())
            .map(str::to_string)
            .or_else(|| mime_from_data_url(url))
            .unwrap_or_else(|| default_mime.to_string());
        return Some((strip_data_url(url), mime));
    }

    None
}

fn strip_data_url(value: &str) -> String {
    if let Some(rest) = value.strip_prefix("data:") {
        if let Some((_, b64)) = rest.split_once(";base64,") {
            return b64.to_string();
        }
    }
    value.to_string()
}

fn mime_from_data_url(value: &str) -> Option<String> {
    let rest = value.strip_prefix("data:")?;
    let (mime, _) = rest.split_once(";base64,")?;
    if mime.is_empty() {
        None
    } else {
        Some(mime.to_string())
    }
}

fn push_legacy_attachment_blocks(attachments: Option<&Value>, blocks: &mut Vec<ContentBlock>) {
    let Some(attachments) = attachments.and_then(|a| a.as_array()) else {
        return;
    };

    for att in attachments {
        let att_type = att.get("type").and_then(|t| t.as_str()).unwrap_or("file");
        if att_type == "image" {
            // Prefer nested content parts (assistant-ui CompleteAttachment shape)
            if let Some(content) = att.get("content") {
                let before = blocks.len();
                push_content_blocks(Some(content), blocks);
                if blocks.len() > before {
                    continue;
                }
            }
            if let Some((data, mime)) = extract_media_payload(att, "image/png") {
                blocks.push(ContentBlock::Image(ImageContent::new(data, mime)));
            }
        } else if let Some(content) = att.get("content") {
            push_content_blocks(Some(content), blocks);
        } else {
            let name = att.get("name").and_then(|n| n.as_str()).unwrap_or("unnamed");
            if let Some((data, mime)) = extract_media_payload(att, "application/octet-stream") {
                if mime.starts_with("text/") || mime == "application/json" {
                    let decoded = STANDARD
                        .decode(&data)
                        .map(|b| String::from_utf8_lossy(&b).into_owned())
                        .unwrap_or_else(|_| data);
                    blocks.push(ContentBlock::Text(TextContent::new(format!(
                        "[File: {name}]\n```\n{decoded}\n```"
                    ))));
                } else {
                    blocks.push(ContentBlock::Text(TextContent::new(format!(
                        "[File: {name} ({mime})]"
                    ))));
                }
            } else {
                blocks.push(ContentBlock::Text(TextContent::new(format!(
                    "[File: {name}]"
                ))));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn image_data(block: &ContentBlock) -> Option<(&str, &str)> {
        match block {
            ContentBlock::Image(img) => Some((img.data.as_str(), img.mime_type.as_str())),
            _ => None,
        }
    }

    fn text_data(block: &ContentBlock) -> Option<&str> {
        match block {
            ContentBlock::Text(t) => Some(t.text.as_str()),
            _ => None,
        }
    }

    #[test]
    fn plain_text_content() {
        let input = json!({
            "messages": [{ "role": "user", "content": "hello" }]
        });
        let blocks = build_prompt_blocks(&input);
        assert_eq!(blocks.len(), 1);
        assert_eq!(text_data(&blocks[0]), Some("hello"));
    }

    #[test]
    fn agui_multimodal_image_source() {
        let input = json!({
            "messages": [{
                "role": "user",
                "content": [
                    { "type": "text", "text": "see this" },
                    {
                        "type": "image",
                        "source": {
                            "type": "data",
                            "value": "iVBORw0KGgo=",
                            "mimeType": "image/png"
                        }
                    }
                ]
            }]
        });
        let blocks = build_prompt_blocks(&input);
        assert_eq!(blocks.len(), 2);
        assert_eq!(text_data(&blocks[0]), Some("see this"));
        assert_eq!(
            image_data(&blocks[1]),
            Some(("iVBORw0KGgo=", "image/png"))
        );
    }

    #[test]
    fn strips_data_url_prefix_from_image_field() {
        let input = json!({
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "image",
                    "image": "data:image/jpeg;base64,/9j/4AAQ"
                }]
            }]
        });
        let blocks = build_prompt_blocks(&input);
        assert_eq!(blocks.len(), 1);
        assert_eq!(image_data(&blocks[0]), Some(("/9j/4AAQ", "image/jpeg")));
    }

    #[test]
    fn text_document_decodes_base64() {
        let hello = STANDARD.encode(b"hello file");
        let input = json!({
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "document",
                    "source": {
                        "type": "data",
                        "value": hello,
                        "mimeType": "text/plain"
                    },
                    "metadata": { "filename": "note.txt" }
                }]
            }]
        });
        let blocks = build_prompt_blocks(&input);
        assert_eq!(blocks.len(), 1);
        let text = text_data(&blocks[0]).unwrap();
        assert!(text.contains("[File: note.txt]"));
        assert!(text.contains("hello file"));
    }

    #[test]
    fn legacy_attachments_image() {
        let input = json!({
            "messages": [{
                "role": "user",
                "content": "caption",
                "attachments": [{
                    "type": "image",
                    "data": "abc123",
                    "mimeType": "image/png"
                }]
            }]
        });
        let blocks = build_prompt_blocks(&input);
        assert_eq!(blocks.len(), 2);
        assert_eq!(text_data(&blocks[0]), Some("caption"));
        assert_eq!(image_data(&blocks[1]), Some(("abc123", "image/png")));
    }

    #[test]
    fn image_only_message_is_valid() {
        let input = json!({
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "image",
                    "source": {
                        "type": "data",
                        "value": "qq",
                        "mimeType": "image/png"
                    }
                }]
            }]
        });
        let blocks = build_prompt_blocks(&input);
        assert_eq!(blocks.len(), 1);
        assert!(image_data(&blocks[0]).is_some());
    }
}
