# 🚪 Portal to the docs

Welcome to the official portal to the documentation for Beaver Notes. This portal is part of the docs and it will walk you through everything you need to know for using and contributing to the Beaver Project.

## What's Inside

- **User Guide**: If you're a user, you'll find detailed instructions on how to install Beaver Notes on your preferred platform and get started with note-taking. Explore the user-friendly interface, unleash the power of Markdown formatting, and learn how to stay organized with tags.

- **Developer Guide**: For developers, we provide a step-by-step guide to set up your local development environment. From cloning the repository to building and testing the app, we've got you covered. Learn how to contribute code, improve documentation, and engage with the Beaver Notes community.

## Let's Begin

Ready to dive into the world of Beaver Notes? Whether you're a user or a developer, the navigation menu on the left will guide you through the various sections of this documentation. Let's take your productivity to new heights with Beaver Notes!

Let's start this exciting journey together by visiting the [docs](https://danieles-organization.gitbook.io/beaver-notes/).

---

## Mobile Development Notes

### iOS

Before running `yarn dev:ios "iPhone 16e"` (or any simulator), the simulator must be booted first or the install step will fail with a "Unable to lookup in current state: Shutdown" error.

```bash
xcrun simctl boot "iPhone 16e"
open -a Simulator
# Wait for the home screen to appear, then:
yarn dev:ios "iPhone 16e"
```

### Android — libsodium pre-build (one-time setup)

The `tauri-plugin-stronghold` dependency pulls in `iota_stronghold` → `libsodium-sys-stable`, which tries to build libsodium from C source during the Rust cross-compilation step. Without intervention it builds libsodium for the macOS host instead of Android ARM64, leaving `sodium_free` as an unresolved dynamic symbol and crashing at app launch with:

```
java.lang.UnsatisfiedLinkError: dlopen failed: cannot locate symbol "sodium_free"
```

The fix is to pre-build libsodium for Android ARM64 once using libsodium's own NDK build script, then tell cargo where to find it via `SODIUM_LIB_DIR`.

**Step 1 — Build libsodium for Android ARM64 (once per machine):**

The build scripts require the release tarball (not a git clone), as the git repo intentionally omits the generated `configure` script.

```bash
cd /tmp
curl -LO https://download.libsodium.org/libsodium/releases/LATEST.tar.gz
tar xzf LATEST.tar.gz
cd libsodium-stable
export ANDROID_NDK_HOME=~/Library/Android/sdk/ndk/$(ls ~/Library/Android/sdk/ndk | tail -1)
export NDK_PLATFORM=android-28
./dist-build/android-armv8-a.sh
mkdir -p ~/.libsodium-android
cp -r /tmp/libsodium-stable/libsodium-android-armv8-a+crypto/* ~/.libsodium-android/
```

This produces a static library at `~/.libsodium-android/lib/libsodium.a`.

**Step 2 — Add `SODIUM_LIB_DIR` to your shell profile:**

```bash
# ~/.zshrc (or ~/.bashrc)
export SODIUM_LIB_DIR="$HOME/.libsodium-android/lib"
```

Then reload: `source ~/.zshrc`

**Step 3 — Clean and run:**

```bash
cd src-tauri
cargo clean --target aarch64-linux-android
cd ..
yarn dev:android
```

> **Future:** `tauri-plugin-stronghold` is planned for deprecation in Tauri v3. The long-term replacement is a combination of platform-native backends: `keyring` (macOS/Windows/Linux) and `keystore` (Android/iOS).
