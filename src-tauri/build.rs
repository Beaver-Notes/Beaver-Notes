fn main() {
    // The device-ai plugin links Swift Concurrency as `@rpath/libswift_Concurrency.dylib`,
    // but the rpaths its build script emits never reach the final app link, so the
    // dev binary dies in dyld at launch. Add the toolchain runtime rpath here, on the
    // top crate, where link-args are guaranteed to be honored.
    #[cfg(target_os = "macos")]
    add_swift_concurrency_rpath();

    tauri_build::build();
}

// Emits `-rpath` to the first Xcode/CLT dir that physically contains the
// Concurrency runtime, plus /usr/lib/swift as a fallback.
#[cfg(target_os = "macos")]
fn add_swift_concurrency_rpath() {
    use std::path::PathBuf;

    let dev_dir = std::process::Command::new("xcode-select")
        .arg("-p")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "/Applications/Xcode.app/Contents/Developer".to_string());

    let toolchains = [
        PathBuf::from(format!(
            "{dev_dir}/Toolchains/XcodeDefault.xctoolchain/usr/lib"
        )),
        PathBuf::from("/Library/Developer/CommandLineTools/usr/lib"),
    ];
    let subdirs = ["swift-5.5/macosx", "swift/macosx"];

    let mut rpaths: Vec<PathBuf> = Vec::new();
    for tc in &toolchains {
        for sub in &subdirs {
            let dir = tc.join(sub);
            if dir.join("libswift_Concurrency.dylib").exists()
                || dir.join("libswift_Concurrency.tbd").exists()
            {
                rpaths.push(dir);
            }
        }
    }
    // /usr/lib/swift FIRST: on macOS 26 the OS ships Concurrency in the dyld
    // cache and other images already bind that copy — loading the toolchain
    // back-deploy as well yields duplicate runtime classes and flaky crashes.
    // Toolchain dirs stay as fallback for older macOS without the OS copy.
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    for dir in rpaths {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", dir.display());
    }
}
