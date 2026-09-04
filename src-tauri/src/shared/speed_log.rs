//! Temp speed instrumentation: toggle with one switch, remove in one pass. Enable: BEAVER_SPEED_LOG=1.
//! Cleanup: delete speed_log::scope call sites, then this module and its mod line.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

static INIT: AtomicBool = AtomicBool::new(false);
static ENABLED: AtomicBool = AtomicBool::new(false);

/// Whether speed logging is on. Reads BEAVER_SPEED_LOG once, caches it.
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

/// Threshold in ms: hides high-frequency micro-ops (e.g. db_get) from log.
const MIN_LOG_MS: u128 = 1;

/// Start timing a scope; None when disabled. Guard prints on drop.
pub(crate) fn scope(label: &'static str) -> Option<ScopeTimer> {
    enabled().then(|| ScopeTimer {
        label,
        start: Instant::now(),
        logged: false,
    })
}

/// Emit one-off duration entry (caller already timed it).
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
