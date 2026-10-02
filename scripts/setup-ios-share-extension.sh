#!/usr/bin/env bash
# Wires the iOS Share Extension into the generated Xcode project.
# Idempotent: safe to re-run after `tauri ios init` regenerates gen/apple.
# Modeled on decentpaste's setup script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src-tauri/ios/ShareExtension"
GEN="$ROOT/src-tauri/gen/apple"

copy_extension_files() {
  mkdir -p "$GEN/ShareExtension"
  cp "$SRC"/AppGroupBridge.swift "$SRC"/ShareViewController.swift "$SRC"/Info.plist "$GEN/ShareExtension/"
  # Extension + host app share one App Group; keep both entitlements identical.
  cp "$SRC"/ShareExtension.entitlements "$GEN/ShareExtension/ShareExtension.entitlements"
  cp "$SRC"/ShareExtension.entitlements "$GEN/beaver-notes_iOS/beaver-notes_iOS.entitlements"
}

patch_project_yml() {
  python3 - "$GEN/project.yml" <<'EOF'
import sys

path = sys.argv[1]
with open(path) as f:
    text = f.read()

target_block = '''  ShareExtension:
    type: app-extension
    platform: iOS
    sources:
      - path: ShareExtension
        excludes:
          - "*.entitlements"
    info:
      path: ShareExtension/Info.plist
    entitlements:
      path: ShareExtension/ShareExtension.entitlements
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.beavernotes.beaver-notes.ShareExtension
        MARKETING_VERSION: "5.0.0"
        CURRENT_PROJECT_VERSION: "5.0.0"
        TARGETED_DEVICE_FAMILY: "1,2"
        SWIFT_VERSION: "5.0"
        CODE_SIGN_STYLE: Automatic
        DEVELOPMENT_TEAM: F8U6VTU2DJ
        GENERATE_INFOPLIST_FILE: NO
        SKIP_INSTALL: YES
        IPHONEOS_DEPLOYMENT_TARGET: "14.0"
'''

embed_dep = '''      - target: ShareExtension
        embed: true
        codeSign: true
'''

changed = False
if '\n  ShareExtension:' not in text:
    if not text.endswith('\n'):
        text += '\n'
    text += '\n' + target_block
    changed = True

if 'target: ShareExtension' not in text:
    anchor = '      - sdk: WebKit.framework\n'
    assert anchor in text, 'expected WebKit.framework dependency line in project.yml'
    text = text.replace(anchor, anchor + embed_dep, 1)
    changed = True

if changed:
    with open(path, 'w') as f:
        f.write(text)
EOF
}

copy_extension_files
patch_project_yml

(cd "$GEN" && xcodegen generate)

# xcodegen rewrites Info.plist / entitlements it manages — restore ours last.
copy_extension_files
