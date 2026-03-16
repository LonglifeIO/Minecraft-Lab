# Self-hosted Minecraft Bedrock server on Mac Mini: a complete architecture

**The official Bedrock Dedicated Server (BDS) running in Proxmox LXC containers, managed by Crafty Controller, and exposed via Playit.gg is the optimal stack for replacing Minecraft Realms with a self-hosted solution on a Mac Mini 2019.** This architecture preserves existing Realm worlds without conversion, supports all player platforms including consoles, requires zero open router ports, and costs under $5/month in ongoing expenses. The Mac Mini's 64GB RAM is wildly overkill for this workload — BDS uses roughly **200–400 MB idle and 1–2 GB under active play** — leaving enormous headroom for growth, monitoring, and backup services. The entire platform can be operational within a weekend.

---

## Recommended complete architecture

The stack is built around BDS as the game engine — the only server software that natively reads Bedrock's LevelDB world format, meaning Realms worlds import with a simple file copy. Every other option (PocketMine-MP, PowerNukkitX, Geyser+Paper) either cannot load vanilla Bedrock worlds at all or requires lossy format conversion.

| Component | Recommended Tool | Alternative |
|-----------|-----------------|-------------|
| **Host OS** | Proxmox VE 8.x with T2-patched kernel | — |
| **Game Server** | Bedrock Dedicated Server (BDS) via itzg/docker-minecraft-bedrock-server | BDS native + Vellum wrapper |
| **Management Panel** | Crafty Controller 4 | MCSManager 10 |
| **Custom Web UI** | Next.js 15+ with shadcn/ui, calling Crafty/BDS wrapper API | — |
| **Remote Access (players)** | Playit.gg (UDP tunnel) | WireGuard + $4/mo VPS relay |
| **Remote Access (admin)** | Tailscale (mesh VPN) | WireGuard |
| **Console Player Support** | MCXboxBroadcast + BedrockConnect DNS | Phantom proxy |
| **Backups (application)** | MCscripts (systemd-based save hold/query/resume) | Vellum built-in backups |
| **Backups (system)** | Proxmox vzdump + PBS | — |
| **Backups (offsite)** | rclone → Backblaze B2 | restic encrypted to B2 |
| **Monitoring** | Uptime Kuma + Healthchecks.io | Grafana + Prometheus |
| **Reverse Proxy** | Caddy (for web panel HTTPS) | Nginx Proxy Manager |

### Why BDS wins over every alternative

| Feature | BDS | PocketMine-MP | PowerNukkitX | Geyser+Paper |
|---------|-----|---------------|--------------|--------------|
| **Native .mcworld import** | ✅ Direct copy | ❌ Incompatible | ❌ Incompatible | ❌ Requires conversion |
| **Vanilla survival fidelity** | ✅ Full | ❌ Missing redstone, mob AI | ⚠️ Partial | ✅ Java mechanics (different) |
| **RAM usage** | ~200 MB–2 GB | Low | High (JVM) | High (JVM + Geyser) |
| **Plugin ecosystem** | Limited (Endstone, LeviLamina) | Large (Poggit) | Medium | Massive (Spigot/Paper) |
| **RCON support** | ❌ No | Via plugin | Via plugin | ✅ Native |
| **Linux support** | Ubuntu official, Docker excellent | Full | Full | Full |

BDS's lack of native RCON and plugin API is its main weakness. For this use case — migrating family Realms worlds where vanilla survival fidelity matters most — BDS is the only viable choice. The plugin gap can be partially filled by **Endstone** (Python/C++ plugin framework) or **LeviLamina** (C++ mod loader), both actively maintained as of early 2026. The RCON gap is solved by piping commands through stdin/stdout via a wrapper or management panel.

---

## Proxmox layout for the Mac Mini 2019

The Mac Mini 2019 uses an Intel i7-8700B (6 cores, 12 threads, 4.6 GHz turbo) with 64 GB DDR4 RAM and an Apple proprietary NVMe SSD. Proxmox runs well on this hardware with specific preparation.

