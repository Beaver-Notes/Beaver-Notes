//! Siphons Rust (`eprintln!`) + JS (`logger`) output into one rotating file.
//!
//! Rust call sites use `crate::rs_log!(...)` (same syntax as `eprintln!`);
//! JS forwards through the `push_js_logs` command (see `src/utils/logger.js`).
//! File: `$BEAVER_LOG_FILE` when set, else `<app_log_dir>/beaver.log`
//! (8 MB cap, one `.1` backup). The override lets two dev instances log apart.

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_BYTES: u64 = 8 * 1024 * 1024;

static WRITER: OnceLock<Mutex<BufWriter<File>>> = OnceLock::new();
static LOG_PATH: OnceLock<String> = OnceLock::new();

fn stamp() -> String {
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", t.as_secs(), t.subsec_millis())
}

fn write_line(line: &str) {
    if let Some(m) = WRITER.get() {
        if let Ok(mut w) = m.lock() {
            let _ = writeln!(w, "{line}");
            let _ = w.flush();
        }
    }
}

/// Drop-in for `eprintln!` that also appends to the log file.
pub fn append_rs(line: String) {
    eprintln!("{line}");
    write_line(&format!("{} [rs] {line}", stamp()));
}

#[macro_export]
macro_rules! rs_log {
    ($($t:tt)*) => {
        $crate::log_bridge::append_rs(format!($($t)*))
    };
}

pub fn init(app: &AppHandle) {
    let (dir, path): (PathBuf, PathBuf) = match std::env::var("BEAVER_LOG_FILE") {
        Ok(p) if !p.trim().is_empty() => {
            let path = PathBuf::from(p);
            let dir = path.parent().map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
            (dir, path)
        }
        _ => match app.path().app_log_dir() {
            Ok(d) => (d.clone(), d.join("beaver.log")),
            Err(_) => return,
        },
    };
    open_log(&path, &dir);
}

fn open_log(path: &std::path::Path, dir: &std::path::Path) {
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    // ponytail: single backup generation; add date-based rotation if 16MB total ever matters.
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > MAX_BYTES {
            let mut backup = path.to_path_buf();
            backup.set_extension("log.1");
            let _ = std::fs::rename(path, backup);
        }
    }
    if let Ok(file) = OpenOptions::new().create(true).append(true).open(path) {
        LOG_PATH.set(path.to_string_lossy().into_owned()).ok();
        WRITER.set(Mutex::new(BufWriter::new(file))).ok();
    }
}

/// Lets a test read what `rs_log!` wrote. Both `OnceLock`s are set at most once per
/// process, so this is only usable by the first test that asks for it.
#[cfg(test)]
pub(crate) fn init_for_test(path: &std::path::Path) {
    open_log(path, path.parent().unwrap_or(std::path::Path::new(".")));
}

/// JS logger batches lines and flushes here (already timestamped client-side).
#[tauri::command]
pub fn push_js_logs(lines: Vec<String>) {
    for line in lines {
        write_line(&line);
    }
}

#[tauri::command]
pub fn log_file_path() -> String {
    LOG_PATH.get().cloned().unwrap_or_default()
}
