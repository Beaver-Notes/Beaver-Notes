#!/bin/bash
set -euo pipefail

VERSION="$1"
ARCH="$2"  # x86_64 or aarch64
APPIMAGE_NAME="Beaver-Notes-${VERSION}-${ARCH}.AppImage"

echo "=== Building AppImage for ${ARCH} ==="

# Download linuxdeploy if not present
LINUXDEPLOY_URL="https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-${ARCH}.AppImage"
if [ ! -f linuxdeploy ]; then
    echo "Downloading linuxdeploy..."
    curl -L -o linuxdeploy "$LINUXDEPLOY_URL"
    chmod +x linuxdeploy
fi

# Create AppDir structure from FHS tarball
TAR_FILE="Beaver-Notes-${VERSION}-${ARCH}.tar.gz"
if [ ! -f "$TAR_FILE" ]; then
    echo "ERROR: Tarball not found: $TAR_FILE"
    exit 1
fi

echo "Extracting tarball..."
rm -rf AppDir
mkdir -p AppDir/usr/{bin,lib/beaver-notes,share}

# Extract to temp directory
TEMP_DIR=$(mktemp -d)
tar -xzf "$TAR_FILE" -C "$TEMP_DIR"

# Copy files to AppDir
cp -r "$TEMP_DIR"/bin/* AppDir/usr/bin/
cp -r "$TEMP_DIR"/lib/beaver-notes/* AppDir/usr/lib/beaver-notes/
cp -r "$TEMP_DIR"/share/* AppDir/usr/share/

rm -rf "$TEMP_DIR"

# Ensure launcher is a regular executable script (linuxdeploy dislikes symlink Exec targets)
cat > AppDir/usr/bin/beaver-notes << 'WRAPPER'
#!/bin/bash
exec "$(dirname "$0")/../lib/beaver-notes/beaver-notes" "$@"
WRAPPER
chmod +x AppDir/usr/bin/beaver-notes

# Build AppImage
echo "Building AppImage..."
./linuxdeploy --appdir AppDir \
  --desktop-file AppDir/usr/share/applications/beaver-notes.desktop \
  --icon-file AppDir/usr/share/icons/hicolor/1024x1024/apps/beaver-notes.png \
  --output appimage

# Rename to final name (linuxdeploy/appimagetool naming varies)
OUT_APPIMAGE="$(ls -1 Beaver-Notes-*.AppImage Beaver_Notes-*.AppImage 2>/dev/null | head -n1 || true)"
if [ -z "$OUT_APPIMAGE" ]; then
  echo "ERROR: AppImage not found after build"
  ls -la
  exit 1
fi
mv "$OUT_APPIMAGE" "$APPIMAGE_NAME"

echo "=== AppImage created: $APPIMAGE_NAME ==="
ls -lh "$APPIMAGE_NAME"
