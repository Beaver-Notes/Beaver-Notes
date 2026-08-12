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

# Create symlink for bin
ln -sf ../../lib/beaver-notes/beaver-notes AppDir/usr/bin/beaver-notes

# Build AppImage
echo "Building AppImage..."
./linuxdeploy --appdir AppDir \
  --desktop-file AppDir/usr/share/applications/beaver-notes.desktop \
  --icon-file AppDir/usr/share/icons/hicolor/1024x1024/apps/beaver-notes.png \
  --output appimage

# Rename to final name
mv Beaver-Notes-*.AppImage "$APPIMAGE_NAME"

echo "=== AppImage created: $APPIMAGE_NAME ==="
ls -lh "$APPIMAGE_NAME"
