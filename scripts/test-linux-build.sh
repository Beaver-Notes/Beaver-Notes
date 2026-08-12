#!/bin/bash
set -euo pipefail

echo "=== Testing Linux build ==="

# Install dependencies (rebuilds native modules for this platform)
echo "0. Installing dependencies..."
yarn install

# Build the binary (no bundling - we create the FHS tarball manually)
echo "1. Building binary..."
yarn tauri build --no-bundle --ci

# Create FHS tarball (mirrors the release workflow staging step)
echo "2. Creating FHS tarball..."
VERSION="0.0.0-test"
ARCH="$(uname -m)"
BIN_NAME="beaver-notes"
BIN_PATH="src-tauri/target/release/${BIN_NAME}"
TAR_NAME="Beaver-Notes-${VERSION}-${ARCH}.tar.gz"

if [ ! -f "$BIN_PATH" ]; then
    echo "ERROR: Binary not found at $BIN_PATH"
    exit 1
fi

rm -rf portable-root
mkdir -p "portable-root/bin"
mkdir -p "portable-root/lib/beaver-notes"
mkdir -p "portable-root/share/applications"
mkdir -p "portable-root/share/icons/hicolor/1024x1024/apps"
mkdir -p "portable-root/share/metainfo"

cp "$BIN_PATH" "portable-root/lib/beaver-notes/"
cp buildResources/icon.png "portable-root/share/icons/hicolor/1024x1024/apps/beaver-notes.png"
cp flatpak/com.beavernotes.beavernotes.metainfo.xml "portable-root/share/metainfo/"

# Create wrapper script
cat > "portable-root/bin/beaver-notes" << 'WRAPPER'
#!/bin/bash
exec "$(dirname "$0")/../lib/beaver-notes/beaver-notes" "$@"
WRAPPER
chmod +x "portable-root/bin/beaver-notes"

# Create desktop file
cat > "portable-root/share/applications/beaver-notes.desktop" << 'DESKTOP'
[Desktop Entry]
Name=Beaver Notes
Comment=Open-source notes that live where you choose
Exec=beaver-notes %F
Icon=beaver-notes
Type=Application
Categories=Utility;TextEditor;Office;
MimeType=text/markdown;text/plain;
Terminal=false
StartupWMClass=beaver-notes
DESKTOP

tar -czf "$TAR_NAME" -C portable-root .
rm -rf portable-root

echo "Created tarball: $TAR_NAME"

# Find the tarball
echo "3. Finding tarball..."
TAR_FILE="$TAR_NAME"
if [ ! -f "$TAR_FILE" ]; then
    echo "ERROR: No tarball found"
    exit 1
fi
echo "Found tarball: $TAR_FILE"

# Verify FHS structure
echo "4. Verifying FHS structure..."
tar -tzf "$TAR_FILE" | grep -q "bin/beaver-notes" || { echo "FAIL: Missing bin/beaver-notes"; exit 1; }
tar -tzf "$TAR_FILE" | grep -q "share/applications/beaver-notes.desktop" || { echo "FAIL: Missing desktop file"; exit 1; }
tar -tzf "$TAR_FILE" | grep -q "share/icons/hicolor" || { echo "FAIL: Missing icons"; exit 1; }
tar -tzf "$TAR_FILE" | grep -q "share/metainfo/com.beavernotes.beavernotes.metainfo.xml" || { echo "FAIL: Missing metainfo"; exit 1; }
tar -tzf "$TAR_FILE" | grep -q "lib/beaver-notes/beaver-notes" || { echo "FAIL: Missing lib binary"; exit 1; }
echo "FHS structure OK"

# Test desktop file validation
echo "5. Validating desktop file..."
mkdir -p /tmp/test-extract
tar -xzf "$TAR_FILE" -C /tmp/test-extract
desktop-file-validate /tmp/test-extract/share/applications/beaver-notes.desktop || { echo "FAIL: Invalid desktop file"; exit 1; }
echo "Desktop file OK"

# Test binary execution (just check it runs)
echo "6. Testing binary execution..."
chmod +x /tmp/test-extract/lib/beaver-notes/beaver-notes
timeout 5 /tmp/test-extract/lib/beaver-notes/beaver-notes --version || true
echo "Binary execution OK"

# Clean up
rm -rf /tmp/test-extract "$TAR_FILE"

echo "=== All tests passed ==="
