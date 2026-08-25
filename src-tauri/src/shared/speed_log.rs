//! Temporary speed instrumentation. All timing logs go through this module so
//! they can be toggled with one switch and later removed in one pass.
//!
//! Enable with: `BEAVER_SPEED_LOG=1 cargo tauri dev`
//!
//! Cleanup before shipping to production:
//!   1. `rg -l "speed_log::scope" src-tauri/src` and delete each call site.
//!   2. Delete this module (and its `mod speed_log;` line in `shared/mod.rs`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

static INIT: AtomicBool = AtomicBool::new(false);
static ENABLED: AtomicBool = AtomicBool::new(false);

/// Whether speed logging is on. Reads `BEAVER_SPEED_LOG` once and caches it.
pub(crate) fn enabled() -> bool {
    if !INIT.load(Ordering::Relaxed) {
        let on = std::env::var("BEAVER_SPEED_LOG")
            .map(|value| value != "0" && !value.is_empty())
            .unwrap_or(false);
        ENABLED.store(on, Ordering::Relaxed);
        INIT.store(true, Ordering::Relaxed);
    }
    ENABLED.load(Ordering::Relaxed)
}

#[cfg(test)]
pub(crate) fn reset() {
    INIT.store(false, Ordering::Relaxed);
}

/// Only measures at/above this many ms are logged, so high-frequency
/// micro-operations (e.g. db_get) don't spam the log.
const MIN_LOG_MS: u128 = 1;

/// Start timing a scope; `None` when disabled. The guard prints
/// `[speed] <label> took <elapsed>` when dropped.
pub(crate) fn scope(label: &'static str) -> Option<ScopeTimer> {
    enabled().then(|| ScopeTimer {
        label,
        start: Instant::now(),
        logged: false,
    })
}

/// Emit a one-off duration entry (e.g. for a value already timed by the caller).
pub(crate) fn log_duration(label: &str, elapsed: Duration) {
    if enabled() && elapsed.as_millis() >= MIN_LOG_MS {
        eprintln!("[speed] {label} {}ms", elapsed.as_millis());
    }
}

pub(crate) struct ScopeTimer {
    label: &'static str,
    start: Instant,
    logged: bool,
}

impl ScopeTimer {
    pub(crate) fn elapsed(&self) -> Duration {
        self.start.elapsed()
    }

    /// Log immediately and suppress the drop-time log.
    pub(crate) fn finish(mut self) {
        self.log();
        self.logged = true;
    }

    fn log(&self) {
        let ms = self.elapsed().as_millis();
        if ms >= MIN_LOG_MS {
            eprintln!("[speed] {} took {}ms", self.label, ms);
        }
    }
}

impl Drop for ScopeTimer {
    fn drop(&mut self) {
        if !self.logged {
            self.log();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn restore_env() {
        std::env::remove_var("BEAVER_SPEED_LOG");
        reset();
    }

    #[test]
    fn disabled_by_default() {
        restore_env();
        assert!(!enabled());
        assert!(scope("test").is_none());
    }

    #[test]
    fn enabled_with_env_var() {
        std::env::set_var("BEAVER_SPEED_LOG", "1");
        reset();
        assert!(enabled());
        let t = scope("my_label");
        assert!(t.is_some());
    }

    #[test]
    fn disabled_when_env_is_zero() {
        std::env::set_var("BEAVER_SPEED_LOG", "0");
        reset();
        assert!(!enabled());
        assert!(scope("test").is_none());
    }

    #[test]
    fn scope_timer_logs_on_drop() {
        std::env::set_var("BEAVER_SPEED_LOG", "1");
        reset();
        // Can't capture eprintln output without redirecting; verify the guard
        // is created and .log() doesn't panic.
        let guard = scope("drop_test").unwrap();
        guard.log(); // should print to stderr
        // finish() consumes and logs
        let guard = scope("finish_test").unwrap();
        guard.finish();
    }

    #[test]
    fn log_duration_noop_when_disabled() {
        restore_env();
        log_duration("noop", Duration::from_millis(42));
        // Should not panic and not emit anything.
    }
}
