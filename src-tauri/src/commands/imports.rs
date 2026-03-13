use std::{fs, path::Path};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{Local, NaiveDateTime, TimeZone, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::shared::*;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportErrorPayload {
    title: String,
    reason: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResourcePayload {
    hash: String,
    mime: String,
    filename: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportNotePayload {
    title: String,
    content: String,
    labels: Vec<String>,
    folder: String,
    created_at: i64,
    updated_at: i64,
    resources: Vec<ImportResourcePayload>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgressPayload {
    source: &'static str,
    done: usize,
    total: usize,
    current: String,
    note: Option<ImportNotePayload>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportCompletePayload {
    source: &'static str,
    imported: usize,
    errors: Vec<ImportErrorPayload>,
}

fn decode_import_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16_lossy(&units);
    }

    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16_lossy(&units);
    }

    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&bytes[3..]).to_string();
    }

    String::from_utf8_lossy(bytes).to_string()
}

fn decode_xml_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .trim()
        .to_string()
}

fn strip_cdata(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("<![CDATA[")
        .trim_end_matches("]]>")
        .trim()
        .to_string()
}

fn extract_tag_value(source: &str, tag: &str) -> Option<String> {
    let open_start = format!("<{tag}");
    let open_index = source.find(&open_start)?;
    let after_open = &source[open_index..];
    let open_end = after_open.find('>')?;
    let inner_start = open_index + open_end + 1;
    let close_tag = format!("</{tag}>");
    let inner_end = source[inner_start..].find(&close_tag)? + inner_start;
    Some(source[inner_start..inner_end].to_string())
}

fn extract_all_tag_values(source: &str, tag: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut remaining = source;
    let open_start = format!("<{tag}");
    let close_tag = format!("</{tag}>");

    while let Some(open_index) = remaining.find(&open_start) {
        let after_open = &remaining[open_index..];
        let Some(open_end) = after_open.find('>') else {
            break;
        };
        let inner_start = open_index + open_end + 1;
        let Some(inner_end) = remaining[inner_start..].find(&close_tag) else {
            break;
        };
        let inner_end = inner_start + inner_end;
        values.push(remaining[inner_start..inner_end].to_string());
        remaining = &remaining[inner_end + close_tag.len()..];
    }

    values
}

fn extract_tag_blocks(source: &str, tag: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut remaining = source;
    let open_tag = format!("<{tag}>");
    let close_tag = format!("</{tag}>");

    while let Some(open_index) = remaining.find(&open_tag) {
        let inner_start = open_index + open_tag.len();
        let Some(inner_end) = remaining[inner_start..].find(&close_tag) else {
            break;
        };
        let inner_end = inner_start + inner_end;
        blocks.push(remaining[inner_start..inner_end].to_string());
        remaining = &remaining[inner_end + close_tag.len()..];
    }

    blocks
}

