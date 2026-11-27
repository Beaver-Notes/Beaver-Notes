const COMMANDS: &[&str] = &["share_text", "share_file", "getPendingShare", "clearPendingShare"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
