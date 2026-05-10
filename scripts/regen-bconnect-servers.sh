#!/bin/bash
# Regenerate BedrockConnect's servers.json from worlds.json.
# Uses each world's public-facing externalPort (UPnP-allocated) plus the
# host's current external IP, so the BedrockConnect menu transfers clients
# to addresses reachable from the public internet.
#
# BedrockConnect's systemd ExecStart must include:
#   custom_servers=/opt/bedrockconnect/servers.json featured_servers=false user_servers=false
# (note: underscore, not hyphen — this trips people up).

WORLDS_JSON="/etc/minecraftlab/worlds.json"
BCONNECT_CTID="${BCONNECT_CTID:-105}"
BCONNECT_DIR="/opt/bedrockconnect"

if [ ! -f "$WORLDS_JSON" ]; then
    echo "$WORLDS_JSON not found"
    exit 1
fi

# Pull current external IP from UPnP (router); fall back to upstream IP service
PUBLIC_IP=$(upnpc -s 2>/dev/null | grep -oP "ExternalIPAddress = \K[\d.]+" | head -1)
if [ -z "$PUBLIC_IP" ]; then
    PUBLIC_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null)
fi
[ -z "$PUBLIC_IP" ] && PUBLIC_IP="127.0.0.1"  # fallback so BedrockConnect at least starts

TMP=$(mktemp)
PUBLIC_IP="$PUBLIC_IP" python3 <<EOF > "$TMP"
import json, os
public_ip = os.environ["PUBLIC_IP"]
cfg = json.load(open("$WORLDS_JSON"))
out = []
for w in cfg.get("worlds", []):
    out.append({
        "name": w.get("name", w["id"]),
        "iconUrl": "",
        "address": public_ip,
        "port": w.get("externalPort", w.get("gamePort", 19132)),
    })
print(json.dumps(out, indent=2))
EOF

pct push "$BCONNECT_CTID" "$TMP" "$BCONNECT_DIR/servers.json"

# Reload local BedrockConnect (lab-internal players)
pct exec "$BCONNECT_CTID" -- bash -c 'systemctl is-active bedrockconnect >/dev/null 2>&1 && systemctl restart bedrockconnect || true'

# Push to public VPS BedrockConnect (external console players reach this one).
# Failures are logged but don't fail the script — local lab still functions.
VPS_USER="${VPS_USER:-gordon}"
VPS_HOST="${VPS_HOST:-82.25.85.219}"
VPS_KEY="${VPS_KEY:-/root/.ssh/bconnect_vps}"
if [ -f "$VPS_KEY" ]; then
    if scp -i "$VPS_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
            "$TMP" "$VPS_USER@$VPS_HOST:/opt/bedrockconnect/servers.json" 2>/dev/null; then
        ssh -i "$VPS_KEY" -o BatchMode=yes "$VPS_USER@$VPS_HOST" \
            'sudo -n /bin/systemctl restart bedrockconnect' 2>/dev/null \
            && echo "[vps] servers.json synced and BedrockConnect restarted on $VPS_HOST" \
            || echo "[vps] scp ok but restart failed on $VPS_HOST"
    else
        echo "[vps] scp to $VPS_HOST failed — public BedrockConnect not updated"
    fi
fi

rm -f "$TMP"

echo "BedrockConnect server list regenerated for $PUBLIC_IP"
