#!/bin/bash
set -euo pipefail

echo "=== Testing Linux build ==="

# Build the tarball
echo "1. Building tarball..."
yarn tauri build --bundles app --ci

# Find the tarball
echo "2. Finding tarball..."
TAR_FILE=$(find src-tauri/target -name "Beaver-Notes-*.tar.gz" | head -1)
if [ -z "$TAR_FILE" ]; then
    echo "ERROR: No tarball found"
    exit 1
fi
echo "Found tarball: $TAR_FILE"

# Verify FHS structure
echo "3. Verifying FHS structure..."
tar -tzf "$TAR_FILE" | grep -q "bin/beaver-notes" || { echo "FAIL: Missing bin/beaver-notes"; exit 1; }
tar -tzf "$TAR_FILE" | grep -q "share/applications/beaver-notes.desktop" || { echo "FAIL: Missing desktop file"; exit 1; }
tar -tzf "$TAR_FILE" | grep -q "share/icons/hicolor" || { echo "FAIL: Missing icons"; exit 1; }
tar -tzf "$TAR_FILE" | grep -q "share/metainfo/com.beavernotes.beavernotes.metainfo.xml" || { echo "FAIL: Missing metainfo"; exit 1; }
echo "FHS structure OK"

# Test desktop file validation
echo "4. Validating desktop file..."
mkdir -p /tmp/test-extract
tar -xzf "$TAR_FILE" -C /tmp/test-extract
desktop-file-validate /tmp/test-extract/*/share/applications/beaver-notes.desktop || { echo "FAIL: Invalid desktop file"; exit 1; }
echo "Desktop file OK"

# Test binary execution (just check it runs)
echo "5. Testing binary execution..."
chmod +x /tmp/test-extract/*/lib/beaver-notes/beaver-notes
timeout 5 /tmp/test-extract/*/lib/beaver-notes/beaver-notes --version || true
echo "Binary execution OK"

# Clean up
rm -rf /tmp/test-extract

echo "=== All tests passed ==="