fn extract_attribute(fragment: &str, name: &str) -> Option<String> {
    let marker = format!(r#"{name}=""#);
    let start = fragment.find(&marker)? + marker.len();
    let end = fragment[start..].find('"')? + start;
    Some(fragment[start..end].to_string())
}

fn parse_enex_timestamp(value: &str) -> i64 {
    NaiveDateTime::parse_from_str(value.trim(), "%Y%m%dT%H%M%SZ")
        .map(|dt| Utc.from_utc_datetime(&dt).timestamp_millis())
        .unwrap_or_else(|_| Utc::now().timestamp_millis())
}

fn parse_apple_notes_timestamp(value: &str) -> i64 {
    let trimmed = value.trim();
    let formats = [
        "%A, %d %B %Y at %H:%M:%S",
        "%A, %-d %B %Y at %H:%M:%S",
        "%A, %d %B %Y at %I:%M:%S %p",
        "%A, %-d %B %Y at %I:%M:%S %p",
    ];

    for format in formats {
        if let Ok(parsed) = NaiveDateTime::parse_from_str(trimmed, format) {
            if let Some(local_dt) = Local.from_local_datetime(&parsed).single() {
                return local_dt.timestamp_millis();
            }
        }
    }

    Utc::now().timestamp_millis()
}

fn strip_processing_instructions(mut value: String) -> String {
    loop {
        let Some(start) = value.find("<?xml") else {
            break;
        };
        let Some(end) = value[start..].find("?>") else {
            break;
        };
        value.replace_range(start..start + end + 2, "");
    }

    loop {
        let Some(start) = value.find("<!DOCTYPE") else {
            break;
        };
        let Some(end) = value[start..].find('>') else {
            break;
        };
        value.replace_range(start..start + end + 1, "");
    }

    value
}

fn replace_en_note_tags(value: String) -> String {
    let mut output = value;
    if let Some(start) = output.find("<en-note") {
        if let Some(end) = output[start..].find('>') {
            output.replace_range(start..start + end + 1, "<div>");
        }
    }
    output.replace("</en-note>", "</div>")
}

fn replace_en_todos(mut value: String) -> String {
    while let Some(start) = value.find("<en-todo") {
        let Some(end) = value[start..].find("/>") else {
            break;
        };
        let fragment = &value[start..start + end + 2];
        let checked = extract_attribute(fragment, "checked")
            .map(|flag| flag == "true")
            .unwrap_or(false);
        let replacement = if checked { "☑ " } else { "☐ " };
        value.replace_range(start..start + end + 2, replacement);
    }
    value
}

fn replace_en_media(mut value: String, resources: &[ImportResourcePayload]) -> String {
    while let Some(start) = value.find("<en-media") {
        let end = if let Some(relative) = value[start..].find("/>") {
            start + relative + 2
        } else if let Some(relative) = value[start..].find('>') {
            start + relative + 1
        } else {
            break;
        };

        let fragment = &value[start..end];
        let hash = extract_attribute(fragment, "hash").unwrap_or_default();
        let replacement = resources
            .iter()
            .find(|resource| resource.hash == hash)
            .map(|resource| {
                if resource.mime.starts_with("image/") {
                    format!(
                        r#"<img src="resource://{}" alt="{}">"#,
                        resource.hash, resource.filename
                    )
                } else {
                    format!(
                        r#"<a href="resource://{}">{}</a>"#,
                        resource.hash, resource.filename
                    )
                }
            })
            .unwrap_or_default();

        value.replace_range(start..end, &replacement);
    }

    value
}

fn parse_evernote_resources(note_block: &str) -> Result<Vec<ImportResourcePayload>, String> {
    extract_tag_blocks(note_block, "resource")
        .into_iter()
        .map(|resource_block| {
            let data = strip_cdata(&extract_tag_value(&resource_block, "data").unwrap_or_default());
            let mime = decode_xml_entities(
                &extract_tag_value(&resource_block, "mime").unwrap_or_default(),
            );
            let bytes = BASE64.decode(data.as_bytes()).map_err(to_error)?;
            let hash = format!("{:x}", md5::compute(&bytes));
            let file_name = extract_tag_value(&resource_block, "file-name")
                .map(|value| decode_xml_entities(&value))
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| hash.clone());

            Ok(ImportResourcePayload {
                hash,
                mime,
                filename: file_name,
                data: BASE64.encode(bytes),
            })
        })
        .collect()
}

fn parse_evernote_note(
    note_block: &str,
    notebook_name: Option<String>,
) -> Result<ImportNotePayload, String> {
    let title = extract_tag_value(note_block, "title")
        .map(|value| decode_xml_entities(&value))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Untitled".to_string());
    let created_at =
        parse_enex_timestamp(&extract_tag_value(note_block, "created").unwrap_or_default());
    let updated_at =
        parse_enex_timestamp(&extract_tag_value(note_block, "updated").unwrap_or_default());
    let labels = extract_all_tag_values(note_block, "tag")
        .into_iter()
        .map(|value| decode_xml_entities(&value))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let resources = parse_evernote_resources(note_block)?;
    let raw_content = strip_cdata(&extract_tag_value(note_block, "content").unwrap_or_default());
    let content = replace_en_media(
        replace_en_todos(replace_en_note_tags(strip_processing_instructions(
            raw_content,
        ))),
        &resources,
    );

    Ok(ImportNotePayload {
        title,
        content,
        labels,
        folder: notebook_name.unwrap_or_default(),
        created_at,
        updated_at,
        resources,
    })
}

fn parse_apple_note_block(block: &str) -> Result<ImportNotePayload, String> {
    let body_marker = "BODY:\n";
    let body_index = block
        .find(body_marker)
        .ok_or_else(|| "Missing BODY section".to_string())?;
    let meta = &block[..body_index];
    let body = &block[body_index + body_marker.len()..];

    let read_line = |prefix: &str| {
        meta.lines()
            .find_map(|line| line.strip_prefix(prefix))
            .map(|value| value.trim().to_string())
            .unwrap_or_default()
    };

    let title = read_line("TITLE:");
    Ok(ImportNotePayload {
        title: if title.is_empty() {
            "Untitled".into()
        } else {
            title
        },
        content: body.trim().to_string(),
        labels: vec![],
        folder: read_line("FOLDER:"),
        created_at: parse_apple_notes_timestamp(&read_line("CREATED:")),
        updated_at: parse_apple_notes_timestamp(&read_line("MODIFIED:")),
        resources: vec![],
    })
}

