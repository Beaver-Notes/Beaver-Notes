use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder};

/// Generate TypeScript bindings for the pilot workspace command family.
///
/// This is intentionally decoupled from the app's real `invoke_handler` so it
/// can run as a standalone codegen step without affecting runtime behavior.
pub fn generate_bindings() {
    let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        crate::commands::workspace::workspace_list,
        crate::commands::workspace::workspace_get_active,
        crate::commands::workspace::workspace_create,
        crate::commands::workspace::workspace_switch,
        crate::commands::workspace::workspace_rename,
        crate::commands::workspace::workspace_delete,
    ]);

    builder
        .export(
            Typescript::default(),
            "src/lib/tauri/bindings.ts",
        )
        .expect("failed to generate specta bindings");
}
