# Minecraft Bedrock Server Platform — Unified Implementation Plan

**Date:** 2026-03-16
**Hardware:** Mac Mini 2019 (i7-8700B, 64GB RAM, Apple NVMe, T2 chip)
**Host OS:** Proxmox VE 9.1 (already installed)
**Network:** Wired Ethernet at deployment location. During initial setup: Ethernet tethered to desktop PC.

---

## 1. Conflict Resolution Table

| Decision | GPT | Claude | Gemini | Perplexity | **Recommendation** | **Rationale** |
|----------|-----|--------|--------|------------|---------------------|---------------|
| **Server Engine** | Nukkit/PowerNukkitX | BDS (official) | BDS (official) | BDS (official) | **BDS** | GPT is wrong. Nukkit/PowerNukkitX cannot natively load Bedrock LevelDB worlds without conversion. BDS is the *only* engine that reads Realms worlds with zero conversion. Vanilla fidelity (redstone, mob AI, world gen) is critical for a Realms replacement. |
| **Management Panel** | Pterodactyl (primary) or Crafty | Crafty Controller 4 | Pterodactyl (strongly) | Crafty (primary) or Pterodactyl | **Crafty Controller 4** | Pterodactyl requires Docker/Wings, MySQL, Redis, PHP, Nginx — massive overkill for a 2-world family server. It also conflicts with the hard requirement of one LXC container per world (Pterodactyl wants Docker containers). Crafty is open-source, Minecraft-focused, lightweight (Python), has Bedrock support, REST API, role-based access, and backup scheduling. It runs natively without Docker. |
| **VPN/Tunnel (players)** | Playit.gg or TCPShield | Playit.gg | Playit.gg | Playit.gg | **Playit.gg (free tier)** | Universal agreement. Only free tunnel that natively supports UDP (Bedrock's protocol). Cloudflare Tunnel is HTTP/TCP only. No port forwarding needed. Zero cost on free tier. |
| **VPN/Tunnel (admin)** | Tailscale | Tailscale | Tailscale | Tailscale | **Tailscale (free personal plan)** | Universal agreement. WireGuard mesh VPN, zero config, 100 devices free. Proxmox/panel access only via Tailscale IPs. |
| **Console Player Solution** | Dismissive ("focus on PC/mobile") | MCXboxBroadcast + BedrockConnect | BedrockConnect DNS | BedrockConnect / OniionCraft hub | **MCXboxBroadcast (primary) + BedrockConnect (fallback)** | MCXboxBroadcast is the smoothest experience — server appears in the Friends tab on *all* platforms with one-time friend add. BedrockConnect DNS is the fallback for edge cases. GPT's dismissal is unacceptable — console players are a hard requirement. |
| **Container Architecture** | LXC or VM (vague) | LXC containers | KVM VMs (strongly, due to Docker/T2) | VMs for MC, LXC for tools | **LXC containers (one per world)** | This is your hard requirement. LXC has 1-3% overhead vs 5-10% for VMs. BDS is a native C++ binary — no Docker or JVM needed. The T2 kernel concern Gemini raises is valid for Docker-inside-LXC, but we're running BDS natively in LXC (no Docker), so it's not an issue. Proxmox vzdump snapshots work perfectly with LXC. |
| **Backup Approach** | Basic cron + rclone | MCscripts + vzdump + rclone→B2 | Pterodactyl backup + PBS + rclone | Crafty backup + vzdump + restic | **MCscripts (app-level) + vzdump (system-level) + rclone (offsite)** | MCscripts is purpose-built for BDS save hold/query/resume — the only safe way to back up LevelDB while running. vzdump per-container gives full system snapshots. rclone to a free tier destination for offsite. |
| **Custom UI Tech Stack** | React/Vue + Node RCON | Next.js 15 + shadcn/ui + Crafty API | React/Vue + Node.js + Pterodactyl API | React/Svelte + FastAPI/Express + Crafty API | **Next.js + shadcn/ui + Tailwind, backed by Crafty API** | Next.js provides SSR, API routes, and auth in one framework. shadcn/ui + Tailwind gives accessible, mobile-first components. Crafty API as the backend avoids reimplementing process management. SQLite for auth (zero external deps). |
| **Storage Backend** | Not specified | ext4 + LVM-thin (no ZFS) | ZFS or ext4 | ZFS or ext4 | **ext4 + LVM-thin** | ZFS's ARC cache competes for RAM and its write amplification is rough on consumer SSDs. LVM-thin still provides efficient snapshots. For a family server, ZFS's data integrity benefits don't justify the complexity. |
| **Reverse Proxy** | Nginx | Caddy | Nginx | Caddy/Nginx | **Caddy** | Automatic HTTPS via Let's Encrypt, zero-config TLS, simpler config syntax than Nginx. Perfect for a small deployment. |
| **Monitoring** | Prometheus/Grafana | Uptime Kuma + Healthchecks.io | Prometheus/Grafana | Prometheus/Grafana | **Uptime Kuma** | Prometheus/Grafana is overkill for 2 Minecraft servers. Uptime Kuma is lightweight, has a beautiful UI, sends alerts, and monitors services with a single container. |
| **Offsite Backup Destination** | Google Drive/Dropbox | Backblaze B2 ($0.04-1.20/mo) | Backblaze B2/S3 | Backblaze B2/Wasabi | **Oracle Cloud free tier (10GB Object Storage) or second local machine** | Hard requirement: zero cost. B2 is cheap but not free. Oracle Cloud free tier gives 10GB object storage truly free. Alternatively, rclone to a USB drive or another machine at a different location. If worlds stay under 10GB total, Oracle free tier works. |
| **Network** | Not addressed | "WiFi unsuitable for server — use Ethernet only" | Not addressed | Not addressed | **Wired Ethernet** | The Mac Mini will be wired in at the deployment location. During initial setup it's Ethernet-tethered to a desktop PC. This eliminates WiFi reliability concerns entirely. The Mac Mini 2019's Broadcom BCM57766 Gigabit adapter works out of the box via the `tg3` driver. |

---

## 2. Final Software Stack

| Component | Tool | Version/Details | Why |
|-----------|------|-----------------|-----|
| **Hypervisor** | Proxmox VE | 9.1 (already installed) | Already in place. T2-patched kernel required. |
| **T2 Kernel** | pve-edge-kernel-t2 | Latest from AdityaGarg8/t2linux | Required for NVMe, fan control, and hardware support on T2 Macs |
| **Fan Control** | mbpfan | Latest | Prevents thermal throttling under sustained load |
| **Game Server** | Bedrock Dedicated Server (BDS) | Match current Bedrock client version | Only engine with native Realms world compatibility |
| **Management Panel** | Crafty Controller 4 | Latest stable | Open-source, Minecraft-focused, REST API, role-based access |
| **Custom Web UI** | Next.js 15+ | With shadcn/ui, Tailwind CSS v4, NextAuth.js v5 | Mobile-first family dashboard calling Crafty API |
| **Auth (custom UI)** | NextAuth.js v5 + SQLite | Credentials provider | Zero external dependencies, simple role model |
| **Reverse Proxy** | Caddy | Latest stable | Auto-HTTPS, minimal config |
| **Player Tunnel** | Playit.gg agent | Latest (free tier) | UDP tunnel for Bedrock, no port forwarding needed |
| **Admin VPN** | Tailscale | Free personal plan | WireGuard mesh, secure access to Proxmox/Crafty/SSH |
| **Console Access** | MCXboxBroadcast | Latest standalone | Server appears in Friends tab on all platforms |
| **Console Fallback** | BedrockConnect | Latest | DNS redirect for consoles to enter custom server IPs |
| **App-Level Backup** | MCscripts | Latest from TapeWerm/MCscripts | save hold/query/resume protocol for safe LevelDB backup |
| **System Backup** | Proxmox vzdump | Built-in | Per-container snapshots with retention policies |
| **Offsite Backup** | rclone | Latest | Sync to Oracle Cloud free tier or USB drive |
| **Monitoring** | Uptime Kuma | Latest | Lightweight status monitoring with alerts |
| **Backup Monitoring** | Healthchecks.io | Free tier (hosted) | Dead man's switch for backup job monitoring |
| **Container OS** | Ubuntu 22.04 / Debian 12 | LXC templates from Proxmox | Stable, well-supported, BDS officially supports Ubuntu |
| **Future: Mod Framework** | Endstone | Monitor development | Most promising BDS plugin API (Python/C++ Bukkit-like) |

---

## 3. Proxmox Container Layout

All services run in **unprivileged LXC containers** on the internal bridge network (`vmbr0`). Each BDS world gets its own container for independent backup/restore.

| VMID | Hostname | Purpose | OS | RAM | CPU Cores | Disk | Network | Key Ports |
|------|----------|---------|-----|-----|-----------|------|---------|-----------|
| 100 | `mc-world-1` | BDS World 1 (main Realm) | Ubuntu 22.04 | 2 GB | 2 | 10 GB | vmbr0, static IP 192.168.1.100 | 19132/UDP (game) |
| 101 | `mc-world-2` | BDS World 2 (second Realm) | Ubuntu 22.04 | 2 GB | 2 | 10 GB | vmbr0, static IP 192.168.1.101 | 19133/UDP (game) |
| 102 | `mc-crafty` | Crafty Controller 4 | Ubuntu 22.04 | 2 GB | 2 | 15 GB | vmbr0, static IP 192.168.1.102 | 8443/TCP (panel UI) |
| 103 | `mc-webui` | Custom Next.js family UI | Debian 12 | 1 GB | 1 | 8 GB | vmbr0, static IP 192.168.1.103 | 3000/TCP (web app) |
| 104 | `mc-proxy` | Caddy reverse proxy | Debian 12 | 512 MB | 1 | 5 GB | vmbr0, static IP 192.168.1.104 | 80/TCP, 443/TCP |
| 105 | `mc-tunnel` | Playit.gg agent + MCXboxBroadcast | Debian 12 | 1 GB | 1 | 5 GB | vmbr0, static IP 192.168.1.105 | outbound only |
| 106 | `mc-monitor` | Uptime Kuma | Debian 12 | 512 MB | 1 | 5 GB | vmbr0, static IP 192.168.1.106 | 3001/TCP (dashboard) |
| — | Proxmox host | Hypervisor + Tailscale + vzdump | Debian (T2 kernel) | 4 GB reserved | — | 30 GB | Ethernet (bridged via vmbr0) | 8006/TCP (Proxmox UI) |
| **Total** | | | | **~12 GB** | **10 cores** | **~88 GB** | | |
| **Remaining** | | | | **~52 GB** | **2 cores** | **Varies** | | |

**Notes:**
- BDS uses ~200-400MB idle, ~1-2GB under active play. 2GB per container provides ample headroom.
- CPU: i7-8700B has 6 cores / 12 threads. 10 allocated cores is fine with hyperthreading.
- Additional world containers can be cloned from a template (see Phase 2).
- Tailscale runs on the Proxmox host directly (not in a container).
- Playit.gg agent runs in its own container and connects to BDS containers via internal network.
- All containers are bridged to the LAN via vmbr0 (standard Proxmox bridged networking over Ethernet).
- During initial setup (tethered to desktop), IPs may need adjusting when moved to the deployment router.

---

## 4. Network Architecture

### Traffic Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        INTERNET                                  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ PC / Mobile   │  │ Xbox / PS /  │  │ Admin Devices        │   │
│  │ Players       │  │ Switch       │  │ (Your laptop/phone)  │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                  │                      │               │
│         │ UDP via          │ Friends tab           │ WireGuard     │
│         │ Playit.gg addr   │ (MCXboxBroadcast)     │ (Tailscale)   │
│         │                  │ or BedrockConnect     │               │
└─────────┼──────────────────┼──────────────────────┼───────────────┘
          │                  │                      │
          ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PLAYIT.GG ANYCAST NETWORK                     │
│              (free tier, 4 UDP tunnels available)                 │
│         Assigns public addresses like 180.ip.ply.gg:17019        │
└─────────────────────────────┬───────────────────────────────────┘
                              │ Outbound tunnel
                              │ (no inbound ports needed on router)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              MAC MINI — PROXMOX VE 9.1                           │
│              (Wired Ethernet to home router)                      │
│                                                                  │
│  ┌─────────────────────────────────────────┐                     │
│  │ Proxmox Host (Debian + T2 kernel)       │                     │
│  │ • Tailscale (100.x.y.z mesh VPN)        │◄── Admin traffic    │
│  │ • vzdump backup scheduler               │    (Proxmox UI,     │
│  │ • mbpfan (thermal management)           │     SSH, all mgmt)  │
│  └────────────────┬────────────────────────┘                     │
│                   │ vmbr0 bridge (10.0.0.0/24)                   │
│    ┌──────────────┼──────────────────────────────┐               │
│    │              │                              │               │
│    ▼              ▼              ▼               ▼               │
│ ┌────────┐  ┌────────┐  ┌───────────┐  ┌──────────────┐        │
│ │CT 100  │  │CT 101  │  │CT 102     │  │CT 103        │        │
│ │World 1 │  │World 2 │  │Crafty     │  │Custom Web UI │        │
│ │BDS     │  │BDS     │  │Controller │  │(Next.js)     │        │
│ │:19132  │  │:19133  │  │:8443      │  │:3000         │        │
│ └────┬───┘  └────┬───┘  └─────┬─────┘  └──────┬───────┘        │
│      │           │            │                │                 │
│      │     ┌─────┴────────────┴────────────────┘                │
│      │     │                                                     │
│      ▼     ▼                                                     │
│ ┌──────────────┐  ┌──────────┐  ┌──────────┐                   │
│ │CT 105        │  │CT 104    │  │CT 106    │                    │
│ │Playit.gg     │  │Caddy     │  │Uptime    │                    │
│ │agent +       │  │Reverse   │  │Kuma      │                    │
│ │MCXboxBcast   │  │Proxy     │  │:3001     │                    │
│ │              │  │:80/:443  │  │          │                    │
│ └──────────────┘  └──────────┘  └──────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

### Player Traffic Flow
1. Player opens Minecraft → enters Playit.gg address (e.g., `180.ip.ply.gg:17019`)
2. UDP traffic hits Playit.gg's anycast network
3. Playit.gg agent (CT 105) receives traffic via outbound tunnel
4. Agent forwards UDP to `10.0.0.100:19132` (CT 100, World 1) or `10.0.0.101:19133` (CT 101, World 2)
5. BDS processes the connection

### Console Player Traffic Flow
1. Console player sees server in Friends tab (via MCXboxBroadcast alt account)
2. Player clicks "Join" → connection routed to Playit.gg address
3. Same flow as above from step 2 onward

### Admin Traffic Flow
1. Admin opens Tailscale on their device → connects to tailnet
2. Access Proxmox UI at `http://100.x.y.z:8006`
3. Access Crafty at `https://100.x.y.z:8443`
4. Access custom UI at `https://100.x.y.z:3000`
5. SSH to any container via `ssh root@100.x.y.z`

### Family Admin Traffic Flow (Custom Web UI)
1. Family admin opens browser → navigates to Cloudflare Tunnel URL (e.g., `https://mc.yourdomain.com`) or Tailscale Funnel URL
2. Authenticates via NextAuth.js credentials
3. Custom UI → Crafty API → BDS stdin/stdout

### Key Security Properties
- **Zero open router ports** — all traffic flows through outbound tunnels
- **Home IP hidden** — players see only Playit.gg addresses
- **Admin surfaces never public** — Proxmox, Crafty, SSH only via Tailscale
- **Family UI access** — via Cloudflare Tunnel with auth, or Tailscale Funnel

---

## 5. Realm World Migration Procedure

### Prerequisites
- A Windows 10/11 PC with Minecraft Bedrock installed (logged in with the Realm owner's Microsoft account)
- BDS containers already created and running once (to generate default directory structure)
- BDS version must **match or exceed** the Realm's Minecraft version

### Step-by-Step

**Step 1: Download the Realm World**
```
On Windows PC:
1. Launch Minecraft Bedrock Edition
2. Play → Realms → click pencil icon on your Realm
3. Configure Realm → select the world slot you want
4. World Backups → Download Latest
5. Wait for download to complete (appears in single-player world list)
```

> **IMPORTANT:** Download on Windows, NOT on a console. Console operating systems impose ~400MB file size limits that silently corrupt large worlds.

**Step 2: Export as .mcworld file**
```
1. Go to Worlds tab → click pencil on the downloaded world
2. Scroll down → Export World
3. Save the .mcworld file somewhere accessible
```

**Step 3: Locate the raw world folder**
```
Path: C:\Users\<username>\AppData\Local\Packages\
       Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\
       games\com.mojang\minecraftWorlds\

Each world is a folder with a random alphanumeric name.
Open each folder's levelname.txt to identify your Realm world.
```

**Step 4: Prepare BDS on the server**
```bash
# SSH into the BDS container (e.g., CT 100)
ssh root@10.0.0.100

# Start BDS once to generate default directory structure
cd /opt/bedrock
./bedrock_server
# Wait for "Server started" message, then type "stop" and press Enter

# This creates: /opt/bedrock/worlds/Bedrock level/db/
```

**Step 5: Import using the DB-only method (CRITICAL)**

This is the most reliable approach. **Do NOT copy `level.dat` from the Realm export** — it causes "Unable to connect to world" errors.

```bash
# On BDS container:
cd /opt/bedrock/worlds/Bedrock\ level/

# Delete the default generated world data
rm -rf db/*

# Transfer the Realm world's db/ folder contents to the server
# (from your Windows PC, use SCP, SFTP, or the Crafty file manager)
# Example with scp from Windows (via WSL or PowerShell with OpenSSH):
scp -r /path/to/realm-world/db/* root@10.0.0.100:/opt/bedrock/worlds/Bedrock\ level/db/

# DO NOT copy level.dat from the Realm — keep the BDS-generated one
```

**Step 6: Configure server.properties**
```properties
# /opt/bedrock/server.properties
level-name=Bedrock level
# Set the seed to match your original Realm world seed
# (find it in-game before migration: Settings → Game → Seed)
level-seed=YOUR_ORIGINAL_SEED
server-port=19132
server-portv6=19133
```

> **Why the seed matters:** Without the correct seed, newly explored chunks will generate completely different terrain, creating jarring borders where old terrain meets new.

**Step 7: Handle player data**

Before exporting from Realms, have all players:
1. Dump their inventories into labeled chests at a known location (e.g., spawn)
2. Note coordinates of their bases
3. Un-tame and re-tame animals after migration (ownership may break due to player ID changes)

The Realm host player's inventory is stored in `level.dat` (which you're NOT copying), so the host will lose their inventory. Other players' data is stored by Xbox XUID in the LevelDB database and should transfer.

**Step 8: Handle resource/behavior packs**
```bash
# If the Realm used custom (non-Marketplace) packs:
# Copy behavior_packs/ and resource_packs/ folders from the export
# to the BDS installation directory
scp -r /path/to/realm-world/behavior_packs root@10.0.0.100:/opt/bedrock/
scp -r /path/to/realm-world/resource_packs root@10.0.0.100:/opt/bedrock/

# Register them in valid_known_packs.json if needed
# Marketplace (DRM-protected) packs CANNOT be transferred
```

**Step 9: Start and verify**
```bash
cd /opt/bedrock
./bedrock_server

# Connect from a Bedrock client and verify:
# - Spawn area is correct
# - Structures and builds are intact
# - Items in chests are present
# - New chunks generate terrain consistent with the seed
```

**Step 10: Repeat for each Realm world**

Create a second container (CT 101) and repeat the process for World 2, using port 19133.

### Common Pitfalls Summary

| Pitfall | Symptom | Solution |
|---------|---------|----------|
| Copying `level.dat` from Realm export | "Unable to connect to world" | Use DB-only method — keep BDS-generated `level.dat` |
| Seed mismatch | Jarring terrain borders at chunk edges | Set `level-seed` in `server.properties` to exact original seed |
| Version mismatch | "Outdated Client" or "Outdated Server" | Pin BDS version to match client version exactly. BDS releases sometimes lag client releases by days. |
| Console download (>400MB) | Silent corruption or size limit error | Always download on Windows PC, never on console |
| Marketplace packs | Missing textures/content | Cannot transfer DRM packs — only free custom packs work |
| Host player inventory | Host loses items | Have host dump inventory to chests before migration |
| Tamed animals | Ownership broken | Note animal locations; re-tame after migration |
| Client auto-update | Client updates before BDS is available | Pin/disable auto-updates on clients until BDS update is verified |

---

## 6. Per-World Backup Architecture

### Layered Backup System

| Layer | Tool | Frequency | Retention | What It Protects | Recovery Time |
|-------|------|-----------|-----------|------------------|---------------|
| **Application** | MCscripts (save hold/query/resume + tar) | Every 4 hours | 7 days (42 backups) | Individual world data, granular rollback | Minutes |
| **Container** | Proxmox vzdump (per-container snapshots) | Daily at 3:00 AM | 3 most recent + 7 daily + 4 weekly | Full container state (OS + BDS + world + config) | Minutes |
| **Pre-update** | Proxmox `pct snapshot` | Before each BDS update | Delete after 48h verification | Quick rollback if update breaks things | Seconds |
| **Offsite** | rclone → Oracle Cloud free tier or USB drive | Daily at 5:00 AM | 14 daily + 4 monthly | Disaster recovery (fire, theft, hardware death) | Hours |
| **Monitoring** | Healthchecks.io pings | Per backup job | — | Alert on backup failures | — |

### Application-Level Backup: MCscripts

MCscripts implements the only safe way to back up a running BDS world. LevelDB is **highly susceptible to corruption** if files are copied during active writes.

**Installation (in each BDS container):**
```bash
# In CT 100 (mc-world-1):
apt update && apt install -y curl unzip
curl -L https://github.com/TapeWerm/MCscripts/archive/refs/heads/master.zip -o /tmp/mcscripts.zip
unzip /tmp/mcscripts.zip -d /tmp
cd /tmp/MCscripts-master/src
sudo ./install.sh
```

**Configure the backup timer:**
```bash
# Enable the backup timer for your BDS instance
sudo systemctl enable --now mcbe-backup@world1.timer

# Edit the timer to run every 4 hours
sudo systemctl edit mcbe-backup@world1.timer
```

```ini
# /etc/systemd/system/mcbe-backup@world1.timer.d/override.conf
[Timer]
OnCalendar=
OnCalendar=*-*-* 00/4:00:00
```

**How MCscripts works:**
1. Sends `save hold` to BDS → freezes disk writes, queues changes in memory
2. Sends `save query` → BDS returns exact files and byte counts to copy (truncation lengths are critical for consistency)
3. Copies the specified files with exact byte counts
4. Sends `save resume` → flushes queued changes, normal operation resumes
5. Compresses the backup with tar/gzip
6. Rotates old backups per retention policy (default: 2 weeks)

### Container-Level Backup: Proxmox vzdump

```bash
# On Proxmox host, create a vzdump schedule for all world containers
# Edit /etc/pve/jobs.cfg or use the Proxmox web UI:
# Datacenter → Backup → Add

# Settings:
# Storage: local (or a dedicated backup storage)
# Schedule: daily at 03:00
# Selection: include VMIDs 100, 101, 102, 103, 104, 105, 106
# Mode: snapshot
# Compression: zstd
# Retention: keep-last=3, keep-daily=7, keep-weekly=4

# Manual backup command:
vzdump 100 --mode snapshot --compress zstd --storage local
```

**Pre-backup hook for BDS consistency:**
```bash
# /var/lib/vz/snippets/bds-backup-hook.sh
#!/bin/bash
# Called by vzdump before/after snapshot

VMID=$1
PHASE=$2

# Only apply to BDS containers
if [[ "$VMID" == "100" || "$VMID" == "101" ]]; then
    case "$PHASE" in
        job-start)
            # Send save hold before snapshot
            pct exec $VMID -- bash -c 'screen -S bedrock -X stuff "save hold\n"'
            sleep 5
            ;;
        job-end)
            # Resume saves after snapshot
            pct exec $VMID -- bash -c 'screen -S bedrock -X stuff "save resume\n"'
            ;;
    esac
fi
```

```bash
chmod +x /var/lib/vz/snippets/bds-backup-hook.sh
# Add to vzdump.conf:
echo "script: /var/lib/vz/snippets/bds-backup-hook.sh" >> /etc/vzdump.conf
```

### Pre-Update Snapshot Procedure

Before any BDS version update:
```bash
# 1. Create a named container snapshot
pct snapshot 100 pre-update-$(date +%Y%m%d) --description "Before BDS update to version X.Y.Z"

# 2. Trigger an application-level backup
pct exec 100 -- systemctl start mcbe-backup@world1.service

# 3. Back up critical config files
pct exec 100 -- tar czf /tmp/config-backup.tar.gz \
    /opt/bedrock/server.properties \
    /opt/bedrock/allowlist.json \
    /opt/bedrock/permissions.json

# 4. Apply the update
pct exec 100 -- /opt/bedrock/update.sh  # or MCscripts auto-update

# 5. Verify the server starts and world loads
pct exec 100 -- systemctl start bedrock

# 6. If broken, rollback:
pct rollback 100 pre-update-$(date +%Y%m%d)

# 7. If stable after 48 hours, delete the pre-update snapshot:
pct delsnapshot 100 pre-update-$(date +%Y%m%d)
```

### Offsite Backup

**Option A: Oracle Cloud Free Tier (10GB Object Storage — truly free)**
```bash
# In a backup container or on Proxmox host:
apt install -y rclone

# Configure rclone for Oracle Cloud Object Storage
rclone config
# Follow prompts: name=oracle, type=oracleobjectstorage, ...

# Create daily sync cron job
cat > /etc/cron.d/offsite-backup << 'EOF'
0 5 * * * root rclone sync /var/lib/vz/dump/ oracle:mc-backups/ --include "vzdump-lxc-10{0,1}*" --bwlimit 5M --transfers 2 --log-file /var/log/rclone-backup.log && curl -fsS https://hc-ping.com/YOUR-UUID
EOF
```

**Option B: USB Drive (attached to Mac Mini)**
```bash
# Mount USB drive
mkdir -p /mnt/usb-backup
mount /dev/sdX1 /mnt/usb-backup
# Add to /etc/fstab for persistence

# Sync backups
rclone sync /var/lib/vz/dump/ /mnt/usb-backup/proxmox-backups/
```

**Option C: Another machine at a different location (rsync over Tailscale)**
```bash
# If you have another machine on your Tailscale network:
rsync -avz --delete /var/lib/vz/dump/ user@100.x.y.z:/backups/mc-server/
```

### Restore Procedures

**Restore a single world from MCscripts backup:**
```bash
# In the BDS container:
# 1. Stop BDS
systemctl stop bedrock

# 2. List available backups
ls -la /opt/MCscripts/backups/

# 3. Remove current world data
rm -rf /opt/bedrock/worlds/Bedrock\ level/db/*

# 4. Extract desired backup
tar xzf /opt/MCscripts/backups/world1-2026-03-15T12-00.tar.gz \
    -C /opt/bedrock/worlds/Bedrock\ level/

# 5. Start BDS
systemctl start bedrock
```

**Restore a full container from vzdump:**
```bash
# On Proxmox host:
# 1. Destroy the broken container (or rename it)
pct stop 100
pct destroy 100

# 2. Restore from backup
pctrestore /var/lib/vz/dump/vzdump-lxc-100-2026_03_15-03_00_00.tar.zst 100

# 3. Start the container
pct start 100
```

**Rollback from Proxmox snapshot:**
```bash
pct rollback 100 pre-update-20260315
pct start 100
```

---

## 7. Web UI Architecture & Feature Spec

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser (Phone/Tablet/Desktop)                          │
│  ├── Mobile-first responsive PWA                         │
│  └── Large buttons, plain language, no technical jargon  │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js Application (CT 103)                            │
│  ├── Frontend: React + shadcn/ui + Tailwind CSS v4       │
│  ├── Auth: NextAuth.js v5 (Credentials) + SQLite         │
│  ├── API Routes: /api/server/*, /api/player/*, etc.      │
│  └── Role middleware: Admin / Moderator / Viewer          │
└──────────────────────┬──────────────────────────────────┘
                       │ REST API calls (authenticated)
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Crafty Controller 4 API (CT 102, port 8443)             │
│  ├── Server power control (start/stop/restart)           │
│  ├── Console command execution (stdin pipe to BDS)       │
│  ├── Backup triggers                                     │
│  ├── Server stats (players online, status)               │
│  └── File management (for config edits)                  │
└──────────────────────┬──────────────────────────────────┘
                       │ stdin/stdout pipe
                       ▼
┌─────────────────────────────────────────────────────────┐
│  BDS Process (CT 100 / CT 101)                           │
│  └── Executes Bedrock commands                           │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack Detail

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 15+ (App Router) | SSR, API routes, auth — all in one |
| UI Components | shadcn/ui | Accessible, customizable component library |
| Styling | Tailwind CSS v4 | Utility-first, mobile-responsive |
| Auth | NextAuth.js v5 + Credentials provider | Simple username/password login |
| Database | SQLite (via better-sqlite3) | User accounts, roles, audit log, preset definitions |
| API Client | Crafty Controller REST API v2 | Server management operations |
| Deployment | Node.js 20 LTS in CT 103 | Direct deployment, no Docker needed |
| HTTPS | Caddy (CT 104) reverse proxying to CT 103 | Auto-TLS via Tailscale or Let's Encrypt |

### Complete Feature List

| Feature Category | UI Control | BDS Command(s) / API Call | Role Required |
|-----------------|------------|---------------------------|---------------|
| **Server Status** | Status indicator (Online/Offline/Starting) | Crafty API: GET server status | Viewer |
| **Player Count** | "3 players online" with player list | Crafty API: GET server stats + `list` command | Viewer |
| **Start Server** | Green "Start" button | Crafty API: POST power/start | Moderator |
| **Stop Server** | Red "Stop" button (with confirmation) | Crafty API: POST power/stop | Moderator |
| **Restart Server** | Yellow "Restart" button (with confirmation) | Crafty API: POST power/restart | Moderator |
| **Backup World** | "Backup Now" button with progress indicator | `save hold` → `save query` → copy → `save resume` | Moderator |
| **Change Difficulty** | Dropdown: Peaceful / Easy / Normal / Hard | `difficulty <level>` | Moderator |
| **Toggle Allowlist** | On/Off switch | `allowlist on` / `allowlist off` | Moderator |
| **Add to Allowlist** | Text input + "Add" button | `allowlist add <gamertag>` | Moderator |
| **Remove from Allowlist** | Player card with "Remove" button | `allowlist remove <gamertag>` | Moderator |
| **Kick Player** | Player card dropdown → "Kick" | `kick <player> [reason]` | Moderator |
| **Ban Player** | Player card dropdown → "Ban" (confirmation required) | `kick <player>` + `allowlist remove <player>` | Admin |
| **Set Player Gamemode** | Player card dropdown → Survival/Creative/Adventure | `gamemode <mode> <player>` | Moderator |
| **Activate Preset** | Large preset cards (see below) | Batch of commands | Moderator |
| **View Backup History** | List of recent backups with timestamps | Crafty API: GET backups | Viewer |
| **Restore Backup** | Select backup → "Restore" (confirmation) | Stop server → extract backup → start | Admin |
| **User Management** | Add/edit/remove UI users and roles | NextAuth.js + SQLite | Admin |
| **Audit Log** | Scrollable log of all actions with timestamps | SQLite audit table | Admin |

**Note:** BDS uses `allowlist` (not `whitelist`). BDS has **no native ban command** — banning is implemented as kick + allowlist removal.

### Preset Mode Definitions

| Preset | Display Name | Commands Executed | Description Shown to User |
|--------|-------------|-------------------|---------------------------|
| **Kid Friendly** | "Kid Friendly Mode" | `difficulty peaceful` | "Safe mode for young players. |
| | | `gamemode creative @a` | No monsters, no losing items, |
| | | `gamerule pvp false` | free building, no player fighting." |
| | | `gamerule mobGriefing false` | |
| | | `gamerule keepInventory true` | |
| **Hard Survival** | "Hard Survival" | `difficulty hard` | "Challenging survival experience. |
| | | `gamemode survival @a` | Tough monsters, items drop on death, |
| | | `gamerule keepInventory false` | PVP enabled." |
| | | `gamerule pvp true` | |
| | | `gamerule naturalRegeneration true` | |
| **Build Event** | "Build Event" | `difficulty peaceful` | "Creative building session. |
| | | `gamemode creative @a` | No monsters, no weather, |
| | | `gamerule doMobSpawning false` | time frozen at noon — |
| | | `gamerule doDaylightCycle false` | perfect for building together." |
| | | `gamerule doWeatherCycle false` | |
| | | `gamerule mobGriefing false` | |
| **Normal Play** | "Normal Mode" | `difficulty normal` | "Standard Minecraft experience. |
| | | `gamemode survival @a` | Normal monsters, keep your items |
| | | `gamerule keepInventory true` | on death, PVP off." |
| | | `gamerule pvp false` | |
| | | `gamerule doDaylightCycle true` | |
| | | `gamerule doWeatherCycle true` | |
| | | `gamerule doMobSpawning true` | |

### Role/Permission Model

| Permission | Admin | Moderator | Viewer |
|-----------|-------|-----------|--------|
| View server status | ✅ | ✅ | ✅ |
| View player list | ✅ | ✅ | ✅ |
| View backup history | ✅ | ✅ | ✅ |
| Start/Stop/Restart server | ✅ | ✅ | ❌ |
| Trigger backup | ✅ | ✅ | ❌ |
| Change difficulty | ✅ | ✅ | ❌ |
| Manage allowlist | ✅ | ✅ | ❌ |
| Kick player | ✅ | ✅ | ❌ |
| Set player gamemode | ✅ | ✅ | ❌ |
| Activate presets | ✅ | ✅ | ❌ |
| Ban player | ✅ | ❌ | ❌ |
| Restore backup | ✅ | ❌ | ❌ |
| Manage UI users/roles | ✅ | ❌ | ❌ |
| View audit log | ✅ | ❌ | ❌ |
| Access Crafty directly | ✅ | ❌ | ❌ |
| Access Proxmox | ✅ | ❌ | ❌ |

### Addon Management Design (Future)

When Endstone matures, the UI can be extended:

```
┌─────────────────────────────────────────┐
│  Addon Management Tab (Admin only)       │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │ Installed Addons                     │ │
│  │ ┌──────────────────────────┐        │ │
│  │ │ [✅] Better Farming v1.2 │ [🗑️]  │ │
│  │ │ [✅] Custom Recipes v3.0 │ [🗑️]  │ │
│  │ │ [❌] PVP Arena v2.1      │ [🗑️]  │ │
│  │ └──────────────────────────┘        │ │
│  │                                      │ │
│  │ [📁 Upload New Addon]               │ │
│  │ (.mcpack / .mcaddon files)           │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

Implementation: Upload .mcpack/.mcaddon files via the UI → API extracts to `behavior_packs/` and `resource_packs/` directories → registers in `valid_known_packs.json` → restart BDS.

---

## 8. Console Player Setup

### Platform Connection Guide

#### PC (Windows 10/11) and Mobile (iOS/Android) — Trivial

```
1. Open Minecraft Bedrock Edition
2. Play → Servers tab → scroll to bottom → "Add Server"
3. Server Name: "Family Server" (or any name)
4. Server Address: [your Playit.gg address, e.g., 180.ip.ply.gg]
5. Port: [your Playit.gg port, e.g., 17019]
6. Save → click to join
```

One-time setup, saved permanently. Works immediately.

#### Xbox — Easy (via MCXboxBroadcast)

**One-time setup (admin):**
```bash
# In CT 105 (mc-tunnel), install MCXboxBroadcast standalone
apt install -y openjdk-17-jre-headless
mkdir -p /opt/mcxboxbroadcast && cd /opt/mcxboxbroadcast
curl -LO https://github.com/rtm516/MCXboxBroadcast/releases/latest/download/MCXboxBroadcastStandalone.jar

# Create config
cat > config.yml << 'EOF'
sessions:
  - ip: 10.0.0.100
    port: 19132
    # Second world (optional):
  - ip: 10.0.0.101
    port: 19133
friendSync: true
EOF

# First run — will prompt for Microsoft account login
# Use a DEDICATED ALT Microsoft account (not your main one)
java -jar MCXboxBroadcastStandalone.jar
# Follow the device code login flow in browser

# Create systemd service for auto-start
cat > /etc/systemd/system/mcxboxbroadcast.service << 'EOF'
[Unit]
Description=MCXboxBroadcast
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/mcxboxbroadcast
ExecStart=/usr/bin/java -jar MCXboxBroadcastStandalone.jar
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now mcxboxbroadcast
```

**Player setup (one-time, per player):**
```
1. On Xbox, go to Friends → Add Friend
2. Search for the alt account gamertag (e.g., "FamilyServerBot")
3. Add as friend
4. When the server is online, the alt account shows as "Joinable"
5. Click the alt account → Join Game → connects to the server
```

This works on **Xbox, PlayStation, Switch, PC, and mobile** — all platforms see the Friends tab.

#### PlayStation — Easy (same as Xbox)

Same MCXboxBroadcast method. PlayStation Bedrock players have a Microsoft account linked. They:
1. Add the alt account as a friend
2. See "Joinable" when server is online
3. Click to join

#### Nintendo Switch — Easy (same as Xbox)

Same MCXboxBroadcast method. Switch Bedrock players also link Microsoft accounts.

#### BedrockConnect Fallback (if MCXboxBroadcast doesn't work for a player)

**Setup (admin, one-time):**
```bash
# In CT 105 (mc-tunnel), also run BedrockConnect
mkdir -p /opt/bedrockconnect && cd /opt/bedrockconnect
curl -LO https://github.com/Pugmatt/BedrockConnect/releases/latest/download/BedrockConnect-1.0-SNAPSHOT.jar

# Run BedrockConnect
java -jar BedrockConnect-1.0-SNAPSHOT.jar \
    --custom_servers '[{"name":"Family Server","ip":"YOUR_PLAYIT_ADDRESS","port":YOUR_PLAYIT_PORT}]'

# Create systemd service (similar to MCXboxBroadcast above)
```

**Player setup (one-time, per console):**
```
1. Go to console network settings (WiFi or Ethernet)
2. Set DNS to Manual
3. Primary DNS: [IP of your BedrockConnect instance, via Playit tunnel or Tailscale]
4. Secondary DNS: 8.8.8.8
5. Save
6. Open Minecraft → Servers → click any Featured Server (e.g., "The Hive")
7. Instead of connecting to The Hive, you'll see a custom server list
8. Select "Family Server" → connects to your server
```

> **Note:** The public BedrockConnect DNS (`104.238.130.180`) also works but is third-party hosted. Self-hosting gives you full control.

### Connection Method Summary

| Platform | Primary Method | Difficulty | Ongoing Effort |
|----------|---------------|------------|----------------|
| PC (Windows) | Add Server directly | Trivial | None |
| Mobile (iOS/Android) | Add Server directly | Trivial | None |
| Xbox | MCXboxBroadcast Friends tab | Easy (one-time friend add) | None |
| PlayStation | MCXboxBroadcast Friends tab | Easy (one-time friend add) | None |
| Nintendo Switch | MCXboxBroadcast Friends tab | Easy (one-time friend add) | None |
| Any console (fallback) | BedrockConnect DNS | Moderate (one-time DNS change) | None after setup |

---

## 9. Complete Implementation Plan

### Phase 1: Proxmox Hardening and Base Setup (Day 1, ~3-4 hours)

**Objective:** Get Proxmox stable with T2 support, fan control, and remote access.

**Prerequisites:** Proxmox VE 9.1 already installed.

**Step 1.1: Verify T2 kernel support**
```bash
# Check if T2 kernel is installed
uname -r
# If not showing t2-patched kernel:

# Add T2 kernel repository
apt install -y curl gnupg
curl -s https://adityagarg8.github.io/t2-ubuntu-repo/KEY.gpg | gpg --dearmor -o /etc/apt/trusted.gpg.d/t2-ubuntu.gpg
echo "deb https://adityagarg8.github.io/t2-ubuntu-repo/ jammy main" > /etc/apt/sources.list.d/t2.list
apt update

# Check for available T2 kernels compatible with PVE 9.1
# Install the appropriate pve-edge-kernel-t2 package
apt install pve-edge-kernel-t2

# Pin the T2 kernel as default
proxmox-boot-tool kernel pin <version>

# Reboot
reboot
```

**Step 1.2: Install fan control**
```bash
apt install -y mbpfan

# Configure aggressive fan curves
cat > /etc/mbpfan.conf << 'EOF'
[general]
min_fan1_speed = 2500
max_fan1_speed = 6200
low_temp = 55
high_temp = 65
max_temp = 85
polling_interval = 1
EOF

systemctl enable --now mbpfan

# Verify fans are spinning
cat /sys/devices/platform/applesmc.768/fan*_output
```

**Step 1.3: Configure Ethernet networking**
```bash
# The Mac Mini 2019's built-in Broadcom BCM57766 Gigabit Ethernet works
# out of the box via the tg3 driver. Verify:
ip link show
# Should show an interface like enp3s0f0 or ens5

# During initial setup (tethered to desktop):
# The Proxmox installer likely already configured this.
# Verify connectivity:
ping -c 3 google.com

# At deployment (wired to router at stepfather's house):
# Update /etc/network/interfaces if the subnet differs:
# Example:
cat /etc/network/interfaces
# auto lo
# iface lo inet loopback
#
# auto enp3s0f0
# iface enp3s0f0 inet static
#     address 192.168.1.10
#     netmask 255.255.255.0
#     gateway 192.168.1.1
```

**Step 1.4: Configure Proxmox bridge for containers**
```bash
# With wired Ethernet, standard bridging works perfectly.
# Proxmox likely already created vmbr0 during installation.
# Verify:
cat /etc/network/interfaces

# If vmbr0 doesn't exist or needs updating:
cat > /etc/network/interfaces << 'EOF'
auto lo
iface lo inet loopback

auto enp3s0f0
iface enp3s0f0 inet manual

auto vmbr0
iface vmbr0 inet static
    address 192.168.1.10/24
    gateway 192.168.1.1
    bridge-ports enp3s0f0
    bridge-stp off
    bridge-fd 0
EOF

systemctl restart networking
```

> **Note:** With wired Ethernet, containers get IPs on the same subnet as the host (e.g., 192.168.1.x) via the bridge. This is the standard, simplest Proxmox networking mode. Containers can be reached directly from the LAN. Adjust the subnet to match your router's network.

**Step 1.5: Configure storage**
```bash
# Verify LVM-thin is set up (Proxmox installer usually does this)
lvs
# Should show a thin pool on your NVMe

# If not, create one:
lvcreate -L 400G -T pve/data
```

**Step 1.6: Install Tailscale on host**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh

# Note your Tailscale IP (100.x.y.z)
tailscale ip -4

# Test: access Proxmox web UI from your laptop via Tailscale IP
# https://100.x.y.z:8006
```

**Step 1.7: Harden Proxmox**
```bash
# Disable the enterprise repo (to avoid apt errors with no subscription)
sed -i 's/^deb/#deb/' /etc/apt/sources.list.d/pve-enterprise.list

# Add no-subscription repo
echo "deb http://download.proxmox.com/debian/pve bookworm pve-no-subscription" > /etc/apt/sources.list.d/pve-no-sub.list
apt update && apt upgrade -y

# Configure firewall (Proxmox web UI → Datacenter → Firewall)
# Or via iptables: only allow Tailscale subnet for management
```

**Verify before proceeding:**
- [ ] T2 kernel installed and booted
- [ ] mbpfan running, CPU temps stable under 75°C idle
- [ ] Ethernet connected and internet reachable
- [ ] vmbr0 bridge created (bridged to Ethernet interface)
- [ ] Tailscale running, can access Proxmox UI via 100.x.y.z:8006
- [ ] Storage pool available for containers

---

### Phase 2: Core Containers (Day 1, ~2 hours)

**Objective:** Create all LXC containers with a reproducible process.

**Step 2.1: Download container templates**
```bash
# On Proxmox host
pveam update
pveam available | grep -E "ubuntu-22|debian-12"
pveam download local ubuntu-22.04-standard_22.04-1_amd64.tar.zst
pveam download local debian-12-standard_12.7-1_amd64.tar.zst
```

**Step 2.2: Create BDS World 1 container (CT 100)**
```bash
pct create 100 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
    --hostname mc-world-1 \
    --memory 2048 \
    --swap 512 \
    --cores 2 \
    --rootfs local-lvm:10 \
    --net0 name=eth0,bridge=vmbr0,ip=192.168.1.100/24,gw=192.168.1.1 \
    --nameserver 8.8.8.8 \
    --unprivileged 1 \
    --features nesting=1 \
    --start 1

# Enter container and set up base packages
pct exec 100 -- bash -c "
    apt update && apt upgrade -y
    apt install -y curl wget unzip screen libcurl4 libssl3
    useradd -m -s /bin/bash minecraft
"
```

**Step 2.3: Create BDS World 2 container (CT 101)**
```bash
pct create 101 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
    --hostname mc-world-2 \
    --memory 2048 \
    --swap 512 \
    --cores 2 \
    --rootfs local-lvm:10 \
    --net0 name=eth0,bridge=vmbr0,ip=192.168.1.101/24,gw=192.168.1.1 \
    --nameserver 8.8.8.8 \
    --unprivileged 1 \
    --features nesting=1 \
    --start 1

pct exec 101 -- bash -c "
    apt update && apt upgrade -y
    apt install -y curl wget unzip screen libcurl4 libssl3
    useradd -m -s /bin/bash minecraft
"
```

**Step 2.4: Create Crafty Controller container (CT 102)**
```bash
pct create 102 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
    --hostname mc-crafty \
    --memory 2048 \
    --swap 512 \
    --cores 2 \
    --rootfs local-lvm:15 \
    --net0 name=eth0,bridge=vmbr0,ip=192.168.1.102/24,gw=192.168.1.1 \
    --nameserver 8.8.8.8 \
    --unprivileged 1 \
    --features nesting=1 \
    --start 1
```

**Step 2.5: Create remaining containers**
```bash
# Custom Web UI (CT 103)
pct create 103 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
    --hostname mc-webui \
    --memory 1024 \
    --swap 256 \
    --cores 1 \
    --rootfs local-lvm:8 \
    --net0 name=eth0,bridge=vmbr0,ip=192.168.1.103/24,gw=192.168.1.1 \
    --nameserver 8.8.8.8 \
    --unprivileged 1 \
    --start 1

# Caddy Reverse Proxy (CT 104)
pct create 104 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
    --hostname mc-proxy \
    --memory 512 \
    --swap 256 \
    --cores 1 \
    --rootfs local-lvm:5 \
    --net0 name=eth0,bridge=vmbr0,ip=192.168.1.104/24,gw=192.168.1.1 \
    --nameserver 8.8.8.8 \
    --unprivileged 1 \
    --start 1

# Playit.gg + MCXboxBroadcast (CT 105)
pct create 105 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
    --hostname mc-tunnel \
    --memory 1024 \
    --swap 256 \
    --cores 1 \
    --rootfs local-lvm:5 \
    --net0 name=eth0,bridge=vmbr0,ip=192.168.1.105/24,gw=192.168.1.1 \
    --nameserver 8.8.8.8 \
    --unprivileged 1 \
    --start 1

# Uptime Kuma (CT 106)
pct create 106 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
    --hostname mc-monitor \
    --memory 512 \
    --swap 256 \
    --cores 1 \
    --rootfs local-lvm:5 \
    --net0 name=eth0,bridge=vmbr0,ip=192.168.1.106/24,gw=192.168.1.1 \
    --nameserver 8.8.8.8 \
    --unprivileged 1 \
    --start 1
```

**Step 2.6: Create a container template for future worlds**
```bash
# After setting up CT 100 with BDS, create a template
pct stop 100
# ... (do this after Phase 3 BDS setup is complete)
# Clone CT 100 to create a template:
pct clone 100 999 --hostname mc-world-template --full
# Convert to template:
pct template 999

# To spin up a new world later:
pct clone 999 102 --hostname mc-world-3 --full
# Update server.properties with new port and world name
```

**Verify before proceeding:**
- [ ] All containers created and starting
- [ ] All containers can reach the internet (test: `pct exec 100 -- ping -c 3 google.com`)
- [ ] Containers can reach each other on 10.10.10.x network

---

### Phase 3: BDS Setup and Realm Migration (Day 1-2, ~3 hours)

**Objective:** Install BDS in each world container and import Realm worlds.

**Step 3.1: Install BDS in CT 100**
```bash
pct exec 100 -- bash << 'SCRIPT'
mkdir -p /opt/bedrock && cd /opt/bedrock

# Download BDS (check https://www.minecraft.net/en-us/download/server/bedrock for latest URL)
BEDROCK_VERSION="1.21.50.25"  # Replace with current version
wget "https://minecraft.azureedge.net/bin-linux/bedrock-server-${BEDROCK_VERSION}.zip" -O bedrock-server.zip
unzip bedrock-server.zip
rm bedrock-server.zip

# Set permissions
chown -R minecraft:minecraft /opt/bedrock
chmod +x /opt/bedrock/bedrock_server

# Create systemd service
cat > /etc/systemd/system/bedrock.service << 'EOF'
[Unit]
Description=Minecraft Bedrock Server
After=network.target

[Service]
Type=forking
User=minecraft
WorkingDirectory=/opt/bedrock
ExecStart=/usr/bin/screen -dmS bedrock /opt/bedrock/bedrock_server
ExecStop=/usr/bin/screen -S bedrock -X stuff "stop\n"
TimeoutStopSec=30
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Start once to generate default files
su - minecraft -c "cd /opt/bedrock && screen -dmS bedrock ./bedrock_server"
sleep 10
su - minecraft -c "screen -S bedrock -X stuff 'stop\n'"
sleep 5

systemctl daemon-reload
systemctl enable bedrock
SCRIPT
```

**Step 3.2: Configure server.properties for World 1**
```bash
pct exec 100 -- bash -c "cat > /opt/bedrock/server.properties << 'EOF'
server-name=Family Server - World 1
gamemode=survival
force-gamemode=false
difficulty=normal
allow-cheats=true
max-players=20
online-mode=true
allow-list=true
server-port=19132
server-portv6=19133
view-distance=10
tick-distance=4
player-idle-timeout=30
max-threads=0
level-name=world1
level-seed=
default-player-permission-level=member
textpacket-chat-enabled=true
compression-threshold=1
compression-algorithm=zlib
server-authoritative-movement=server-auth
correct-player-movement=false
content-log-file-enabled=false
emit-server-telemetry=false
EOF
chown minecraft:minecraft /opt/bedrock/server.properties"
```

**Step 3.3: Import Realm world (follow Section 5 procedure)**
```bash
# On your Windows PC, after downloading and exporting the Realm:
# 1. Extract the .mcworld file
# 2. SCP the db/ folder to the container:
scp -r /path/to/realm-world/db/* root@192.168.1.100:/opt/bedrock/worlds/world1/db/
# 3. Set the level-seed in server.properties
# 4. DO NOT copy level.dat
```

**Step 3.4: Repeat for CT 101 (World 2)**
```bash
# Same process as steps 3.1-3.3, but:
# - Use port 19134 in server.properties
# - Use level-name=world2
# - Import the second Realm's db/ folder
```

**Step 3.5: Install MCscripts for backup in each BDS container**
```bash
for CT in 100 101; do
    pct exec $CT -- bash << 'SCRIPT'
    apt install -y curl unzip cron
    curl -L https://github.com/TapeWerm/MCscripts/archive/refs/heads/master.zip -o /tmp/mcscripts.zip
    unzip /tmp/mcscripts.zip -d /tmp
    cd /tmp/MCscripts-master/src
    ./install.sh
    systemctl enable --now mcbe-backup@world.timer
SCRIPT
done
```

**Step 3.6: Test**
```bash
# Start BDS
pct exec 100 -- systemctl start bedrock

# Connect from a Bedrock client on the same network
# (use Tailscale IP or LAN IP to test before tunnel setup)

# Check logs
pct exec 100 -- su - minecraft -c "screen -r bedrock"
# (Ctrl+A, D to detach)
```

**Verify before proceeding:**
- [ ] BDS starts and loads the migrated world without errors
- [ ] Can connect from a Bedrock client and see the Realm world intact
- [ ] Builds, chests, and items are present
- [ ] New chunks generate terrain consistent with the original seed
- [ ] MCscripts backup timer is active

---

### Phase 4: Management Panel and Reverse Proxy (Day 2, ~2 hours)

**Step 4.1: Install Crafty Controller in CT 102**
```bash
pct exec 102 -- bash << 'SCRIPT'
apt update && apt install -y python3 python3-pip python3-venv git openjdk-17-jre-headless

# Install Crafty Controller 4
cd /opt
git clone https://gitlab.com/crafty-controller/crafty-4.git
cd crafty-4
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create systemd service
cat > /etc/systemd/system/crafty.service << 'EOF'
[Unit]
Description=Crafty Controller 4
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/crafty-4
ExecStart=/opt/crafty-4/venv/bin/python main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now crafty
SCRIPT
```

> **Note:** Crafty manages BDS processes. Since BDS runs in separate containers (CT 100, CT 101), Crafty will need to communicate with them via SSH or API. Alternative: run Crafty inside each BDS container. The simpler approach is to use Crafty for monitoring/API and manage BDS via systemd + screen in each container, with the custom UI calling commands through SSH or a thin wrapper API.

**Step 4.2: Install Caddy in CT 104**
```bash
pct exec 104 -- bash << 'SCRIPT'
apt update && apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

cat > /etc/caddy/Caddyfile << 'EOF'
# Crafty Controller (admin only, via Tailscale)
:443 {
    reverse_proxy 192.168.1.102:8443 {
        transport http {
            tls_insecure_skip_verify
        }
    }
}

# Custom Family UI
:8080 {
    reverse_proxy 192.168.1.103:3000
}

# Uptime Kuma
:8081 {
    reverse_proxy 192.168.1.106:3001
}
EOF

systemctl enable --now caddy
SCRIPT
```

**Verify before proceeding:**
- [ ] Crafty web UI accessible via Tailscale IP
- [ ] Caddy proxying correctly
- [ ] Can see BDS server status in Crafty

---

### Phase 5: Remote Access and Tunnel Setup (Day 2, ~1 hour)

**Step 5.1: Install Playit.gg agent in CT 105**
```bash
pct exec 105 -- bash << 'SCRIPT'
apt update && apt install -y curl

# Install Playit.gg
curl -SsL https://playit.gg/downloads/playit-linux-amd64 -o /usr/local/bin/playit
chmod +x /usr/local/bin/playit

# First run — interactive, will generate a claim URL
# Open the URL in your browser to link to your Playit.gg account
playit setup

# After setup, create tunnels via the Playit.gg web dashboard:
# Tunnel 1: Minecraft Bedrock → 192.168.1.100:19132
# Tunnel 2: Minecraft Bedrock → 192.168.1.101:19134

# Create systemd service
cat > /etc/systemd/system/playit.service << 'EOF'
[Unit]
Description=Playit.gg Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/playit
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now playit
SCRIPT
```

**Step 5.2: Note your Playit.gg addresses**
```
After creating tunnels on playit.gg dashboard:
World 1: 180.ip.ply.gg:XXXXX (note this address)
World 2: 180.ip.ply.gg:YYYYY (note this address)
```

**Step 5.3: Test player connection**
```
1. On a PC/mobile Bedrock client (NOT on local network)
2. Add Server → enter Playit.gg address and port
3. Should connect to your world
```

**Verify before proceeding:**
- [ ] Playit.gg agent running and connected
- [ ] Can connect from an external network via Playit.gg address
- [ ] Both worlds reachable via their respective Playit addresses

---

### Phase 6: Console Player Access (Day 2, ~1 hour)

**Step 6.1: Install MCXboxBroadcast in CT 105**
```bash
pct exec 105 -- bash << 'SCRIPT'
apt install -y openjdk-17-jre-headless

mkdir -p /opt/mcxboxbroadcast && cd /opt/mcxboxbroadcast
curl -LO https://github.com/rtm516/MCXboxBroadcast/releases/latest/download/MCXboxBroadcastStandalone.jar

# First run — follow device code login with a DEDICATED ALT Microsoft account
java -jar MCXboxBroadcastStandalone.jar
# Browser login, then Ctrl+C after successful auth

# Edit the generated config to point to your Playit.gg addresses
# (MCXboxBroadcast needs to advertise the PUBLIC address players will connect to)

cat > /etc/systemd/system/mcxboxbroadcast.service << 'EOF'
[Unit]
Description=MCXboxBroadcast
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/mcxboxbroadcast
ExecStart=/usr/bin/java -jar MCXboxBroadcastStandalone.jar
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now mcxboxbroadcast
SCRIPT
```

**Step 6.2: Test console access**
```
1. On Xbox/PS/Switch, add the alt account as a friend
2. Check the Friends tab — should see the alt account as "Joinable"
3. Click to join — should connect to the server
```

**Step 6.3: Install BedrockConnect as fallback (optional)**
```bash
pct exec 105 -- bash << 'SCRIPT'
mkdir -p /opt/bedrockconnect && cd /opt/bedrockconnect
curl -LO https://github.com/Pugmatt/BedrockConnect/releases/latest/download/BedrockConnect-1.0-SNAPSHOT.jar

cat > /etc/systemd/system/bedrockconnect.service << 'EOF'
[Unit]
Description=BedrockConnect
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/bedrockconnect
ExecStart=/usr/bin/java -jar BedrockConnect-1.0-SNAPSHOT.jar --custom_servers '[{"name":"Family World 1","ip":"YOUR_PLAYIT_ADDRESS","port":YOUR_PLAYIT_PORT}]'
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now bedrockconnect
SCRIPT
```

**Verify before proceeding:**
- [ ] MCXboxBroadcast running and authenticated
- [ ] Console players can see server in Friends tab
- [ ] Console players can join successfully

---

### Phase 7: Backup Automation (Day 2-3, ~1 hour)

**Step 7.1: Configure MCscripts backup timers (already done in Phase 3)**

**Step 7.2: Configure Proxmox vzdump scheduled backups**
```bash
# On Proxmox host, via web UI or CLI:
# Datacenter → Backup → Add
# Or via config:

cat >> /etc/pve/jobs.cfg << 'EOF'
vzdump: backup-daily
    enabled 1
    schedule 0 3 * * *
    storage local
    mode snapshot
    compress zstd
    vmid 100,101,102,103,104,105,106
    prune-backups keep-last=3,keep-daily=7,keep-weekly=4
    notes-template {{guestname}}
EOF
```

**Step 7.3: Install the vzdump hook script**
```bash
mkdir -p /var/lib/vz/snippets
cat > /var/lib/vz/snippets/bds-backup-hook.sh << 'HOOKEOF'
#!/bin/bash
VMID=$1
PHASE=$2

if [[ "$VMID" == "100" || "$VMID" == "101" ]]; then
    case "$PHASE" in
        job-start)
            pct exec $VMID -- su - minecraft -c 'screen -S bedrock -X stuff "save hold\n"' 2>/dev/null
            sleep 5
            ;;
        job-end|job-abort)
            pct exec $VMID -- su - minecraft -c 'screen -S bedrock -X stuff "save resume\n"' 2>/dev/null
            ;;
    esac
fi
HOOKEOF
chmod +x /var/lib/vz/snippets/bds-backup-hook.sh
```

**Step 7.4: Configure offsite backup**
```bash
apt install -y rclone

# Configure rclone for your chosen offsite destination
rclone config
# Options:
# A) Oracle Cloud Object Storage (free tier, 10GB)
# B) USB drive mounted on the host
# C) Another machine via Tailscale + SSH/SFTP

# Create daily offsite sync cron
cat > /etc/cron.d/offsite-backup << 'EOF'
0 5 * * * root rclone sync /var/lib/vz/dump/ remote:mc-backups/ --include "vzdump-lxc-10{0,1}*" --bwlimit 5M 2>&1 | logger -t offsite-backup
EOF
```

**Step 7.5: Set up Healthchecks.io monitoring**
```bash
# Create a free account at healthchecks.io
# Create a check for each backup job
# Add ping to your backup cron jobs:
# && curl -fsS https://hc-ping.com/YOUR-UUID-HERE
```

**Verify before proceeding:**
- [ ] MCscripts backup timer firing on schedule
- [ ] vzdump creating nightly backups
- [ ] Offsite sync running
- [ ] Test restore from MCscripts backup
- [ ] Test restore from vzdump backup

---

### Phase 8: Monitoring (Day 3, ~30 minutes)

**Step 8.1: Install Uptime Kuma in CT 106**
```bash
pct exec 106 -- bash << 'SCRIPT'
apt update && apt install -y curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git

cd /opt
git clone https://github.com/louislam/uptime-kuma.git
cd uptime-kuma
npm run setup

cat > /etc/systemd/system/uptime-kuma.service << 'EOF'
[Unit]
Description=Uptime Kuma
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/uptime-kuma
ExecStart=/usr/bin/node server/server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now uptime-kuma
SCRIPT
```

**Step 8.2: Configure monitors**
```
Access Uptime Kuma at http://192.168.1.106:3001 (via Tailscale)
Add monitors:
- BDS World 1: Gamedig/Minecraft Bedrock → 192.168.1.100:19132
- BDS World 2: Gamedig/Minecraft Bedrock → 192.168.1.101:19134
- Crafty Controller: HTTP → https://192.168.1.102:8443
- Playit.gg Agent: check process running
- MCXboxBroadcast: check process running
```

---

### Phase 9: Custom Web UI Development (Day 3-7, ~8-16 hours)

This is the largest effort. See Section 7 for the full architecture spec.

**Step 9.1: Set up Next.js project**
```bash
pct exec 103 -- bash << 'SCRIPT'
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git

cd /opt
npx create-next-app@latest family-mc-ui --typescript --tailwind --eslint --app --src-dir
cd family-mc-ui
npm install next-auth@beta @auth/core better-sqlite3
npx shadcn@latest init
npx shadcn@latest add button card dialog dropdown-menu input label select switch badge
SCRIPT
```

**Step 9.2: Implement core features**
- Authentication (NextAuth.js + SQLite)
- Dashboard page (server status, player list)
- Server controls (start/stop/restart via Crafty API)
- Player management (allowlist, kick, gamemode)
- Preset activation (batch commands via Crafty API)
- Backup controls (trigger backup, view history)

**Step 9.3: Deploy**
```bash
pct exec 103 -- bash -c "
    cd /opt/family-mc-ui
    npm run build

    cat > /etc/systemd/system/family-ui.service << 'EOF'
[Unit]
Description=Family MC Web UI
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/family-mc-ui
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable --now family-ui
"
```

**Verify before proceeding:**
- [ ] Custom UI accessible via Tailscale
- [ ] Login works with role-based access
- [ ] Can start/stop server from UI
- [ ] Can kick players, change difficulty, activate presets
- [ ] Mobile-responsive layout works on phone

---

### Phase 10: Testing and Go-Live (Day 7-8, ~2 hours)

**Checklist:**
- [ ] All worlds migrated and verified
- [ ] PC/mobile players can connect via Playit.gg
- [ ] Console players can connect via MCXboxBroadcast Friends tab
- [ ] Non-technical admin can use the custom web UI on their phone
- [ ] Backups running on schedule (MCscripts + vzdump + offsite)
- [ ] Uptime Kuma monitoring all services
- [ ] Test disaster recovery: restore world from backup
- [ ] Test Proxmox rollback from snapshot
- [ ] Document Playit.gg addresses for all players
- [ ] Create "How to Connect" guide for each platform
- [ ] Hand over Moderator/Viewer accounts to family admins

---

### Phase 11: Future Improvements

| Priority | Improvement | Effort | When |
|----------|------------|--------|------|
| 1 | Endstone plugin framework (when stable) | Medium | When Endstone hits stable release |
| 2 | Discord bot for server control | Medium | After go-live, when stable |
| 3 | Addon upload via web UI | Medium | When addon management is needed |
| 4 | WireGuard + VPS relay (replace Playit.gg) | High | If Playit.gg becomes unreliable |
| 5 | Automated world pruning (Amulet Editor) | Low | When world sizes become large |
| 6 | Pelican Panel (Pterodactyl successor) | High | When Pelican reaches stable and if Crafty API is insufficient |
| 7 | Geyser+Paper for a plugin-heavy event world | Medium | If Java plugin ecosystem is desired |

---

## 10. Gaps and Risks

### What None of the 4 Sources Adequately Covered

| Gap | Impact | Mitigation |
|-----|--------|------------|
| **Initial setup networking (tethered to desktop)** | Low. During setup the Mac Mini is Ethernet-tethered to a desktop PC rather than directly to a router. At deployment it will be wired to the router. | Ensure the desktop PC is sharing its internet connection (ICS on Windows or internet sharing on macOS). At deployment, update `/etc/network/interfaces` with the correct subnet/gateway for the stepfather's router. |
| **MCXboxBroadcast auth token expiration** | Medium. Microsoft auth tokens expire. MCXboxBroadcast needs periodic re-authentication. | Monitor MCXboxBroadcast logs, set up Uptime Kuma alert, re-auth when needed. |
| **Playit.gg free tier limitations and reliability** | Medium. If Playit.gg has outages or changes free tier terms, players can't connect. | Monitor uptime. Have WireGuard + VPS relay as Plan B (Oracle Cloud free tier VPS). |
| **BDS auto-update vs client auto-update race condition** | Medium. If Minecraft clients auto-update before BDS releases a matching version, players can't connect for days. | Pin BDS version with MCscripts `version_pin.txt`. Instruct players to disable auto-updates. Keep a pre-update Proxmox snapshot. |
| **T2 chip kernel updates** | Medium. Proxmox/Debian kernel updates may break T2 compatibility. | Pin the T2 kernel, don't auto-update the kernel. Test kernel updates manually with a snapshot first. |
| **Power outages at remote location** | Medium. No UPS mentioned. Power loss = unclean shutdown = potential LevelDB corruption. | Buy a cheap UPS ($30-50). Configure `apcupsd` or `nut` to gracefully shut down BDS on power loss. |
| **Crafty Controller managing BDS in separate LXC containers** | Medium. Crafty typically manages servers running on the same host. With BDS in separate containers, Crafty needs SSH or API access to each container. | Alternative: skip Crafty, build a lightweight custom wrapper API in each BDS container that manages the BDS process directly. The custom web UI calls these wrapper APIs. This is simpler than making Crafty work across containers. |
| **IPv6 considerations** | Low. Some ISPs are moving to IPv6-only or CGNAT. Playit.gg handles this, but direct connections would be affected. | Playit.gg abstracts this away. Not a concern unless moving off Playit.gg. |

### Biggest Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Network config mismatch when moving to deployment** | Low | Medium | Document the stepfather's router subnet in advance. Update `/etc/network/interfaces` and container IPs before transport. Test Tailscale access immediately after plugging in. |
| **Realm world migration loses data** | Medium | High | Follow DB-only method exactly. Have all players dump inventory to chests first. Keep original .mcworld export as backup. |
| **T2 kernel breaks on Proxmox update** | Medium | High | Pin kernel version. Snapshot before any system update. |
| **Custom web UI development takes longer than expected** | High | Medium | Start with a minimal viable UI (just start/stop/status). Add features incrementally. Consider using Crafty's built-in UI for initial go-live. |
| **Playit.gg goes down or changes terms** | Low | High | Plan B: Oracle Cloud free tier VPS + WireGuard relay |
| **MCXboxBroadcast stops working (Microsoft API changes)** | Medium | Medium | BedrockConnect DNS as fallback. Monitor the GitHub repo for issues. |
| **LevelDB corruption from improper backup** | Low (with MCscripts) | High | Always use save hold/query/resume. Never copy db/ while BDS is writing. |
| **Remote location access issues (can't physically reach server)** | Low | High | Tailscale provides remote SSH/Proxmox access. For hardware issues, you'll need to visit. Consider IPMI-like setup via Tailscale SSH. |

### What Should You Have a Plan B For

| Component | Plan A | Plan B |
|-----------|--------|--------|
| Player tunnel | Playit.gg free tier | Oracle Cloud free VPS + WireGuard + iptables NAT |
| Console access | MCXboxBroadcast | BedrockConnect DNS redirect |
| Network connection | Wired Ethernet (built-in Gigabit) | USB Ethernet adapter if onboard NIC fails |
| Management panel | Crafty Controller | Custom wrapper API per container (Node.js, minimal) |
| Offsite backup | Oracle Cloud free tier | USB drive attached to Mac Mini |
| Custom web UI | Next.js custom app | Crafty's built-in web UI with restricted roles |
| Fan control | mbpfan | Manual fan speed via `echo` to `/sys/devices/platform/applesmc.768/fan*_manual` |
| BDS (if it lags) | BDS with current settings | Reduce view-distance to 8, tick-distance to 3 |

---

## Appendix A: Key Configuration Files Reference

### server.properties (per world)
```properties
server-name=Family Server
gamemode=survival
force-gamemode=false
difficulty=normal
allow-cheats=true
max-players=20
online-mode=true
allow-list=true
server-port=19132
server-portv6=19133
view-distance=10
tick-distance=4
player-idle-timeout=30
max-threads=0
level-name=world1
level-seed=YOUR_SEED_HERE
default-player-permission-level=member
compression-threshold=1
compression-algorithm=zlib
server-authoritative-movement=server-auth
correct-player-movement=false
content-log-file-enabled=false
emit-server-telemetry=false
```

### allowlist.json
```json
[
    {
        "ignoresPlayerLimit": false,
        "name": "PlayerGamertag",
        "xuid": "1234567890123456"
    }
]
```

### permissions.json
```json
[
    {
        "permission": "operator",
        "xuid": "1234567890123456"
    }
]
```

### Linux optimizations (per BDS container)
```bash
# /etc/sysctl.d/99-minecraft.conf
net.core.rmem_max=16777216
net.core.wmem_max=16777216
fs.file-max=65536

# Apply: sysctl --system
```

## Appendix B: BDS Command Quick Reference

| Command | Description |
|---------|-------------|
| `allowlist add <name>` | Add player to allowlist |
| `allowlist remove <name>` | Remove player from allowlist |
| `allowlist on` | Enable allowlist |
| `allowlist off` | Disable allowlist |
| `kick <name> [reason]` | Kick a player |
| `difficulty <level>` | Set difficulty (peaceful/easy/normal/hard) |
| `gamemode <mode> [player]` | Set gamemode (survival/creative/adventure/spectator) |
| `gamerule <rule> <value>` | Set a game rule |
| `list` | List online players |
| `save hold` | Prepare for backup (freeze writes) |
| `save query` | Query backup file list |
| `save resume` | Resume after backup |
| `stop` | Stop the server |
| `op <name>` | Grant operator status |
| `deop <name>` | Revoke operator status |
| `tp <player> <x> <y> <z>` | Teleport a player |
| `time set <value>` | Set world time (day/night/noon/midnight/0-24000) |
| `weather <type>` | Set weather (clear/rain/thunder) |
