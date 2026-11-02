use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{Local, NaiveDateTime, TimeZone, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

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
    path: String,
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

/// Create `<base>/<prefix>_<random>` owner-only, exclusively. `create` (not
/// `create_dir_all`) fails when the name already exists, so a planted directory
/// or symlink can never be adopted; collisions retry with a fresh suffix.
fn create_private_stage_dir(base: &Path, prefix: &str) -> Result<PathBuf, AppError> {
    use rand::RngCore;
    let mut last_err = None;
    for _ in 0..4 {
        let mut suffix = [0u8; 8];
        rand::thread_rng().fill_bytes(&mut suffix);
        let dir = base.join(format!("{prefix}_{}", hex::encode(suffix)));
        let created = {
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                std::fs::DirBuilder::new().mode(0o700).create(&dir)
            }
            #[cfg(not(unix))]
            std::fs::DirBuilder::new().create(&dir)
        };
        match created {
            Ok(()) => return Ok(dir),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                last_err = Some(e);
                break;
            }
        }
    }
    Err(AppError::Io(match last_err {
        Some(e) => format!("{}: {e}", base.display()),
        None => format!("{}: staging name collision", base.display()),
    }))
}

/// SC-2-06: refuse to write through a pre-placed symlink or existing file —
/// `create_new` is O_EXCL, so a shared-temp race cannot redirect attacker-
/// controlled bytes to an arbitrary destination.
fn write_stage_bytes(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let mut file = {
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(path)
        }
        #[cfg(not(unix))]
        fs::OpenOptions::new().write(true).create_new(true).open(path)
    }
    .map_err(|error| AppError::Io(format!("{}: {}", path.display(), error)))?;
    file.write_all(bytes)
        .map_err(|error| AppError::Io(format!("{}: {}", path.display(), error)))?;
    Ok(())
}

fn resolve_import_stage_dir(app: &AppHandle, prefix: &str) -> Result<PathBuf, AppError> {
    let mut bases = vec![std::env::temp_dir()];
    if let Ok(dir) = app.path().temp_dir() {
        if !bases.contains(&dir) {
            bases.push(dir);
        }
    }
    let mut tried = Vec::new();
    for base in &bases {
        if let Ok(entries) = fs::read_dir(base) {
            let scope = format!("{prefix}_");
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with(&scope) {
                    let _ = fs::remove_dir_all(entry.path());
                }
            }
        }
    }
    for base in bases {
        match create_private_stage_dir(&base, prefix) {
            Ok(dir) => {
                let probe = dir.join(".write-probe");
                if fs::write(&probe, b"probe").is_ok() {
                    let _ = fs::remove_file(&probe);
                    return Ok(dir);
                }
                tried.push(dir.display().to_string());
            }
            Err(_) => continue,
        }
    }
    Err(AppError::Io(format!(
        "No writable import staging dir (tried {}).",
        tried.join(", ")
    )))
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

fn parse_evernote_resources(
    note_block: &str,
    temp_dir: &Path,
) -> Result<Vec<ImportResourcePayload>, AppError> {
    extract_tag_blocks(note_block, "resource")
        .into_iter()
        .enumerate()
        .map(|(index, resource_block)| {
            let data = strip_cdata(&extract_tag_value(&resource_block, "data").unwrap_or_default());
            // ENEX wraps base64 payloads in newlines; STANDARD rejects whitespace.
            let compact: String = data.chars().filter(|c| !c.is_whitespace()).collect();
            let mime = decode_xml_entities(
                &extract_tag_value(&resource_block, "mime").unwrap_or_default(),
            );
            let bytes = BASE64.decode(compact.as_bytes())?;
            let hash = format!("{:x}", md5::compute(&bytes));
            let file_name = extract_tag_value(&resource_block, "file-name")
                .map(|value| decode_xml_entities(&value))
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| hash.clone());

            let file_path = temp_dir.join(format!("{hash}_{index}"));
            write_stage_bytes(&file_path, &bytes)
                .map_err(|error| AppError::Io(format!("{}: {}", file_path.display(), error)))?;

            Ok(ImportResourcePayload {
                hash,
                mime,
                filename: file_name,
                path: file_path.to_string_lossy().to_string(),
            })
        })
        .collect()
}

