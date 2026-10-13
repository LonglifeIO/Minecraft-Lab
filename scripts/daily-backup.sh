#!/usr/bin/env bash
# Daily world backups for MinecraftLab. Runs on the Proxmox host from root's crontab.
# For every world in worlds.json (unless it has "backup": false): pause world saving ("save hold"), wait until the server confirms the files are
# ready ("save query" -> "Data saved"), tar the world inside its container, resume saving, copy the archive to the
# host, verify it, and keep the newest $KEEP archives per world. Players stay connected the whole time.
set -uo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
DEST=/var/backups/minecraft
KEEP=${KEEP:-7}
LOG=/var/log/mc-backup.log
WORLDS_JSON=/etc/minecraftlab/worlds.json
mkdir -p "$DEST"
exec 9>/var/lock/mc-backup.lock
flock -n 9 || { echo "another backup run is in progress"; exit 0; }
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
console() { pct exec "$1" -- sudo -u minecraft screen -S bedrock -p 0 -X stuff "$2$(printf '\r')" >/dev/null 2>&1; }
HELD=""
trap '[ -n "$HELD" ] && console "$HELD" "save resume"' EXIT
STATUS=()
rc=0
while IFS=$'\t' read -r ID CT NAME; do
  [ -z "$ID" ] && continue
  mkdir -p "$DEST/$ID"
  if ! pct status "$CT" 2>/dev/null | grep -q running; then log "[$ID] CT $CT not running, skipped"; STATUS+=("$ID: SKIPPED (container stopped)"); rc=1; continue; fi
  LEVEL=$(pct exec "$CT" -- grep -m1 '^level-name=' /opt/bedrock/server.properties | cut -d= -f2-)
  OUT="$DEST/$ID/${ID}_$(date +%Y%m%d-%H%M).tar.gz"
  if pct exec "$CT" -- pgrep -u minecraft bedrock_server >/dev/null 2>&1; then
    SIZE=$(pct exec "$CT" -- stat -c %s /opt/bedrock/logs/server.log 2>/dev/null || echo 0)
    console "$CT" "save hold"; HELD=$CT; ready=0
    for i in $(seq 1 20); do
      sleep 2; console "$CT" "save query"; sleep 1
      if pct exec "$CT" -- bash -c "tail -c +$((SIZE + 1)) /opt/bedrock/logs/server.log | grep -a -q -E 'Data saved|Files are now ready'"; then ready=1; break; fi
    done
    [ $ready = 1 ] || log "[$ID] WARNING: server did not confirm 'Data saved' within 60 s; copying anyway"
  else
    log "[$ID] server not running, taking an offline copy"
  fi
  pct exec "$CT" -- tar -czf /tmp/mc-world-backup.tar.gz -C /opt/bedrock/worlds "$LEVEL"; trc=$?
  if [ -n "$HELD" ]; then console "$CT" "save resume"; HELD=""; fi
  if [ $trc -ne 0 ]; then log "[$ID] FAILED: tar exited $trc"; STATUS+=("$ID: FAILED (tar)"); rc=1; pct exec "$CT" -- rm -f /tmp/mc-world-backup.tar.gz; continue; fi
  pct pull "$CT" /tmp/mc-world-backup.tar.gz "$OUT" && pct exec "$CT" -- rm -f /tmp/mc-world-backup.tar.gz
  if gzip -t "$OUT" 2>/dev/null && tar -tzf "$OUT" | grep -c '/db/CURRENT$' >/dev/null; then
    log "[$ID] OK $(du -h "$OUT" | cut -f1) -> $OUT"; STATUS+=("$ID: OK $(basename "$OUT") $(du -h "$OUT" | cut -f1)")
  else
    log "[$ID] FAILED: archive did not verify, removed"; rm -f "$OUT"; STATUS+=("$ID: FAILED (verify)"); rc=1; continue
  fi
  ls -1t "$DEST/$ID"/*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
done < <(python3 -c "import json; [print(f\"{w['id']}\t{w['ctid']}\t{w['name']}\") for w in json.load(open('$WORLDS_JSON'))['worlds'] if w.get('backup', True)]")
# Worlds with "backup": false in worlds.json (test worlds like the Playground) are left out on purpose.
for ID in $(python3 -c "import json; [print(w['id']) for w in json.load(open('$WORLDS_JSON'))['worlds'] if not w.get('backup', True)]"); do
  STATUS+=("$ID: OFF (backups disabled for this world)")
done
{ echo "last run: $(date '+%F %T %Z')  exit: $rc  keep: $KEEP"; printf '%s\n' "${STATUS[@]}"; } > "$DEST/last-run.txt"
exit $rc
