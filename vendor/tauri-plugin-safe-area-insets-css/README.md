# Tauri Plugin — Safe Area Insets CSS

[![Crates.io](https://img.shields.io/crates/v/tauri-plugin-safe-area-insets-css.svg)](https://crates.io/crates/tauri-plugin-safe-area-insets-css)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [Tauri](https://tauri.app) plugin that provides **safe area insets** as CSS variables for mobile apps. Handles notch (top), home indicator (bottom), **keyboard avoidance**, **Apple Pencil Scribble** interaction control, and **background color synchronization** between web content and the native view.

## Platform Support

| Platform | Supported                        |
|----------|----------------------------------|
| iOS      | ✅ (full implementation)         |
| Android  | ✅ (Kotlin plugin)               |
| macOS    | ✅ (stub — returns 0)            |
| Windows  | ✅ (stub — returns 0)            |
| Linux    | ✅ (stub — returns 0)            |

## Installation

Add the plugin to your `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-safe-area-insets-css = "0.2"
```

Register the plugin in your Tauri app:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_safe_area_insets_css::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Commands

| Command              | Description                                           |
|----------------------|-------------------------------------------------------|
| `get_top_inset`      | Returns the top safe area inset in pixels.            |
| `get_bottom_inset`   | Returns the bottom safe area inset in pixels.         |
| `set_scribble_enabled`| Enables or disables Apple Pencil Scribble (iOS 14+). |
| `set_scribble_targets` | Limits Scribble to reported editable-field rectangles (iOS 14+). |

### Events

| Event              | Description                      |
|--------------------|----------------------------------|
| `keyboard_shown`   | Emitted when the keyboard opens. |
| `keyboard_hidden`  | Emitted when the keyboard closes.|

### JavaScript / TypeScript

```ts
import { getTopInset, getBottomInset, setScribbleEnabled, setScribbleTargets } from "tauri-plugin-safe-area-insets-css";

const top = await getTopInset();
const bottom = await getBottomInset();
await setScribbleEnabled({ enabled: false });
await setScribbleTargets({ targets: [{ left: 0, top: 0, width: 300, height: 48 }] });
```

The safe area values are also automatically injected as CSS custom properties:

```css
:root {
    --safe-area-inset-top: 47px;
    --safe-area-inset-bottom: 34px;
}
```

## iOS Implementation

The iOS plugin (`InsetPlugin.swift`) provides:

- Real-time safe area inset queries via `UIApplication.shared.windows.first?.safeAreaInsets`
- Keyboard show/hide observation with webview resizing
- `UIScribbleInteraction` delegate to toggle Apple Pencil Scribble
- Native background color sync from web content

## License

MIT

## Local patch

This vendored copy diverges from upstream. Added:

- `get_fold_state` / `getFoldState` — fold crease, posture, hinge angle and
  vertical bar edge (iOS 27.1 `UIView.reservedRegions`, Android `androidx.window`).

Re-vendoring upstream will drop this; port the patch forward, do not regenerate.