### Hardware preparation and installation

The Apple **T2 security chip** is the primary obstacle. Before installing Proxmox: boot into macOS Recovery (Cmd+R), open Startup Security Utility, set to **"No Security"** and **"Allow Booting from External Media"**, then disable SIP via `csrutil disable` in Terminal. Install Proxmox VE 8.x from the official ISO — it boots and installs directly via EFI. After installation, install the **T2-patched kernel** from the `pve-edge-kernel-t2` GitHub project by AdityaGarg8, which provides proper support for the internal NVMe SSD and other T2-mediated hardware. Use **wired Ethernet only** — the Broadcom BCM57766 Gigabit adapter works out of the box via the `tg3` driver. WiFi requires unreliable firmware extraction and is unsuitable for a server.

**Critical thermal requirement**: Install `mbpfan` immediately after Proxmox setup. Under Linux, the T2 chip provides only basic fan control (fans ramp at ~100°C). Without `mbpfan`, the CPU will thermal-throttle under sustained load. Configure aggressive fan curves: `low_temp=55`, `high_temp=65`, `max_temp=85`, `min_fan_speed=2500`. Consider replacing the factory thermal paste with Thermal Grizzly Kryonaut for long-term 24/7 reliability.

### Container and VM allocation

Use **LXC containers** for all services. BDS is a native C++ binary (not Java), so LXC provides near-native performance with only **1–3% overhead** versus 5–10% for full KVM VMs. The security trade-off is acceptable for a private family server behind Playit.gg — no ports are opened on the home router.

| Container | VMID | RAM | CPU Cores | Disk | OS |
|-----------|------|-----|-----------|------|----|
| **BDS Server 1** (main Realm world) | 100 | 4 GB | 3 | 10 GB | Ubuntu 22.04 |
| **BDS Server 2** (second world) | 101 | 4 GB | 3 | 10 GB | Ubuntu 22.04 |
| **Crafty Controller** (management panel) | 102 | 2 GB | 2 | 10 GB | Ubuntu 22.04 |
| **Caddy** (reverse proxy for HTTPS) | 103 | 512 MB | 1 | 5 GB | Debian 12 |
| **Monitoring** (Uptime Kuma) | 104 | 1 GB | 1 | 10 GB | Debian 12 |
| **Playit.gg agent** | — | Runs inside BDS containers | — | — | — |
| **Tailscale** | — | Runs on Proxmox host | — | — | — |
| **Proxmox host reserved** | — | 4 GB | — | 20 GB | — |
| **Total allocated** | — | ~15.5 GB | 10 | 65 GB | — |
| **Remaining free** | — | **~48.5 GB** | 2 cores | Varies | — |

Use **ext4 with LVM-thin** on the internal NVMe — not ZFS. ZFS's ARC cache competes for RAM and its write amplification penalizes consumer SSDs. LVM-thin still provides efficient snapshots. Pin CPU cores to prevent contention: cores 0–2 for BDS Server 1, cores 3–5 for BDS Server 2.

**Port allocation**: BDS Server 1 listens on **19132/UDP**, BDS Server 2 on **19134/UDP**. Configure in each server's `server.properties`.

---

## Migration process from Realms

Moving an existing Bedrock Realm world to a self-hosted BDS is straightforward but has sharp edges that can cause silent data loss or connection failures.

### Step-by-step migration

