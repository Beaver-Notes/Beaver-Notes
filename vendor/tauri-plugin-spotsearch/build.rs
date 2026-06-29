const COMMANDS: &[&str] = &["enable_indexing", "index_items", "delete_items", "delete_domain"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();

    let target = std::env::var("TARGET").unwrap();
    if target.contains("apple-darwin") || target.contains("apple-macosx") {
        cc::Build::new()
            .file("src/macos_spotlight.m")
            .flag("-fobjc-arc")
            .flag("-mmacosx-version-min=11.0")
            .compile("macos_spotlight");
        println!("cargo:rustc-link-lib=framework=CoreSpotlight");
        println!("cargo:rustc-link-lib=framework=UniformTypeIdentifiers");
    }
}
