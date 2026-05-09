#!/bin/bash
# Maintenance: backup then update all world containers
# Runs on Proxmox host via cron every 12h (0 0,12 * * *)
# Downloads BDS update once on host, pushes to each container

WORLDS_JSON="/etc/minecraftlab/worlds.json"
SCRIPTS_DIR="/root/minecraftlab/scripts"
LOG="/var/log/mc-nightly.log"
LINKS_API="https://net.web.minecraft-services.net/api/v1.0/download/links"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

log "=== Maintenance started ==="

# Get all alwaysOn container IDs
CTIDS=$(python3 -c "
import json
cfg = json.load(open('$WORLDS_JSON'))
for w in cfg['worlds']:
    if w.get('alwaysOn'):
        print(w['ctid'])
" 2>/dev/null)

if [ -z "$CTIDS" ]; then
    log "No alwaysOn worlds found — exiting"
    exit 0
fi

# --- Step 0: Download BDS update on the host (once for all containers) ---
log "Fetching latest BDS version..."
LATEST_URL=$(curl -s --http1.1 -A "Mozilla/5.0" --max-time 15 "$LINKS_API" 2>/dev/null \
    | python3 -c "import sys,json; links=json.load(sys.stdin)['result']['links']; print(next(l['downloadUrl'] for l in links if l['downloadType']=='serverBedrockLinux'))" 2>/dev/null)

BDS_ZIP=""
if [ -n "$LATEST_URL" ]; then
    LATEST_VERSION=$(echo "$LATEST_URL" | grep -oP '\d+\.\d+\.\d+\.\d+')
    log "Latest BDS version: $LATEST_VERSION"
    BDS_ZIP="/tmp/bedrock-server-${LATEST_VERSION}.zip"

    if [ ! -f "$BDS_ZIP" ]; then
        log "Downloading BDS $LATEST_VERSION..."
        if curl -s --http1.1 -A "Mozilla/5.0" -L --max-time 300 "$LATEST_URL" -o "$BDS_ZIP" 2>/dev/null && [ -s "$BDS_ZIP" ]; then
            log "Download complete: $(du -h "$BDS_ZIP" | cut -f1)"
        else
            log "Download FAILED — updates will be skipped"
            rm -f "$BDS_ZIP"
            BDS_ZIP=""
        fi
    else
        log "BDS zip already cached at $BDS_ZIP"
    fi
else
    log "Could not fetch version info — updates will be skipped"
fi

# --- Process each container ---
for CTID in $CTIDS; do
    WORLD_NAME=$(python3 -c "
import json
cfg = json.load(open('$WORLDS_JSON'))
for w in cfg['worlds']:
    if str(w['ctid']) == '$CTID':
        print(w['name'])
" 2>/dev/null)

    log "--- Processing CT $CTID ($WORLD_NAME) ---"

    # Start container if not running (alwaysOn worlds should be up)
    if ! pct status $CTID 2>/dev/null | grep -q running; then
        log "[$CTID] Not running — starting container"
        pct start $CTID 2>/dev/null
        sleep 10
        if ! pct status $CTID 2>/dev/null | grep -q running; then
            log "[$CTID] Failed to start — skipping"
            continue
        fi
    fi

    # Step 1: Backup
    log "[$CTID] Running backup..."
    pct push $CTID "$SCRIPTS_DIR/bds-backup.sh" /tmp/bds-backup.sh
    if pct exec $CTID -- bash /tmp/bds-backup.sh >> "$LOG" 2>&1; then
        log "[$CTID] Backup complete"
    else
        log "[$CTID] Backup FAILED — still proceeding with update"
    fi

    # Step 2: Update (push zip + script, run inside container)
    if [ -n "$BDS_ZIP" ] && [ -f "$BDS_ZIP" ]; then
        log "[$CTID] Pushing update zip and running update..."
        ZIP_BASENAME=$(basename "$BDS_ZIP")
        pct push $CTID "$BDS_ZIP" "/tmp/$ZIP_BASENAME"
        pct push $CTID "$SCRIPTS_DIR/bds-update.sh" /tmp/bds-update.sh
        if pct exec $CTID -- bash /tmp/bds-update.sh "/tmp/$ZIP_BASENAME" >> "$LOG" 2>&1; then
            log "[$CTID] Update check complete"
        else
            log "[$CTID] Update FAILED"
        fi
    else
        log "[$CTID] No update zip available — skipping update"
    fi
done

# Clean up host-side download
rm -f "$BDS_ZIP"

log "=== Maintenance complete ==="