**1. Download the Realm world.** On Windows 10/11, launch Minecraft Bedrock → Play → Realms → Edit (pencil icon) → Configure Realm → select world slot → World Backups → Download Latest. The world appears in your local saves. Then edit the downloaded world → scroll down → Export World → save the `.mcworld` file. The world is saved to `C:\Users\<username>\AppData\Local\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\minecraftWorlds\`.

**2. Extract the .mcworld file.** Rename `.mcworld` to `.zip` and extract with any archive tool. The result is a folder containing: `db/` (the LevelDB database — the actual world data), `level.dat` (world metadata), `levelname.txt`, resource/behavior pack folders, and pack JSON manifests.

**3. Prepare BDS.** Start BDS once to generate its default directory structure, then stop it. This creates the expected `worlds/` folder and a working `level.dat`.

**4. Import the world — use the DB-only method.** This is the most reliable approach, avoiding a common bug where importing `level.dat` from the Realm causes connection failures:

- Navigate to your BDS installation's `worlds/<level-name>/db/` folder
- **Delete all contents** of this `db/` folder
- Copy all contents from your extracted Realm world's `db/` folder into this location
- **Do NOT copy `level.dat`** from the Realm export — keep the BDS-generated one
- In `server.properties`, set `level-seed` to match your original world seed
- Set `level-name` to exactly match the world folder name (case-sensitive)

**5. Handle player data carefully.** When migrating from Realms to BDS, the original host player's inventory is stored in `level.dat` (which you're not copying), while other players' data is stored by Xbox XUID in the LevelDB database. **Before exporting from Realms**, have all players dump their inventories into labeled chests at a known location. Tamed animal ownership may also break due to player ID changes between hosting contexts.

**6. Resource and behavior packs** bundled in the world transfer automatically. Register them in BDS's `valid_known_packs.json`. Marketplace-purchased packs are DRM-protected and cannot transfer — only free custom packs work.

### Common pitfalls

The most frequent failure is **copying `level.dat` from the export**, which causes "Unable to connect to world" errors. The second is **seed mismatch** — without setting the correct seed in `server.properties`, newly explored chunks generate completely different terrain, creating jarring borders. Third, **version mismatch**: the BDS version must match or exceed the Realm's Minecraft version. BDS releases sometimes lag client releases by days; pin client auto-updates until BDS catches up.

---

## Network architecture and secure remote access

The server sits at a remote house. The architecture uses **zero open router ports** — all traffic flows through encrypted tunnels and relay services.

### Player traffic: Playit.gg

**Playit.gg is the only free/low-cost tunnel service that natively supports Bedrock's UDP protocol** without requiring players to install any software. Cloudflare Tunnel does not support UDP. Tailscale requires every player to install a client (impossible on consoles). Playit.gg's standalone agent runs inside each BDS container, creating a "Minecraft Bedrock" tunnel that assigns a public address like `180.ip.ply.gg:17019`. Players enter this address directly in Minecraft's server list.

The **free tier** provides 4 UDP tunnels (enough for 2 servers) with global anycast routing. The **$3/month premium** adds regional routing (lower latency), custom domains (`mc.yourdomain.com`), and dedicated IPs. For a family server, the free tier works fine; premium is worthwhile if latency matters.

### Admin traffic: Tailscale

Install Tailscale on the Proxmox host and on the admin's personal devices. This creates a private WireGuard mesh VPN with **~0.6 ms added latency**. Access the Proxmox web UI, Crafty Controller panel, SSH, and custom web UI exclusively through Tailscale IPs (100.x.y.z). The admin can also play Minecraft through Tailscale for the lowest possible latency. The free personal plan supports 100 devices and 3 users.

### Console player access: MCXboxBroadcast + BedrockConnect

Xbox, PlayStation, and Nintendo Switch cannot natively enter custom server IPs. Two complementary solutions solve this:

**MCXboxBroadcast** makes the server appear in every player's "Friends" tab as a joinable session. Run it as a standalone Docker container alongside BDS, link a dedicated Microsoft alt account, and have console players friend that account. When the server is online, players see "Joinable" next to the alt account — one tap to connect. This works across Xbox, PlayStation, Switch, and all other platforms.

**BedrockConnect** serves as a fallback. Players change their console's DNS to `104.238.130.180`. When they click any Featured Server in Minecraft, they're redirected to a server-list UI where they can enter your custom server's address. This can be self-hosted for reliability using the BedrockConnect Docker container with a local DNS server.

| Platform | Primary Connection Method | Difficulty |
|----------|--------------------------|------------|
| **PC (Windows)** | Add server directly (IP:port) | Trivial |
| **Mobile (iOS/Android)** | Add server directly (IP:port) | Trivial |
| **Xbox** | MCXboxBroadcast Friends tab | Easy (one-time friend add) |
| **PlayStation** | MCXboxBroadcast Friends tab | Easy (one-time friend add) |
| **Nintendo Switch** | BedrockConnect DNS + MCXboxBroadcast | Moderate (one-time DNS change) |

**DNS SRV records do not work for Bedrock Edition** — the client simply doesn't query them. Use an A record pointing to your Playit.gg IP (or VPS relay) and tell players the port explicitly.

### Upgrade path: WireGuard + VPS relay

For maximum control and independence from Playit.gg, rent a **$3–5/month VPS** (Hetzner Cloud, OVH, Oracle Cloud free tier) and establish a WireGuard tunnel to the Mac Mini. On the VPS, use iptables to NAT UDP 19132 from the public IP through the tunnel: `iptables -t nat -A PREROUTING -p udp --dport 19132 -j DNAT --to-destination [WIREGUARD_HOME_IP]:19132`. Players connect to the VPS's static IP. The VPS provider's DDoS protection covers you, and your home IP stays hidden.

---

## Web UI architecture for two audiences

The system needs two interfaces: a **powerful admin panel** for the technical owner and a **simplified dashboard** for non-technical co-admins (parents, moderators).

### Admin panel: Crafty Controller 4

Crafty Controller is the recommended management panel. It's **free, open-source (GPLv3)**, has first-class Bedrock support with a dedicated server creation wizard, manages multiple servers simultaneously, includes automated backups with compression, and provides role-based permissions. Installation is straightforward via Docker or native Python (3.10+). It exposes a web console with real-time output and supports 30+ languages.

Crafty handles the technical admin's needs: full console access, file management, server properties editing, backup scheduling, and automatic BDS version updates. Its role-based system lets you create restricted accounts for co-admins with granular permissions (CONFIG, PLAYERS, etc.).

MCSManager 10 is a strong alternative with a distributed architecture and drag-and-drop dashboard widgets. Pterodactyl/Pelican offers the best API for building custom UIs on top, but its installation complexity (PHP, MySQL, Redis, Nginx, Wings daemon, Docker) is excessive for a 2-server family setup.

### Simplified custom UI: Next.js + BDS wrapper

For non-technical admins, build a lightweight custom web dashboard that exposes only safe operations. Since **BDS has no native RCON**, the backend must pipe commands through BDS's stdin/stdout.

**Recommended architecture**:

```
┌─────────────────────────────────────────────┐
│  Custom Web UI (Next.js 15 + shadcn/ui)     │
│  ├── Auth: NextAuth.js v5 + SQLite          │
│  ├── Role-based permissions (Admin/Mod/View)│
│  └── Mobile-responsive PWA                  │
├─────────────────────────────────────────────┤
│  API Layer (Next.js API Routes)              │
│  └── Calls Crafty Controller REST API       │
│      OR custom Node.js wrapper (child_process│
│      spawning BDS, piping stdin/stdout)      │
├─────────────────────────────────────────────┤
│  BDS Process (managed by Crafty or wrapper)  │
└─────────────────────────────────────────────┘
```

**Option A (simpler)**: Use Crafty Controller's API as the backend. The custom UI calls Crafty's endpoints for power actions, console commands, and backups. This avoids reimplementing process management.

**Option B (lighter)**: Build a custom Node.js wrapper that spawns BDS as a child process via `child_process.spawn()`, pipes stdin/stdout for command execution, and exposes REST endpoints. The `itzg/docker-minecraft-bedrock-server` container provides a WebSocket console protocol that's particularly clean — it uses typed messages (`stdin`, `stdout`, `stderr`, `logHistory`) with authentication via the `Sec-WebSocket-Protocol` header.

**Tech stack**: Next.js 15/16 with React, **shadcn/ui + Tailwind CSS v4** for the component library (accessible, responsive, highly customizable), NextAuth.js v5 with Credentials provider for authentication (stored in SQLite — zero external dependencies), and JWT-based sessions. Deploy as a Docker container in the Crafty LXC or its own container.

### UI features mapped to BDS commands

| UI Control | BDS Command(s) |
|-----------|----------------|
| Start / Stop / Restart | Process management (wrapper/panel level) |
| Backup World | `save hold` → `save query` → copy files → `save resume` |
| Change Difficulty | `difficulty <peaceful\|easy\|normal\|hard>` |
| Toggle Whitelist | `allowlist on` / `allowlist off` |
| Add Player to Whitelist | `allowlist add <player>` |
| Kick Player | `kick <player> [reason]` |
| Set Gamemode | `gamemode <survival\|creative\|adventure> [player]` |
| **🧒 Kid Friendly preset** | `difficulty peaceful` + `gamemode creative` + `gamerule pvp false` + `gamerule mobGriefing false` |
| **⚔️ Hard Survival preset** | `difficulty hard` + `gamemode survival` + `gamerule keepInventory false` |
| **🏗️ Build Event preset** | `gamemode creative` + `difficulty peaceful` + `gamerule doMobSpawning false` |

Note: BDS uses `allowlist` (not `whitelist`) and has **no native ban command** — implement bans by kicking + removing from the allowlist. The UI should feature large, clear action buttons with icons, confirmation dialogs for destructive actions, color-coded status indicators, player cards with avatars, and a mobile-first responsive layout (parents will often use phones).

### Role permissions model

- **Admin**: Full access — start/stop, all player management, presets, backup/restore, console, user management
- **Moderator**: Safe controls — kick players, manage allowlist, change difficulty, activate presets, view player list
- **Viewer**: Read-only — server status, player list, server stats

---

## Backup and recovery system

LevelDB is **highly susceptible to corruption** from copying files during active writes. The backup system must respect BDS's save protocol.

### Application-level backups with MCscripts

MCscripts provides production-grade systemd units for BDS backup using the proper `save hold` → `save query` → `save resume` protocol. Install via:

```bash
curl -L https://github.com/TapeWerm/MCscripts/archive/refs/heads/master.zip -o /tmp/master.zip
unzip /tmp/master.zip -d /tmp && sudo /tmp/MCscripts-master/src/install.sh
sudo systemctl enable --now mcbe-backup@MCBE.timer
```

Configure backup frequency via the systemd timer (default: daily). MCscripts also handles automatic BDS version updates, version pinning via `version_pin.txt`, and backup rotation (default: 2-week retention). The `save hold` command freezes disk writes while queuing changes in memory; `save query` returns the exact files and byte counts to copy (truncation lengths are critical for consistency); `save resume` flushes queued changes.

### Proxmox-level backups

Schedule nightly `vzdump` backups of all containers in snapshot mode. For BDS consistency, create a pre-backup hook script that issues `save hold` before the filesystem freeze:

```bash
# /etc/qemu/fsfreeze-hook.d/minecraft-backup.sh
case "$1" in
    freeze) screen -S bedrock -X stuff "save hold\n"; sleep 5 ;;
    thaw)   screen -S bedrock -X stuff "save resume\n" ;;
