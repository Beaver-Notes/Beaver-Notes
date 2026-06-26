# Tauri Plugin — SpotSearch

[![Crates.io](https://img.shields.io/crates/v/tauri-plugin-spotsearch.svg)](https://crates.io/crates/tauri-plugin-spotsearch)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [Tauri](https://tauri.app) plugin that indexes app content into **iOS Core Spotlight**, making it searchable via the system-level Spotlight search.

## Platform Support

| Platform | Supported |
|----------|-----------|
| iOS      | ✅        |
| macOS    | ✅        |
| Windows  | ❌ (stub) |
| Linux    | ❌ (stub) |
| Android  | ❌        |

## Installation

Add the plugin to your `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-spotsearch = "0.1"
```

Register the plugin in your Tauri app:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_spotsearch::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Commands

| Command          | Description                                           |
|------------------|-------------------------------------------------------|
| `enable_indexing`| Enables or disables Spotlight indexing (reserved).    |
| `index_items`    | Indexes an array of items into Core Spotlight.        |
| `delete_items`   | Removes specific items from the index by ID.          |
| `delete_domain`  | Removes all items belonging to a domain.              |

### SpotItem

```ts
interface SpotItem {
    id: string;
    domain: string;
    title: string;
    snippet?: string;
    keywords?: string[];
    url?: string;
    thumbnailBase64?: string;
}
```

### JavaScript / TypeScript

```ts
import { indexItems, deleteItems, deleteDomain } from "tauri-plugin-spotsearch";

await indexItems({
    items: [{
        id: "note-1",
        domain: "notes",
        title: "Meeting Notes",
        snippet: "Discussed Q3 roadmap...",
        keywords: ["meeting", "roadmap"],
    }],
});

await deleteItems({ ids: ["note-1"] });
await deleteDomain({ domain: "notes" });
```

## License

MIT
