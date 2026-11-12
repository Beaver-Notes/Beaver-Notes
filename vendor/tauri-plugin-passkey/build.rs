const COMMANDS: &[&str] = &[
    "register",
    "authenticate",
    "send_pin",
    "select_key",
    "cancel",
];

fn main() {
    // if you think these look redundant, you are correct.
    // the cfg guard prevents this block on windows and linux
    // while the env var check prevents this block on ios,
    // because, for reasons, when building for ios, target_os = "macos" here
    #[cfg(target_os = "macos")]
    {
        if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
            use swift_rs::SwiftLinker;
            SwiftLinker::new("14.0")
                .with_package("WebauthnBridge", "macos")
                .link();
        }
    }

    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
