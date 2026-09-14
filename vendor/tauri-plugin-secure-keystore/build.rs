const COMMANDS: &[&str] = &["wrap", "unwrap", "hasKey", "deleteKey"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
