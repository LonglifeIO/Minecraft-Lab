#!/bin/bash
# usage: mcmap-render <worldId> <backupName>
# Renders /var/lib/mcmap/in/<worldId>.tar.gz (a world backup pushed in by the host's render-maps.sh)
# into /opt/family-mc-ui/data/maps/<worldId>/ as a web map. The renderer (uNmINeD, /opt/unmined/current)
# runs as the unprivileged mcmap user. Incremental: only changed regions are redrawn; a third
# argument "force" redraws everything (needed after changing zoom or style flags).
set -euo pipefail
ID="${1:-}"; BACKUP="${2:-unknown}"; FORCE=""; [ "${3:-}" = "force" ] && FORCE="-f"
[[ "$ID" =~ ^[a-z0-9_-]{1,40}$ ]] || { echo "bad world id"; exit 2; }
IN=/var/lib/mcmap/in/$ID.tar.gz; WORK=/var/lib/mcmap/work/$ID; OUT=/opt/family-mc-ui/data/maps/$ID
[ -f "$IN" ] || { echo "no input archive for $ID"; exit 3; }
chown mcmap:mcmap "$IN"; mkdir -p "$OUT"; chown mcmap:mcmap "$OUT"
runuser -u mcmap -- bash -c 'rm -rf "$1" && mkdir -p "$1" && tar -xzf "$2" -C "$1"' _ "$WORK" "$IN"
W=$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -n1)
[ -n "$W" ] || { echo "archive has no world folder"; exit 4; }
runuser -u mcmap -- env HOME=/var/lib/mcmap /opt/unmined/current/unmined-cli web render \
  --world="$W" --output="$OUT" --zoomin=3 --imageformat=webp --shadows=3d -c ${FORCE} 2>&1 | grep -a -E "Chunks rendered|Chunks failed|Elapsed time total|ERR" || true
# The dashboard's world icon (thumb.png). With THUMB_X/THUMB_Z from the host's render-maps.sh it is a close-up
# of the map around the latest known player spot (64x64 blocks at 2 px per block, unexplored parts dark);
# otherwise the whole explored world, trimmed (1 px = 16 blocks; a barely explored world is redrawn closer).
# (a function, not a variable: the world folder name can contain spaces, e.g. "World #1 Primary Adventure")
thumb() { runuser -u mcmap -- env HOME=/var/lib/mcmap /opt/unmined/current/unmined-cli image render --world="$W" --output="$OUT/thumb.png" --shadows=3d -c "$@" 2>&1 | grep -a -E "ERR|Error|FTL|rror" || true; }
if [ -n "${THUMB_X:-}" ] && [ -n "${THUMB_Z:-}" ]; then
  thumb --area="b($((THUMB_X - 32)),$((THUMB_Z - 32)),64,64)" --zoom=1 --background=#2b2b2b
else
  thumb --zoom=-4 --trim
  if [ -s "$OUT/thumb.png" ]; then
    DIM=$(file -b "$OUT/thumb.png" | grep -o "[0-9]* x [0-9]*" | head -n1)
    if [ -n "$DIM" ] && [ "${DIM%% *}" -lt 48 ] && [ "${DIM##* }" -lt 48 ]; then
      thumb --zoom=-2 --trim
    fi
  fi
fi
[ -s "$OUT/thumb.png" ] && echo "thumb: $(file -b "$OUT/thumb.png" | grep -o "[0-9]* x [0-9]*" | head -n1) px, $(stat -c %s "$OUT/thumb.png") bytes" || echo "thumb: not produced"
runuser -u mcmap -- bash -c 'printf "{\"renderedAt\": %s, \"backup\": \"%s\"}\n" "$(date +%s)" "$2" > "$1/map-info.json"' _ "$OUT" "$BACKUP"
rm -rf "$WORK" "$IN"
