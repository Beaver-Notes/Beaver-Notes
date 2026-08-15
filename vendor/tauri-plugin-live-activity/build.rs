const COMMANDS: &[&str] = &[
    "live_activity_start",
    "live_activity_update",
    "live_activity_end",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
