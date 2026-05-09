#!/bin/bash
# BDS auto-updater — installs update from a pre-downloaded zip
# Runs inside the BDS container
# Usage: bash bds-update.sh [/path/to/bds.zip]
# If no zip provided, checks version only

BDS_DIR="/opt/bedrock"
VERSION_FILE="$BDS_DIR/version.txt"
ZIP_PATH="${1:-}"

CURRENT=$(cat "$VERSION_FILE" 2>/dev/null || echo "0.0.0.0")
echo "[update] Current version: $CURRENT"

if [ -z "$ZIP_PATH" ] || [ ! -f "$ZIP_PATH" ]; then
    echo "[update] No update zip provided or file not found — skipping"
    exit 0
fi

LATEST_VERSION=$(basename "$ZIP_PATH" | grep -oP '\d+\.\d+\.\d+\.\d+')
if [ -z "$LATEST_VERSION" ]; then
    echo "[update] Could not parse version from filename — skipping"
    exit 1
fi

if [ "$CURRENT" = "$LATEST_VERSION" ]; then
    echo "[update] Already up to date ($CURRENT) — no update needed"
    exit 0
fi

echo "[update] Update available: $CURRENT → $LATEST_VERSION"
echo "[update] Stopping BDS..."
systemctl stop bedrock
sleep 3

echo "[update] Installing update..."
unzip -o "$ZIP_PATH" \
    -x "worlds/*" "server.properties" "allowlist.json" "permissions.json" "valid_known_packs.json" \
    -d "$BDS_DIR" > /dev/null

chmod +x "$BDS_DIR/bedrock_server"
echo "$LATEST_VERSION" > "$VERSION_FILE"
rm -f "$ZIP_PATH"

echo "[update] Starting BDS..."
systemctl start bedrock
sleep 3

echo "[update] Updated to $LATEST_VERSION successfully"