esac
```

Configure retention: keep last 3, 7 daily, 4 weekly, 2 monthly. Proxmox Backup Server (PBS) adds incremental deduplication — after the initial full backup, subsequent backups transfer only changed blocks and complete in seconds.

### Offsite backup to Backblaze B2

Use `rclone` to sync compressed world backups to Backblaze B2 (**$6/TB/month**, first 10 GB free). For a typical 1–5 GB world with 30 retained backups, expect **$0.04–$1.20/month**.

```bash
rclone sync /opt/minecraft/backups/ b2:mc-server-backups/ --bwlimit 10M --transfers 2
```

For encrypted deduplicating offsite backup, use `restic` with Backblaze B2 as the backend. Restic stores incremental snapshots — daily backups typically transfer only 10–50 MB of changed data.

### Layered backup architecture

| Layer | Tool | Frequency | Retention | Purpose |
|-------|------|-----------|-----------|---------|
| **Application** | MCscripts (save hold/query/resume + tar) | Every 4–6 hours | 7 days | Granular world recovery |
| **System** | Proxmox vzdump snapshot mode | Daily 3 AM | 3 last, 7 daily, 4 weekly | Full container state |
| **Pre-update snapshot** | Proxmox `pct snapshot` | Before each BDS update | Delete after verification | Quick rollback |
| **Offsite** | rclone → Backblaze B2 | Daily | 30 daily, 6 monthly | Disaster recovery |
| **Monitoring** | Healthchecks.io ping + size checks | Per backup | — | Alert on failures |

### Pre-update procedure

Before any BDS version update: (1) create a Proxmox container snapshot, (2) trigger an application-level world backup, (3) back up `server.properties`, `allowlist.json`, and `permissions.json`, (4) apply the update, (5) verify the server starts and the world loads. If broken, rollback via `pct rollback <VMID> pre-update`. Pin versions with `version_pin.txt` to prevent accidental auto-updates.

---

## Performance tuning for the Mac Mini

The i7-8700B scores **1,479 on Geekbench 6 single-core** — comfortably above BDS's minimum requirement (i3-3210). Under sustained load with 2 BDS instances serving 10–20 players each, expect CPU temperatures of **70–85°C**, well below throttling thresholds with proper fan control.

### Optimized server.properties

```properties
view-distance=10                          # Default; lower to 8 if performance issues arise
tick-distance=4                           # Simulation distance; keep at 4 for efficiency
max-threads=8                             # 0 for auto-detect
player-idle-timeout=30                    # Kick idle players to free resources
compression-threshold=1                   # Compress all packets
compression-algorithm=zlib                # Best compression ratio
server-authoritative-movement=server-auth # Better anti-cheat
correct-player-movement=false             # Reduces server CPU load
content-log-file-enabled=false            # Disable verbose logging
```

### Linux-level optimizations inside BDS containers

Increase file descriptors to 65,536 and tune UDP buffer sizes: `net.core.rmem_max=16777216`, `net.core.wmem_max=16777216`. For marginally better memory allocation, preload jemalloc: `LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2 ./bedrock_server`. If available, install **LeviOptimize** (for the LeviLamina framework) which optimizes hopper items, piston movements, and entity pushing for measurable TPS improvements.

Target **20 TPS** (ticks per second); anything below 18 indicates lag. Monitor MSPT (milliseconds per tick) — should stay below 50 ms. Under normal family-server loads (5–10 simultaneous players per world), the i7-8700B will barely notice the workload.

---

## Step-by-step implementation plan

### Phase 1: Proxmox installation (Day 1, ~3 hours)

1. Back up any data on the Mac Mini
2. Disable T2 Secure Boot and SIP via macOS Recovery
3. Flash Proxmox VE 8.x ISO to USB, boot and install
4. Install T2-patched kernel (`pve-edge-kernel-t2`)
5. Install `mbpfan`, configure aggressive fan curves
6. Verify wired Ethernet connectivity
7. Configure storage: ext4 + LVM-thin on internal NVMe
8. Install Tailscale on Proxmox host for remote admin access

### Phase 2: Core containers (Day 1, ~2 hours)

1. Create LXC container for BDS Server 1 (Ubuntu 22.04, 4 GB RAM, 3 cores)
2. Create LXC container for BDS Server 2 (same specs)
3. Create LXC container for Crafty Controller (2 GB RAM, 2 cores)
4. Create LXC container for Caddy reverse proxy (512 MB, 1 core)
5. Configure bridged networking for all containers

### Phase 3: BDS setup and world migration (Day 1–2, ~2 hours)

1. Install BDS in each container (via `itzg/docker-minecraft-bedrock-server` Docker image or native binary)
2. Start BDS once to generate directory structure, then stop
3. Export Realm world on Windows PC (Play → Realms → Edit → Backups → Download → Export)
4. Extract `.mcworld` file, transfer `db/` folder contents to BDS `worlds/<level-name>/db/`
5. Set `level-seed` and `level-name` in `server.properties`
6. Start BDS, verify world loads correctly
7. Install MCscripts for automated backups

### Phase 4: Management panel and remote access (Day 2, ~2 hours)

1. Install Crafty Controller 4 in its container
2. Configure Crafty to manage both BDS instances
3. Set up Caddy reverse proxy with HTTPS for Crafty's web UI
4. Install Playit.gg agent in each BDS container, create Bedrock tunnels
5. Set up MCXboxBroadcast standalone container for console player access
6. Test player connections from PC, mobile, and console

### Phase 5: Custom web UI (Day 3–5, ~8–16 hours of development)

1. Scaffold Next.js project with shadcn/ui and Tailwind
2. Implement NextAuth.js authentication with role-based permissions
3. Build API routes that call Crafty Controller's API (or implement direct BDS stdin/stdout wrapper)
4. Create dashboard pages: server status, player management, preset modes, backup controls
5. Deploy as Docker container, expose via Caddy reverse proxy through Tailscale

### Phase 6: Backup and monitoring (Day 2–3, ~2 hours)

1. Configure MCscripts backup timers (every 4–6 hours)
2. Set up Proxmox vzdump scheduled backups (daily at 3 AM)
3. Install rclone, configure Backblaze B2 remote, schedule daily offsite sync
4. Install Uptime Kuma for server health monitoring
5. Configure Healthchecks.io pings for backup job monitoring
6. Create backup verification cron job (archive integrity + size anomaly detection)

---

## Estimated setup difficulty and costs

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Proxmox on Mac Mini** | ⚠️ Moderate | T2 chip workarounds require careful steps |
| **BDS setup** | ✅ Easy | Docker image simplifies everything |
| **Realm world migration** | ⚠️ Moderate | DB-only copy method is reliable but non-obvious |
| **Crafty Controller** | ✅ Easy | Docker or pip install, good documentation |
| **Playit.gg** | ✅ Very Easy | 5–10 minute setup |
| **Console player workarounds** | ⚠️ Moderate | MCXboxBroadcast + BedrockConnect DNS setup |
| **Custom web UI development** | 🔴 Advanced | Requires web development skills (8–16 hours) |
| **Backup automation** | ✅ Easy | MCscripts provides turnkey systemd units |
| **Overall project** | ⚠️ Moderate–Advanced | Weekend project for technical users; custom UI is the biggest time investment |

| Ongoing Cost | Amount |
|-------------|--------|
| Playit.gg (free tier) | $0/month |
| Playit.gg (premium, optional) | $3/month |
| Backblaze B2 offsite backup | $0.04–$1.20/month |
| Custom domain (optional) | ~$10/year |
| VPS relay (optional upgrade) | $3–5/month |
| Electricity (Mac Mini idle ~10W) | ~$1–3/month |
| **Compared to: 2× Minecraft Realms** | **$15.98/month saved** |

---

## Future improvements worth considering

**Geyser+Paper as a second engine**: Once the initial Realms migration is stable on BDS, consider running a separate Geyser+Paper server for a second world that benefits from Java Edition's massive plugin ecosystem. This doesn't require migrating existing worlds — just new worlds with plugins like WorldGuard, EssentialsX, and LuckPerms.

**Endstone plugin framework**: Monitor Endstone's development — it's the most promising plugin API for BDS, offering a Bukkit-like Python/C++ experience while maintaining full vanilla compatibility. As it matures, it could eliminate BDS's biggest weakness.

**Automated world pruning**: Large worlds grow indefinitely as players explore. Tools like Amulet Editor can trim unvisited chunks to keep world sizes manageable and backups fast.

**Pelican Panel**: Pterodactyl's successor (Pelican) is in beta as of early 2026. Once stable, it offers a superior API, OAuth authentication, and a modern plugin/theme system — ideal as the backend for a custom web UI, replacing Crafty's more limited API.

**WireGuard + VPS for independence**: Playit.gg is a third-party dependency. If it goes down, players can't connect. A self-managed WireGuard tunnel to a $4/month VPS provides the same functionality with full control. This is the recommended upgrade path once the basic system is proven stable.