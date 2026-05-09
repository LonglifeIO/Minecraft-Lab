# Setup Guide

End-to-end deployment of MinecraftLab on a fresh Proxmox VE 9 host.

> **Time estimate:** 1–2 hours for first-time setup. Most steps are one-liners.

---

## 0. Prerequisites

- Proxmox VE 9.x running on dedicated hardware (4+ cores, 8GB+ RAM, 50GB+ SSD)
- Ubuntu 22.04 and Debian 12 LXC templates downloaded in Proxmox
- Wired Ethernet (Bedrock + UDP doesn't play well with congested WiFi)
- A CurseForge API key (free) — needed if you want the addon browser
- Optional: Playit.gg account (free), Tailscale account (free)

This guide assumes you can SSH to the Proxmox host as root.

---

## 1. Host setup (`host-api.py`)

The host service orchestrates containers via `pct` and exposes an HTTP API on port 8090.

```bash
# Clone the repo somewhere on the Proxmox host
git clone https://github.com/YOUR_USER/minecraftlab.git /root/minecraftlab
cd /root/minecraftlab

# Create the world registry
mkdir -p /etc/minecraftlab
cat > /etc/minecraftlab/worlds.json <<'EOF'
{
  "apiToken": "REPLACE_WITH_RANDOM_STRING",
  "subnet": "192.168.1",
  "gateway": "192.168.1.1",
  "worlds": [],
  "standbyCtid": null,
  "standbyIp": null,
  "nextIpSuffix": 100,
  "sourceCtid": 100,
  "idleTimeoutMinutes": 10
}
EOF

# Generate a strong random token
python3 -c "import secrets; print(secrets.token_urlsafe(32))" > /tmp/token
sed -i "s|REPLACE_WITH_RANDOM_STRING|$(cat /tmp/token)|" /etc/minecraftlab/worlds.json
rm /tmp/token

# systemd unit
cat > /etc/systemd/system/host-api.service <<'EOF'
[Unit]
Description=MinecraftLab Host API
After=network.target pve-cluster.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /root/minecraftlab/host-api.py
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now host-api
```

Verify: `curl -H "Authorization: Bearer $(jq -r .apiToken /etc/minecraftlab/worlds.json)" http://localhost:8090/worlds`

---

## 2. First world container (CT 100)

The first world is the *source template* — every future world is cloned from this one.

```bash
# Create the container (adjust template name to match what you've downloaded)
pct create 100 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
    --hostname mc-world-1 \
    --memory 2048 --cores 2 --rootfs local-lvm:10 \
    --net0 name=eth0,bridge=vmbr0,ip=192.168.1.100/24,gw=192.168.1.1 \
    --features nesting=1 \
    --unprivileged 1 \
    --onboot 1

pct start 100
```

Inside the container, install BDS and the API wrapper:

```bash
pct exec 100 -- bash <<'EOF'
apt update && apt install -y unzip screen python3 curl
mkdir -p /opt/bedrock && cd /opt/bedrock
LATEST_URL=$(curl -sL -A "Mozilla/5.0" \
  "https://net.web.minecraft-services.net/api/v1.0/download/links" \
  | python3 -c "import sys,json; [print(l['downloadUrl']) for l in json.load(sys.stdin)['result']['links'] if l['downloadType']=='serverBedrockLinux']")
curl -sL -A "Mozilla/5.0" "$LATEST_URL" -o bds.zip
unzip -q bds.zip && rm bds.zip
chmod +x bedrock_server
useradd -m -s /bin/bash minecraft
chown -R minecraft:minecraft /opt/bedrock
echo "$LATEST_URL" | grep -oP '\d+\.\d+\.\d+\.\d+' > /opt/bedrock/version.txt
EOF

# Push bds-api.py into the container
pct push 100 /root/minecraftlab/bds-api.py /opt/bedrock/bds-api.py

# Create systemd units inside the container
pct exec 100 -- bash <<'EOF'
cat > /etc/systemd/system/bedrock.service <<'UNIT'
[Unit]
Description=Bedrock Dedicated Server
After=network.target

[Service]
Type=simple
User=minecraft
WorkingDirectory=/opt/bedrock
ExecStart=/usr/bin/screen -DmS bedrock /opt/bedrock/bedrock_server
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/bds-api.service <<'UNIT'
[Unit]
Description=BDS Wrapper API
After=bedrock.service

[Service]
Type=simple
Environment="BDS_API_TOKEN=PASTE_THE_SAME_TOKEN_FROM_WORLDS_JSON"
ExecStart=/usr/bin/python3 /opt/bedrock/bds-api.py
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now bedrock bds-api
EOF
```

Register the world with host-api:

```bash
python3 <<'EOF'
import json
cfg = json.load(open('/etc/minecraftlab/worlds.json'))
cfg['worlds'].append({
    "id": "world1", "name": "My World", "ctid": 100,
    "ip": "192.168.1.100", "gamePort": 19132, "apiPort": 8080,
    "alwaysOn": True
})
json.dump(cfg, open('/etc/minecraftlab/worlds.json', 'w'), indent=2)
EOF
systemctl restart host-api
```

---

## 3. Web UI container (CT 103)

```bash
pct create 103 local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst \
    --hostname mc-webui \
    --memory 2048 --cores 1 --rootfs local-lvm:8 \
    --net0 name=eth0,bridge=vmbr0,ip=192.168.1.103/24,gw=192.168.1.1 \
    --unprivileged 1 --onboot 1

pct start 103

pct exec 103 -- bash <<'EOF'
apt update && apt install -y curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
mkdir -p /opt/family-mc-ui
EOF

# Push the webui source
tar --exclude=node_modules --exclude=.next --exclude=.env.local \
    -cf /tmp/webui-src.tar -C /root/minecraftlab/webui .
pct push 103 /tmp/webui-src.tar /tmp/webui-src.tar
pct exec 103 -- bash -c 'cd /opt/family-mc-ui && tar xf /tmp/webui-src.tar && npm install'
```

Configure environment (inside CT 103):

```bash
pct exec 103 -- bash -c 'cat > /opt/family-mc-ui/.env.local <<EOF
SESSION_SECRET=$(openssl rand -hex 32)
USERS=admin:CHANGE_ME:admin
BDS_API_TOKEN=PASTE_TOKEN_FROM_WORLDS_JSON
HOST_API_URL=http://192.168.1.1:8090
CURSEDFORGE_API=YOUR_CURSEFORGE_KEY_OR_LEAVE_BLANK
EOF'
```

Build and run:

```bash
pct exec 103 -- bash -c 'cd /opt/family-mc-ui && npx next build && nohup node node_modules/.bin/next start -p 3000 > /tmp/webui.log 2>&1 &'
```

Visit `http://192.168.1.103:3000` and log in with the credentials you set in `USERS`.

---

## 4. Auto-update cron jobs

```bash
crontab -e
```

Add:

```cron
# Hourly: check for new BDS, update only if no players online
0 * * * * /bin/bash /root/minecraftlab/scripts/update-check.sh

# Twice daily: full backup + update sweep
0 0,12 * * * /bin/bash /root/minecraftlab/scripts/nightly-maintenance.sh
```

---

## 5. Optional: Console (PS / Xbox) player support

Out of the box, MinecraftLab supports PC and mobile clients connecting to your server's IP:port directly. PlayStation and Xbox clients can't enter custom server addresses — they only join through the in-game Friends tab.

There are community-built workarounds that bridge a self-hosted server into the Friends tab so consoles can join. They generally require running a Microsoft account on a side service that broadcasts your server as a "friend's game session." This works in practice, but it sits in a gray area of Microsoft's Xbox Services terms — it's not officially supported and your account could be flagged.

**MinecraftLab does not bundle, link to, or document a specific implementation of this workaround.** If you need console support, the open-source ecosystem has options — research them yourself and decide whether the trade-offs are acceptable for your use case.

---

## 6. Optional: Playit.gg tunnel (zero port forwarding)

Install the Playit agent in a small container (Debian 12, 1GB RAM, 1 core) — it gives your server a public address with no router config. See [playit.gg/docs](https://playit.gg/docs).

---

## Hardening checklist before production

- [ ] All containers `unprivileged: 1`
- [ ] All API tokens are 32+ char random strings (use `openssl rand -hex 32`)
- [ ] `USERS=` in `.env.local` uses strong passwords
- [ ] Proxmox web UI only reachable via Tailscale (firewall rule)
- [ ] `host-api` only listens on `127.0.0.1` if webui is on the same host
- [ ] Backups offsite: `rclone` to S3/B2/Oracle Cloud free tier
- [ ] T2 Mac users: pin the kernel (don't auto-update), follow the [t2linux](https://wiki.t2linux.org) guide

## Troubleshooting

**"Awaiting Core Services" stuck in webui**
- Check `host-api` is reachable: `curl http://HOST_IP:8090/worlds -H "Authorization: Bearer ..."`
- Check `bds-api` inside the world container: `pct exec 100 -- curl localhost:8080/status -H "Authorization: ..."`

**BDS update download fails**
- Mojang's CDN requires a User-Agent. The included scripts use `-A "Mozilla/5.0"` — if you wrote your own, add it.

**Players can't connect after BDS update**
- If you're using a console-bridge workaround, it advertises its own Bedrock protocol version. After updating BDS, you'll need to update that bridge too or console clients will see a version mismatch.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design rationale.
