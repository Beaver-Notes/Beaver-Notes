# Task 5 Report: Rust unit-test baseline

**Status:** DONE_WITH_CONCERNS
**Branch:** development
**Commit:** `b813ff8d` — test: add rust unit-test baseline for error and cache modules

## Tests added

### `src-tauri/src/shared/error.rs` (appended `#[cfg(test)] mod tests`, 7 tests)
- `display_wrong_password` — pins `"Wrong password."`
- `display_encryption_locked` — pins `"App encryption is locked. Unlock before reading assets."`
- `display_crypto_carries_message` — `Crypto(msg)` displays `msg`
- `display_serialization_carries_message` — `Serialization(msg)` displays `msg`
- `display_other_carries_message` — `Other(msg)` displays `msg`
- `display_io_carries_inner_error` — `Io(e)` displays the inner io error's string
- `serialize_emits_plain_display_string` — confirms the **current** `Serialize` impl emits a plain `String` (Task 10 will change this to structured; this test pins today's behavior and must be updated then)

### `src-tauri/src/shared/cache.rs` (appended `#[cfg(test)] mod tests`, 6 tests)
- `insert_then_get_hits` — insert → get returns the value
- `get_missing_key_returns_none` — absent key → None
- `single_oversized_value_is_still_inserted_and_retained` — see Concerns
- `put_of_same_key_updates_value_without_growing_bytes` — replace-in-place
- `byte_limit_evicts_least_recently_used` — exceeding `max_bytes` evicts at least one entry
- `clear_removes_all_entries` — clear empties the cache

## Commands & output

```
cargo test --manifest-path src-tauri/Cargo.toml --lib shared
   running 15 tests
   test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured
```

RED-phase demonstration: the first cut of the oversized test
(`insert_oversized_value_is_not_retained`, asserting `get("big") == None`)
FAILED — `left: Some([1,2,3,4,5,6])`. This revealed that the production
`ByteLruCache::put` does NOT reject oversized single values; it inserts them
verbatim. Because no production-code changes are allowed, the test was
re-characterized to pin this real behavior (`single_oversized_value_is_still_inserted_and_retained`).

```
cargo clippy --manifest-path src-tauri/Cargo.toml --lib --tests
   warning: beaver-notes (lib test) generated 30 warnings (pre-existing)
   -> only hit in cache.rs is line 17 `NonZero::new` = PRE-EXISTING production code
   -> no warnings originate from the new test modules
```

## Files changed
- `src-tauri/src/shared/error.rs` (+70 lines, test module only)
- `src-tauri/src/shared/cache.rs` (+47 lines, test module only)

No production code modified.

## Self-review
- Tests compile only under `#[cfg(test)]`; no runtime impact on the shipped binary.
- Error tests assert exact Display strings read from the file and the current
  string-only serialization contract.
- Cache tests use the real public API (`new`, `put`, `get`, `clear`) with no
  injected clocks/filesystem; `AppState`-bound functions were intentionally left
  untested (they require a constructed `AppState`/Tauri runtime — out of scope).
- All 15 tests pass; clippy clean for added code.

## Concerns
1. **No TTL support in `ByteLruCache`.** The brief mentions "TTL expiry → miss",
   but the real API exposes no TTL/clock knob (`ByteLruCache` only tracks
   `current_bytes`/`max_bytes` and relies on `lru::LruCache`'s LRU). A TTL test
   cannot be written without modifying production code, which is disallowed.
   Recommend Task 10 add a TTL field + injectable clock before TTL tests exist.
2. **Oversized-value behavior is surprising.** A single value larger than
   `max_bytes` is stored and never evicted (the eviction loop is skipped while
   `inner.is_empty()`). This wastes the stated byte budget. Flagged for review in
   Task 10; today's test documents it rather than enforcing rejection.
3. **`Serialize` contract will break in Task 10.** The `serialize_emits_plain_display_string`
   test pins the current plain-string output; it must be updated when Task 10
   switches `AppError` serialization to structured JSON.

---

## Fix: Strengthen cache eviction characterization tests

**Commit:** (to be created)

### Scope
- `src-tauri/src/shared/cache.rs` — test module only; no production code touched.

### Changes

**`byte_limit_evicts_least_recently_used`** (Finding 1 — Important)

Previous version: inserted three 6-byte entries into a 10-byte cache, then asserted *at least one* was evicted. This would pass under random eviction — too weak.

New version: inserts two 4-byte entries ("a" and "b"), promotes "a" via `cache.get("a")` (making "b" the LRU occupant), then inserts "c". Asserts:
- `"b"` (LRU) → `None`
- `"a"` (promoted, still fits) → `Some`
- `"c"` (just inserted) → `Some`

This proves the eviction target is the true LRU key, not an arbitrary one. Verified by tracing `ByteLruCache::put`: it calls `pop_lru()` (pops LRU from the `lru::LruCache` backing store) while the byte budget is exceeded.

**`put_of_same_key_updates_value_without_growing_bytes`** → **`put_of_same_key_updates_value`** (Finding 2 — Minor)

The private `current_bytes` field is inaccessible from tests without modifying production code. Renamed the test to match what it actually asserts (value replacement via same key).

**Test count corrected** (Finding 3 — Minor)

The original report claimed 15 tests. The actual count is 13 (7 in `error.rs`, 6 in `cache.rs`). Corrected number noted here.

### Verification

```
$ cargo test --manifest-path src-tauri/Cargo.toml --lib shared::cache
    Finished `test` profile [unoptimized + debuginfo] target(s) in 2.56s
     Running unittests src/lib.rs

running 6 tests
test shared::cache::tests::single_oversized_value_is_still_inserted_and_retained ... ok
test shared::cache::tests::insert_then_get_hits ... ok
test shared::cache::tests::get_missing_key_returns_none ... ok
test shared::cache::tests::put_of_same_key_updates_value ... ok
test shared::cache::tests::byte_limit_evicts_least_recently_used ... ok
test shared::cache::tests::clear_removes_all_entries ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured

$ cargo clippy --manifest-path src-tauri/Cargo.toml --lib --tests 2>&1 | grep -c "cache.rs"
1
$ # the one cache.rs clippy hit is line 17 `NonZero::new(1024).unwrap()` — pre-existing production code
```
