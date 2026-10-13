#!/usr/bin/env bash
# Nightly world maps for the dashboard. Runs on the Proxmox host from root's crontab (04:15, after the
# 03:30 backup). For every world: push its newest backup archive into the dashboard container (CT 103)
# and let /usr/local/bin/mcmap-render draw the web map there. Live worlds are never touched.
# MAP_FORCE=1 redraws every region (after changing zoom/style flags in mcmap-render).
# The in-container script's source is kept in scripts/mcmap-render.ct103.sh.
set -uo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
WEBUI_CT=103
DEST=/var/backups/minecraft
LOG=/var/log/mc-maps.log
WORLDS_JSON=/etc/minecraftlab/worlds.json
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
exec 9>/var/lock/mc-maps.lock
flock -n 9 || { echo "another map render is running"; exit 0; }
rc=0
for ID in $(python3 -c "import json; [print(w['id']) for w in json.load(open('$WORLDS_JSON'))['worlds']]"); do
  B=$(ls -1t "$DEST/$ID"/*.tar.gz 2>/dev/null | head -n1)
  if [ -z "$B" ]; then log "[$ID] no backup yet, skipped"; continue; fi
  if ! pct push "$WEBUI_CT" "$B" "/var/lib/mcmap/in/$ID.tar.gz" < /dev/null; then log "[$ID] FAILED: could not copy the backup into CT $WEBUI_CT"; rc=1; continue; fi
  # Centre of the dashboard icon: the latest known player spot (scripts/sample-player-positions.sh), else the
  # world spawn read straight out of the backup's level.dat (TAG_Int "SpawnX"/"SpawnZ", little-endian).
  CENTER=$(python3 - "$ID" "$B" <<'PY'
import json, struct, subprocess, sys
wid, backup = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(f"/var/lib/minecraftlab/positions/{wid}.json")).get("latest")
    if d and d.get("dimension", 0) == 0:
        print(int(d["x"]), int(d["z"])); sys.exit()
except Exception:
    pass
try:
    raw = subprocess.run(["tar", "-xzOf", backup, "--wildcards", "*/level.dat"], capture_output=True).stdout
    def tag(name):
        i = raw.find(b"\x03" + bytes([len(name), 0]) + name.encode())
        return struct.unpack("<i", raw[i + 3 + len(name): i + 7 + len(name)])[0] if i >= 0 else None
    x, z = tag("SpawnX"), tag("SpawnZ")
    if x is not None and z is not None:
        print(x, z)
except Exception:
    pass
PY
)
  TX=${CENTER%% *}; TZ=${CENTER##* }
  if out=$(pct exec "$WEBUI_CT" -- env THUMB_X="$TX" THUMB_Z="$TZ" /usr/local/bin/mcmap-render "$ID" "$(basename "$B")" ${MAP_FORCE:+force} < /dev/null 2>&1); then
    log "[$ID] map drawn from $(basename "$B"): $(echo "$out" | grep -o '[0-9]* Chunks rendered\|[0-9]* Chunks failed' | tr '\n' ' ')icon at ${TX:-?},${TZ:-?} ($(echo "$out" | grep -o 'thumb: .*'))"
  else
    log "[$ID] FAILED: $(echo "$out" | tail -n 3 | tr '\n' ' ')"; rc=1
  fi
done
exit $rc