#[tauri::command]
pub(crate) async fn import_evernote(
    app: AppHandle,
    enex_path: String,
    notebook_name: Option<String>,
) -> Result<(), String> {
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let raw = match fs::read(&enex_path) {
            Ok(bytes) => bytes,
            Err(error) => {
                let _ = app_handle.emit_to(
                    MAIN_WINDOW_LABEL,
                    "import-complete",
                    ImportCompletePayload {
                        source: "evernote",
                        imported: 0,
                        errors: vec![ImportErrorPayload {
                            title: Path::new(&enex_path)
                                .file_name()
                                .and_then(|value| value.to_str())
                                .unwrap_or("Evernote import")
                                .to_string(),
                            reason: error.to_string(),
                        }],
                    },
                );
                return;
            }
        };

        let decoded = decode_import_text(&raw);
        let notes = extract_tag_blocks(&decoded, "note");
        let total = notes.len();
        let mut imported = 0;
        let mut errors = Vec::new();

        for (index, note_block) in notes.iter().enumerate() {
            match parse_evernote_note(note_block, notebook_name.clone()) {
                Ok(note) => {
                    imported += 1;
                    let _ = app_handle.emit_to(
                        MAIN_WINDOW_LABEL,
                        "import-progress",
                        ImportProgressPayload {
                            source: "evernote",
                            done: index + 1,
                            total,
                            current: note.title.clone(),
                            note: Some(note),
                        },
                    );
                }
                Err(error) => {
                    let title = extract_tag_value(note_block, "title")
                        .map(|value| decode_xml_entities(&value))
                        .filter(|value| !value.is_empty())
                        .unwrap_or_else(|| "Untitled".to_string());
                    errors.push(ImportErrorPayload {
                        title: title.clone(),
                        reason: error,
                    });
                    let _ = app_handle.emit_to(
                        MAIN_WINDOW_LABEL,
                        "import-progress",
                        ImportProgressPayload {
                            source: "evernote",
                            done: index + 1,
                            total,
                            current: title,
                            note: None,
                        },
                    );
                }
            }
        }

        let _ = app_handle.emit_to(
            MAIN_WINDOW_LABEL,
            "import-complete",
            ImportCompletePayload {
                source: "evernote",
                imported,
                errors,
            },
        );
    });

    Ok(())
}

#[tauri::command]
#[cfg(target_os = "macos")]
pub(crate) async fn import_apple_notes(app: AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let script = r#"
set output to ""
tell application "Notes"
  repeat with f in folders
    set fName to name of f
    repeat with n in notes of f
      set nTitle to name of n
      set nBody to body of n
      set nId to id of n
      set nCreated to creation date of n
      set nModified to modification date of n
      set output to output & "===NOTE===" & linefeed
      set output to output & "FOLDER:" & fName & linefeed
      set output to output & "TITLE:" & nTitle & linefeed
      set output to output & "ID:" & nId & linefeed
      set output to output & "CREATED:" & (nCreated as string) & linefeed
      set output to output & "MODIFIED:" & (nModified as string) & linefeed
      set output to output & "BODY:" & linefeed
      set output to output & nBody & linefeed
    end repeat
  end repeat
end tell
return output
"#;

        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output();

        let stdout = match output {
            Ok(command_output) if command_output.status.success() => {
                String::from_utf8_lossy(&command_output.stdout).to_string()
            }
            Ok(command_output) => {
                let _ = app_handle.emit_to(
                    MAIN_WINDOW_LABEL,
                    "import-complete",
                    ImportCompletePayload {
                        source: "apple-notes",
                        imported: 0,
                        errors: vec![ImportErrorPayload {
                            title: "Apple Notes".into(),
                            reason: String::from_utf8_lossy(&command_output.stderr)
                                .trim()
                                .to_string(),
                        }],
                    },
                );
                return;
            }
            Err(error) => {
                let _ = app_handle.emit_to(
                    MAIN_WINDOW_LABEL,
                    "import-complete",
                    ImportCompletePayload {
                        source: "apple-notes",
                        imported: 0,
                        errors: vec![ImportErrorPayload {
                            title: "Apple Notes".into(),
                            reason: error.to_string(),
                        }],
                    },
                );
                return;
            }
        };

        let note_blocks = stdout
            .split("===NOTE===")
            .map(str::trim)
            .filter(|block| !block.is_empty())
            .collect::<Vec<_>>();
        let total = note_blocks.len();
        let mut imported = 0;
        let mut errors = Vec::new();

        for (index, block) in note_blocks.iter().enumerate() {
            match parse_apple_note_block(block) {
                Ok(note) => {
                    imported += 1;
                    let _ = app_handle.emit_to(
                        MAIN_WINDOW_LABEL,
                        "import-progress",
                        ImportProgressPayload {
                            source: "apple-notes",
                            done: index + 1,
                            total,
                            current: note.title.clone(),
                            note: Some(note),
                        },
                    );
                }
                Err(error) => {
                    errors.push(ImportErrorPayload {
                        title: "Untitled".into(),
                        reason: error.clone(),
                    });
                    let _ = app_handle.emit_to(
                        MAIN_WINDOW_LABEL,
                        "import-progress",
                        ImportProgressPayload {
                            source: "apple-notes",
                            done: index + 1,
                            total,
                            current: "Untitled".into(),
                            note: None,
                        },
                    );
                }
            }
        }

        let _ = app_handle.emit_to(
            MAIN_WINDOW_LABEL,
            "import-complete",
            ImportCompletePayload {
                source: "apple-notes",
                imported,
                errors,
            },
        );
    });

    Ok(())
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub(crate) async fn import_apple_notes(_app: AppHandle) -> Result<(), String> {
    Err("Apple Notes import is only available on macOS".into())
}