fn parse_evernote_note(
    note_block: &str,
    notebook_name: Option<String>,
    temp_dir: &Path,
) -> Result<ImportNotePayload, AppError> {
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
    let resources = parse_evernote_resources(note_block, temp_dir)?;
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

// Apple Notes attachment import. AppleScript technique adapted from
// sweetrb/apple-notes-mcp (MIT, (c) 2025 Rob Sweet): enumerate
// `attachments of note`, then `save theAttachment in (POSIX file ...)`.
// `save` runs inside Notes.app, so attachment bytes are readable with only
// the Automation permission; no Full Disk Access needed.
struct AppleAttachment {
    note_index: usize,
    attach_index: usize,
    note_id: String,
    attach_id: String,
    name: String,
    content_id: String,
    url: String,
}

fn escape_applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn sanitize_import_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
                || c.is_control()
            {
                '-'
            } else {
                c
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn escape_import_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn guess_apple_mime(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" | "heif" => "image/heic",
        "tif" | "tiff" => "image/tiff",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "md" | "markdown" => "text/plain",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "mov" => "video/quicktime",
        "mp4" | "m4v" => "video/mp4",
        _ => "application/octet-stream",
    }
}

fn apple_stage_name(note_index: usize, attach_index: usize) -> String {
    format!("{note_index}_{attach_index}")
}

fn parse_apple_attachments(
    meta: &str,
    note_id: &str,
    note_index: usize,
) -> Vec<AppleAttachment> {
    meta.lines()
        .filter_map(|line| line.strip_prefix("ATTACH:"))
        .enumerate()
        .filter_map(|(attach_index, rest)| {
            let mut fields = rest.split('\t');
            Some(AppleAttachment {
                note_index,
                attach_index,
                note_id: note_id.to_string(),
                attach_id: fields.next()?.to_string(),
                name: fields.next().unwrap_or("").to_string(),
                content_id: fields.next().unwrap_or("").to_string(),
                url: fields.next().unwrap_or("").to_string(),
            })
        })
        .filter(|attachment| !attachment.attach_id.is_empty())
        .collect()
}

fn apply_apple_resources(
    mut content: String,
    attachments: &[AppleAttachment],
    stage_dir: &Path,
) -> (String, Vec<ImportResourcePayload>) {
    let mut resources = Vec::new();
    let mut used_names = std::collections::HashSet::new();
    let mut missing = Vec::new();
    let mut links = Vec::new();

    for attachment in attachments {
        let staged = stage_dir.join(apple_stage_name(
            attachment.note_index,
            attachment.attach_index,
        ));
        let bytes = fs::read(&staged).ok().filter(|data| !data.is_empty());
        let Some(bytes) = bytes else {
            if !attachment.url.is_empty() {
                links.push(attachment);
            } else if !attachment.name.is_empty() {
                missing.push(attachment.name.clone());
            }
            continue;
        };

        let hash = format!("{:x}", md5::compute(&bytes));
        let mut filename = sanitize_import_filename(&attachment.name);
        if filename.is_empty() {
            filename = hash.clone();
        }
        if !used_names.insert(filename.clone()) {
            let stem = format!("{filename}-{}", attachment.attach_index);
            filename = stem.clone();
            used_names.insert(stem);
        }
        if !attachment.content_id.is_empty() {
            content = content.replace(
                &format!("cid:{}", attachment.content_id),
                &format!("resource://{hash}"),
            );
        }
        resources.push(ImportResourcePayload {
            hash,
            mime: guess_apple_mime(&filename).to_string(),
            filename,
            path: staged.to_string_lossy().to_string(),
        });
    }

    // Staged files stay on disk: the frontend copies each resource into the
    // note asset dir while processing import-progress notes, which happens
    // after import-complete. Stale stage dirs are swept at the next import.
    for attachment in links {
        content.push_str(&format!(
            "<p><a href=\"{}\">{}</a></p>",
            escape_import_html(&attachment.url),
            escape_import_html(if attachment.name.is_empty() {
                &attachment.url
            } else {
                &attachment.name
            }),
        ));
    }
    for name in missing {
        content.push_str(&format!(
            "<p>[Attachment not transferred: {}]</p>",
            escape_import_html(&name),
        ));
    }

    (content, resources)
}

fn parse_apple_note_block(block: &str) -> Result<ImportNotePayload, AppError> {
    let body_marker = "BODY:\n";
    let body_index = block
        .find(body_marker)
        .ok_or_else(|| AppError::Other("Missing BODY section".into()))?;
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
#[specta::specta]
pub(crate) async fn import_evernote(
    app: AppHandle,
    state: State<'_, AppState>,
    enex_path: String,
    notebook_name: Option<String>,
) -> Result<(), AppError> {
    // SC-2-10: the .enex read must respect the same path gate as every other
    // fs command, or the error path leaks an existence/permission oracle for
    // arbitrary paths.
    {
        let state_inner = state.inner();
        crate::shared::assert_path_access(
            &app,
            state_inner,
            Path::new(&enex_path),
            "evernote import",
        )?;
    }
    let app_handle = app.clone();
    std::thread::spawn(move || {
        // Error payloads carry the file name only: the full granted path must
        // not be echoed back into the renderer (SC-2-11 round-1 fix).
        let display_name = Path::new(&enex_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Evernote import")
            .to_string();
        let temp_dir = match resolve_import_stage_dir(&app_handle, "beaver_import") {
            Ok(dir) => dir,
            Err(error) => {
                let _ = app_handle.emit_to(
                    MAIN_WINDOW_LABEL,
                    "import-complete",
                    ImportCompletePayload {
                        source: "evernote",
                        imported: 0,
                        errors: vec![ImportErrorPayload {
                            title: display_name.clone(),
                            reason: format!("{display_name}: {error}"),
                        }],
                    },
                );
                return;
            }
        };

        let raw = match fs::read(&enex_path) {
            Ok(bytes) => bytes,
            Err(error) => {
                let _ = fs::remove_dir_all(&temp_dir);
                let _ = app_handle.emit_to(
                    MAIN_WINDOW_LABEL,
                    "import-complete",
                    ImportCompletePayload {
                        source: "evernote",
                        imported: 0,
                        errors: vec![ImportErrorPayload {
                            title: display_name.clone(),
                            reason: format!("{display_name}: {error}"),
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
            match parse_evernote_note(note_block, notebook_name.clone(), &temp_dir) {
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
                        reason: error.to_string(),
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

fn emit_apple_complete(
    app_handle: &AppHandle,
    imported: usize,
    errors: Vec<ImportErrorPayload>,
) {
    let _ = app_handle.emit_to(
        MAIN_WINDOW_LABEL,
        "import-complete",
        ImportCompletePayload {
            source: "apple-notes",
            imported,
            errors,
        },
    );
}

fn save_apple_attachments(attachments: &[&AppleAttachment], stage_dir: &Path) {
    if !attachments.iter().any(|a| a.url.is_empty()) {
        return;
    }

    let mut script = String::from("tell application \"Notes\"\n");
    for attachment in attachments.iter().filter(|a| a.url.is_empty()) {
        let target = stage_dir.join(apple_stage_name(
            attachment.note_index,
            attachment.attach_index,
        ));
        script.push_str(&format!(
            "try\nsave attachment id \"{}\" of note id \"{}\" in (POSIX file \"{}\")\nend try\n",
            escape_applescript_string(&attachment.attach_id),
            escape_applescript_string(&attachment.note_id),
            escape_applescript_string(&target.to_string_lossy()),
        ));
    }
    script.push_str("end tell\n");

    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output();
    // Success is determined per file: only files Notes actually wrote become
    // resources; the rest fall back to links or placeholders.
}

fn read_apple_meta_line(meta: &str, prefix: &str) -> String {
    meta.lines()
        .find_map(|line| line.strip_prefix(prefix))
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

#[tauri::command]
#[specta::specta]
#[cfg(target_os = "macos")]
pub(crate) async fn import_apple_notes(app: AppHandle) -> Result<(), AppError> {
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let stage_dir = match app_handle.path().temp_dir() {
            Ok(dir) => {
                // Best-effort sweep of previous runs; the current dir is kept
                // because the frontend reads staged files after import-complete.
                if let Ok(entries) = fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        if entry
                            .file_name()
                            .to_string_lossy()
                            .starts_with("beaver_apple_import_")
                        {
                            let _ = fs::remove_dir_all(entry.path());
                        }
                    }
                }
                // SC-2-06: unpredictable owner-only staging dir; Notes.app
                // writes cannot use O_EXCL, so the private random name is the
                // mitigation against pre-placement.
                match create_private_stage_dir(&dir, "beaver_apple_import") {
                    Ok(stage) => stage,
                    Err(error) => {
                        emit_apple_complete(&app_handle, 0, vec![ImportErrorPayload {
                            title: "Apple Notes".into(),
                            reason: error.to_string(),
                        }]);
                        return;
                    }
                }
            }
            Err(error) => {
                emit_apple_complete(&app_handle, 0, vec![ImportErrorPayload {
                    title: "Apple Notes".into(),
                    reason: error.to_string(),
                }]);
                return;
            }
        };

        let script = r#"
on cleanText(t)
  try
    set t to t as text
  on error
    return ""
  end try
  if t is "missing value" then return ""
  set AppleScript's text item delimiters to {tab, linefeed, return}
  set parts to text items of t
  set AppleScript's text item delimiters to {" "}
  return parts as text
end cleanText
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
      repeat with a in attachments of n
        try
          set aId to id of a as text
          set output to output & "ATTACH:" & aId & tab & my cleanText(name of a) & tab & my cleanText(content identifier of a) & tab & my cleanText(URL of a) & linefeed
        end try
      end repeat
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

        let parsed_blocks = note_blocks
            .iter()
            .enumerate()
            .map(|(index, block)| {
                let meta = block.split("BODY:\n").next().unwrap_or("");
                let note_id = read_apple_meta_line(meta, "ID:");
                let attachments = parse_apple_attachments(meta, &note_id, index);
                (block, attachments)
            })
            .collect::<Vec<_>>();

        let all_attachments = parsed_blocks
            .iter()
            .flat_map(|(_, attachments)| attachments.iter())
            .collect::<Vec<_>>();
        save_apple_attachments(&all_attachments, &stage_dir);

        for (index, (block, attachments)) in parsed_blocks.iter().enumerate() {
            match parse_apple_note_block(block).map(|mut note| {
                let (content, resources) =
                    apply_apple_resources(note.content, attachments, &stage_dir);
                note.content = content;
                note.resources = resources;
                note
            }) {
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
                        reason: error.to_string(),
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
#[specta::specta]
#[cfg(not(target_os = "macos"))]
pub(crate) async fn import_apple_notes(_app: AppHandle) -> Result<(), AppError> {
    Err(AppError::Other(
        "Apple Notes import is only available on macOS".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_applescript_strings() {
        assert_eq!(escape_applescript_string("a\"b\\c"), "a\\\"b\\\\c");
        assert_eq!(escape_applescript_string("plain"), "plain");
    }

    #[test]
    fn sanitizes_import_filenames() {
        assert_eq!(sanitize_import_filename("a/b:c*d"), "a-b-c-d");
        assert_eq!(sanitize_import_filename("  ok.png  "), "ok.png");
        assert_eq!(sanitize_import_filename(""), "");
    }

    #[test]
    fn guesses_apple_mime_types() {
        assert_eq!(guess_apple_mime("a.png"), "image/png");
        assert_eq!(guess_apple_mime("a.JPG"), "image/jpeg");
        assert_eq!(guess_apple_mime("a.pdf"), "application/pdf");
        assert_eq!(guess_apple_mime("noext"), "application/octet-stream");
    }

    #[test]
    fn parses_attach_lines() {
        let meta = "ID:note1\nATTACH:aid\tphoto.png\tcid1\t\nATTACH:\nATTACH:\t\t\t\n";
        let attachments = parse_apple_attachments(meta, "note1", 2);
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].attach_id, "aid");
        assert_eq!(attachments[0].name, "photo.png");
        assert_eq!(attachments[0].content_id, "cid1");
        assert_eq!(attachments[0].note_index, 2);
        assert_eq!(attachments[0].attach_index, 0);
    }

    #[test]
    fn decodes_wrapped_enex_resource_data() {
        let dir = std::env::temp_dir().join(format!(
            "beaver_enex_import_test_{}",
            std::process::id()
        ));
        let _ = fs::create_dir_all(&dir);
        // aGVsbG8td29ybGQ= is "hello-world", wrapped the way Evernote wraps it.
        let block = "<resource><mime>text/plain</mime><data encoding=\"base64\">\naGVs\nbG8td29y\nbGQ=\n</data><file-name>hi.txt</file-name></resource>";
        let resources = parse_evernote_resources(block, &dir).unwrap();
        assert_eq!(resources.len(), 1);
        assert_eq!(resources[0].filename, "hi.txt");
        assert_eq!(fs::read(&resources[0].path).unwrap(), b"hello-world");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn applies_apple_resources_with_fallbacks() {
        let dir = std::env::temp_dir().join(format!(
            "beaver_apple_import_test_{}",
            std::process::id()
        ));
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("0_0"), b"fake-png-bytes").unwrap();

        let attachments = vec![
            AppleAttachment {
                note_index: 0,
                attach_index: 0,
                note_id: "n".into(),
                attach_id: "a0".into(),
                name: "photo.png".into(),
                content_id: "cid0".into(),
                url: "".into(),
            },
            AppleAttachment {
                note_index: 0,
                attach_index: 1,
                note_id: "n".into(),
                attach_id: "a1".into(),
                name: "preview".into(),
                content_id: "cid1".into(),
                url: "https://example.com/x".into(),
            },
            AppleAttachment {
                note_index: 0,
                attach_index: 2,
                note_id: "n".into(),
                attach_id: "a2".into(),
                name: "gone.pdf".into(),
                content_id: "cid2".into(),
                url: "".into(),
            },
        ];

        let (content, resources) = apply_apple_resources(
            "<img src=\"cid:cid0\"><img src=\"cid:cid1\">".to_string(),
            &attachments,
            &dir,
        );

        assert_eq!(resources.len(), 1);
        assert_eq!(resources[0].mime, "image/png");
        assert_eq!(resources[0].filename, "photo.png");
        assert!(content.contains(&format!("resource://{}", resources[0].hash)));
        assert!(content.contains("cid:cid1"));
        assert!(content.contains("<a href=\"https://example.com/x\">preview</a>"));
        assert!(content.contains("[Attachment not transferred: gone.pdf]"));

        let _ = fs::remove_dir_all(&dir);
    }

    /// SC-2-06: staging must never write through a pre-placed symlink —
    /// `create_new` (O_EXCL) refuses any existing entry, including a link.
    #[test]
    #[cfg(unix)]
    fn stage_write_refuses_preplaced_symlink() {
        use std::os::unix::fs::symlink;

        let dir = std::env::temp_dir().join(format!(
            "beaver_stage_guard_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let victim = dir.join("victim.txt");
        fs::write(&victim, b"original").unwrap();
        let link = dir.join("aa_0");
        symlink(&victim, &link).unwrap();

        let err = write_stage_bytes(&link, b"attacker-bytes")
            .expect_err("O_EXCL write must refuse an existing symlink");
        let link_name = link.file_name().unwrap().to_string_lossy().into_owned();
        assert!(
            err.to_string().contains(&link_name),
            "unexpected error: {err}"
        );
        assert_eq!(fs::read(&victim).unwrap(), b"original", "target must be untouched");

        let _ = fs::remove_dir_all(&dir);
    }

    /// SC-2-06: stage dirs are unpredictable and owner-only; a collision
    /// retries with a fresh name instead of adopting an existing directory.
    #[test]
    #[cfg(unix)]
    fn stage_dirs_are_random_and_private() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!(
            "beaver_stage_dir_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let first = create_private_stage_dir(&dir, "beaver_import").unwrap();
        let second = create_private_stage_dir(&dir, "beaver_import").unwrap();
        assert_ne!(first, second, "names must be unpredictable per run");
        let suffix = first
            .file_name()
            .unwrap()
            .to_string_lossy()
            .rsplit('_')
            .next()
            .unwrap()
            .to_string();
        assert_eq!(suffix.len(), 16, "random suffix must be 8 bytes hex");
        assert!(
            suffix.bytes().all(|b| b.is_ascii_hexdigit()),
            "suffix must be hex, got {suffix}"
        );
        let mode = fs::metadata(&first).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700, "stage dir must be owner-only");

        let _ = fs::remove_dir_all(&dir);
    }
}
