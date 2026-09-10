//! Siphons Rust (`eprintln!`) + JS (`logger`) output into one rotating file.
//!
//! Rust call sites use `crate::rs_log!(...)` (same syntax as `eprintln!`);
//! JS forwards through the `push_js_logs` command (see `src/utils/logger.js`).
//! File: `<app_log_dir>/beaver.log` (8 MB cap, one `.1` backup).

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
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
    let dir = match app.path().app_log_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("beaver.log");
    // ponytail: single backup generation; add date-based rotation if 16MB total ever matters.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let _ = std::fs::rename(&path, dir.join("beaver.log.1"));
        }
    }
    if let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) {
        LOG_PATH.set(path.to_string_lossy().into_owned()).ok();
        WRITER.set(Mutex::new(BufWriter::new(file))).ok();
    }
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
