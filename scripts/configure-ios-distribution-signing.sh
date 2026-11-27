#!/usr/bin/env bash
# Installs the host and ShareExtension App Store profiles and writes export options
# that map both bundle IDs, so Xcode signs the embedded extension with its entitlements.
set -euo pipefail

: "${IOS_CERTIFICATE_BASE64:?IOS_CERTIFICATE_BASE64 is not set}"
: "${IOS_MOBILE_PROVISION_BASE64:?IOS_MOBILE_PROVISION_BASE64 is not set}"
: "${IOS_SHARE_EXTENSION_PROVISION_BASE64:?IOS_SHARE_EXTENSION_PROVISION_BASE64 is not set}"
: "${KEYCHAIN_PASSWORD:?KEYCHAIN_PASSWORD is not set}"

TEAM_ID=F8U6VTU2DJ
HOST_ID=com.beavernotes.beaver-notes
EXTENSION_ID=com.beavernotes.beaver-notes.ShareExtension
APP_GROUP=group.com.beavernotes.beaver-notes

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEN="$ROOT/src-tauri/gen/apple"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ios-signing.XXXXXX")"
CERTIFICATE_PATH="$TMP/certificate.p12"
HOST_PROFILE_PATH="$TMP/host.mobileprovision"
EXTENSION_PROFILE_PATH="$TMP/share-extension.mobileprovision"
KEYCHAIN_PATH="$TMP/signing.keychain-db"

decode_base64() {
  printf '%s' "$1" | tr -d '[:space:]' | base64 -d > "$2"
}

profile_uuid() {
  python3 - "$1" "$TEAM_ID" "$2" "$APP_GROUP" <<'PYEOF'
import plistlib
import subprocess
import sys

path, team_id, bundle_id, app_group = sys.argv[1:5]
profile = plistlib.loads(subprocess.check_output(["security", "cms", "-D", "-i", path]))
entitlements = profile.get("Entitlements") or {}
identifier = entitlements.get("application-identifier")
if isinstance(identifier, list):
    identifier = identifier[0] if identifier else None
expected = f"{team_id}.{bundle_id}"
if identifier != expected:
    sys.exit(f"profile {path} has application-identifier {identifier!r}, expected {expected!r}")
groups = entitlements.get("com.apple.security.application-groups") or []
if app_group not in groups:
    sys.exit(f"profile {path} is missing App Group {app_group}")
print(profile["UUID"])
PYEOF
}

decode_base64 "$IOS_CERTIFICATE_BASE64" "$CERTIFICATE_PATH"
decode_base64 "$IOS_MOBILE_PROVISION_BASE64" "$HOST_PROFILE_PATH"
decode_base64 "$IOS_SHARE_EXTENSION_PROVISION_BASE64" "$EXTENSION_PROFILE_PATH"

HOST_UUID="$(profile_uuid "$HOST_PROFILE_PATH" "$HOST_ID")"
EXTENSION_UUID="$(profile_uuid "$EXTENSION_PROFILE_PATH" "$EXTENSION_ID")"

echo "::add-mask::$(base64 < "$CERTIFICATE_PATH" | tr -d '[:space:]')"
echo "::add-mask::$(base64 < "$HOST_PROFILE_PATH" | tr -d '[:space:]')"
echo "::add-mask::$(base64 < "$EXTENSION_PROFILE_PATH" | tr -d '[:space:]')"

PROFILE_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"
mkdir -p "$PROFILE_DIR"
cp "$HOST_PROFILE_PATH" "$PROFILE_DIR/$HOST_UUID.mobileprovision"
cp "$EXTENSION_PROFILE_PATH" "$PROFILE_DIR/$EXTENSION_UUID.mobileprovision"

python3 - "$GEN/ExportOptions.plist" "$HOST_UUID" "$EXTENSION_UUID" <<'PYEOF'
import plistlib
import sys

path, host_uuid, extension_uuid = sys.argv[1:4]
options = {
    "method": "app-store-connect",
    "signingStyle": "manual",
    "signingCertificate": "iPhone Distribution",
    "teamID": "F8U6VTU2DJ",
    "provisioningProfiles": {
        "com.beavernotes.beaver-notes": host_uuid,
        "com.beavernotes.beaver-notes.ShareExtension": extension_uuid,
    },
}
with open(path, "wb") as f:
    plistlib.dump(options, f)
PYEOF

# Tauri reads signingStyle from the host target, so make the generated Xcode
# config manual before it builds its temporary export options plist.
python3 - "$GEN/beaver-notes.xcodeproj/project.pbxproj" <<'PYEOF'
import sys

path = sys.argv[1]
with open(path) as f:
    pbx = f.read()
with open(path, "w") as f:
    f.write(pbx.replace("CODE_SIGN_STYLE = Automatic;", "CODE_SIGN_STYLE = Manual;"))
PYEOF

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERTIFICATE_PATH" \
  -P "${IOS_CERTIFICATE_PASSWORD:-}" \
  -A \
  -t cert \
  -f pkcs12 \
  -k "$KEYCHAIN_PATH"
security list-keychains -d user -s "$KEYCHAIN_PATH" login.keychain
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
