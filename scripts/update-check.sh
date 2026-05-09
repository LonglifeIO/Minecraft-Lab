#!/bin/bash
# Hourly BDS version check — updates worlds when a new version is out,
# but only if no players are online. Runs on Proxmox host every hour.
# The 12h nightly-maintenance.sh remains as a floor (also does backups).

WORLDS_JSON="/etc/minecraftlab/worlds.json"
SCRIPTS_DIR="/root/minecraftlab/scripts"
LOG="/var/log/mc-update-check.log"
LINKS_API="https://net.web.minecraft-services.net/api/v1.0/download/links"
LOCKFILE="/var/lock/mc-update-check.lock"

# Prevent concurrent runs (e.g., overlap with the 12h cron)
exec 200>"$LOCKFILE"
flock -n 200 || exit 0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# Fetch latest version
LATEST_URL=$(curl -s --http1.1 -A "Mozilla/5.0" --max-time 15 "$LINKS_API" 2>/dev/null \
    | python3 -c "import sys,json; links=json.load(sys.stdin)['result']['links']; print(next(l['downloadUrl'] for l in links if l['downloadType']=='serverBedrockLinux'))" 2>/dev/null)

if [ -z "$LATEST_URL" ]; then
    # API unreachable — silently skip; cron will retry next hour
    exit 0
fi

LATEST_VERSION=$(echo "$LATEST_URL" | grep -oP '\d+\.\d+\.\d+\.\d+')
[ -z "$LATEST_VERSION" ] && exit 0

# Find worlds that need an update
NEEDS_UPDATE=$(python3 << EOF
import json, subprocess
cfg = json.load(open("$WORLDS_JSON"))
out = []
for w in cfg["worlds"]:
    if not w.get("alwaysOn"):
        continue
    res = subprocess.run(["pct", "exec", str(w["ctid"]), "--", "cat", "/opt/bedrock/version.txt"],
                         capture_output=True, text=True, timeout=10)
    if res.returncode == 0:
        current = res.stdout.strip()
        if current and current != "$LATEST_VERSION":
            out.append(f"{w['id']}:{w['ctid']}:{w['ip']}:{w['apiPort']}")
print("\n".join(out))
EOF
)

# All up to date — exit silently (keeps log clean)
[ -z "$NEEDS_UPDATE" ] && exit 0

log "=== Update available: $LATEST_VERSION ==="
TOKEN=$(python3 -c "import json; print(json.load(open('$WORLDS_JSON')).get('apiToken',''))")

# Download once if not already cached
BDS_ZIP="/tmp/bedrock-server-${LATEST_VERSION}.zip"
if [ ! -f "$BDS_ZIP" ]; then
    log "Downloading BDS $LATEST_VERSION..."
    if ! curl -s --http1.1 -A "Mozilla/5.0" -L --max-time 300 "$LATEST_URL" -o "$BDS_ZIP" 2>/dev/null || [ ! -s "$BDS_ZIP" ]; then
        log "Download FAILED — will retry next hour"
        rm -f "$BDS_ZIP"
        exit 1
    fi
    log "Download complete"
fi

# Update each world that's behind, skipping any with players online
echo "$NEEDS_UPDATE" | while IFS=: read -r WID CTID IP APIPORT; do
    [ -z "$WID" ] && continue

    # Check players online (fail-safe: skip if status check fails)
    PLAYERS=$(curl -s --max-time 5 -H "Authorization: Bearer $TOKEN" "http://$IP:$APIPORT/status" 2>/dev/null \
              | python3 -c "import sys,json; print(json.load(sys.stdin).get('players', 'unknown'))" 2>/dev/null)

    if [ "$PLAYERS" != "0" ]; then
        log "[$WID] $PLAYERS player(s) online — deferring update"
        continue
    fi

    log "[$WID] No players online — updating to $LATEST_VERSION"
    pct push "$CTID" "$BDS_ZIP" "/tmp/bedrock-server-${LATEST_VERSION}.zip" 2>/dev/null
    pct push "$CTID" "$SCRIPTS_DIR/bds-update.sh" /tmp/bds-update.sh 2>/dev/null
    if pct exec "$CTID" -- bash /tmp/bds-update.sh "/tmp/bedrock-server-${LATEST_VERSION}.zip" >> "$LOG" 2>&1; then
        log "[$WID] Updated successfully"
    else
        log "[$WID] Update FAILED"
    fi
done

# Clean up older cached zips (keep current)
find /tmp -maxdepth 1 -name "bedrock-server-*.zip" ! -name "bedrock-server-${LATEST_VERSION}.zip" -delete 2>/dev/null
