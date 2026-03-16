# Self-Hosted Minecraft Bedrock Platform Architecture Proposal

## 1. Overview and Goals

This document proposes a complete architecture for a self-hosted Minecraft Bedrock platform to replace Minecraft Realms for a small group of friends and family, running on a 2019 Mac Mini with 64 GB RAM under Proxmox.
It covers server engine selection, Realms world migration, management panels, custom web UI design, Proxmox layout, secure remote access, backup and performance strategy, and an implementation plan.

Primary goals:

- Replace Bedrock Realms with a reliable self-hosted setup.
- Run 1–2 Bedrock worlds with Realms worlds migrated across.
- Provide an extremely simple web UI for non-technical admins plus a full-featured admin UI for you.
- Keep the system secure, avoiding direct exposure of dangerous ports.
- Make player connection easy across Bedrock clients (PC, mobile, consoles where feasible).


## 2. Bedrock Server Engine Selection

### 2.1 Options considered

The following Bedrock server engines are commonly used:

| Engine | Type | Key traits | Plugin/addon model |
|--------|------|-----------|---------------------|
| Official Bedrock Dedicated Server (BDS) | First‑party C++ server from Mojang | Closest to Realms/vanilla, best Bedrock compatibility | Add-ons/behavior packs, not traditional plugins[^1][^2][^3] |
| PocketMine‑MP | Third‑party server written in PHP | Large plugin ecosystem, but historically incomplete vanilla parity (mobs, complex worldgen, structures) | PHP plugins[^2][^3] |
| Nukkit / Cloudburst / PowerNukkitX | Third‑party Java servers | Java-based, good plugin ecosystem and performance; not 100% protocol/feature-identical to Bedrock | Java plugin APIs via Cloudburst/PowerNukkitX[^4][^5][^6] |
| GeyserMC + Java server (e.g., Paper) | Proxy, not a Bedrock server | Lets Bedrock players join a Java server; all world data actually lives on Java | Java plugins; Bedrock-specific behavior only via Geyser/Floodgate[^7][^8][^9] |

Additional notes:

- Hosting providers recommend **Bedrock Dedicated Server (BDS)** as the default for Bedrock unless you specifically need plugins, because it preserves vanilla mechanics and full feature parity with the client.[^2][^3]
- On the official BDS, you cannot run server-side plugins; only add-ons/behavior packs are supported.[^10][^1]
- Nukkit/PowerNukkitX (Cloudburst) and related forks are positioned as plugin-friendly alternatives to vanilla BDS for custom gamemodes and economies.[^4][^5][^6]
- GeyserMC is a **proxy**: it bridges Bedrock clients to a Java server and does not host worlds itself.[^7][^8][^9]

### 2.2 Compatibility with Realms worlds

Realms worlds for Bedrock can be downloaded via the Bedrock client, which stores them as normal Bedrock worlds under the client’s `minecraftWorlds` folder on Windows 10/11.[^11][^12]
The resulting world folder (containing `db/`, `level.dat`, etc.) can be dropped directly into the `worlds` folder of a Bedrock Dedicated Server, with the server’s `level-name` pointed to that folder, and will run without conversion.[^12]

PocketMine‑MP and Nukkit/PowerNukkitX use their own world formats and lack perfect vanilla parity; moving a Realms/BDS world into them typically requires conversion or regeneration and often breaks or omits newer Bedrock features and structures.[^3][^6][^2]
GeyserMC targets Java servers and therefore requires converting or rebuilding worlds as Java worlds, not directly consuming Bedrock Realms worlds.[^8][^7]

### 2.3 Stability and performance

- **BDS** is the canonical Bedrock server and is widely used by hosts, with predictable performance characteristics and compatibility across Windows and Linux.[^13][^1]
- Bedrock BDS is significantly more memory‑efficient than Java, due to its C++ implementation and lack of JVM overhead; a 4‑player vanilla Bedrock server typically runs comfortably on about 2 GB RAM, versus 3–4 GB for Java.[^14][^15]
- Hosting guides indicate that a small vanilla Bedrock server for a handful of players can run comfortably on **2 GB RAM**, with 4–6 GB recommended for 10–20 players, scaling with add-ons and behavior packs.[^16][^17][^14]

Nukkit/PowerNukkitX are positioned as high‑performance Java-based alternatives, but they entail more moving parts (Java runtime, plugin compatibility, keeping up with Bedrock protocol changes) and are not strictly necessary for a small family server unless a large plugin ecosystem is required.[^5][^4]

### 2.4 Ease of automation and admin APIs

- BDS itself exposes control via command line and stdin/stdout, plus configuration files and JSON allowlist/permissions, but no first‑party HTTP API.[^1]
- Panels such as **Crafty Controller**, **AMP**, **Pterodactyl**, and **MCSManager** wrap BDS with web UIs, REST APIs, and scheduling/backup features, giving you automation surfaces without modifying BDS itself.[^18][^19][^20][^21]
- GeyserMC and Nukkit/PowerNukkitX can be managed similarly through third‑party panels.

### 2.5 Recommendation for engine

For a Realms replacement for friends and family with near‑vanilla mechanics, easy Realms world import, and minimal operational surprises, the recommended engine is:

- **Primary engine:** Official **Bedrock Dedicated Server (BDS)** for each world instance.
- **Optional secondary engine later:** A separate **Nukkit/PowerNukkitX** instance for special plugin‑heavy “event” or minigame worlds if you later need them.
- **Geyser+Java** is best reserved for a different project where the benefits of Java plugins outweigh the cost and complexity of converting worlds and managing Java mod/plugin compatibility.

This choice maximizes Realms‑like behavior, simplifies world migration, and keeps tuning focused on a first‑party server.


## 3. Migrating Existing Realms Worlds

### 3.1 High-level process

The safest migration path uses the Bedrock client to download the Realm world as a local world, then copies that world folder onto the BDS instance.
Hosting guides and community posts converge on the following workflow.[^22][^23][^24][^11][^12]

### 3.2 Step-by-step migration (Windows 10/11 client)

1. **Download the Realm to a local world**
   - Launch **Minecraft Bedrock** on Windows 10/11.
   - Go to **Play → Realms**.
   - Click the **pencil icon** or **settings** on the Realm.
   - Under **Game Settings**, use **“Download World”** (or **Backups → Download latest backup**) to create a local copy of the Realm as a single‑player world.[^23][^22][^11]

2. **Optionally export as `.mcworld`** (if using a game panel uploader)
   - Return to **Worlds**, click the pencil on the newly created local world.
   - Scroll down and choose **Export World**, saving a `.mcworld` file.[^22][^11]
   - Panels such as WiseHosting’s and others accept `.mcworld` uploads directly; on a self‑hosted system, you typically work with the raw world folder instead.[^24][^11]

3. **Locate the downloaded world folder on disk (Windows)**
   - Close Minecraft.
   - In File Explorer, navigate to:
     `C:\Users\<username>\AppData\Local\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\minecraftWorlds\`.[^12]
   - Each world is in a folder with a random name (e.g., `BQUAAIFxEAA=`). Open each and check `levelname.txt` to find the Realm world you just downloaded.[^12]

4. **Prepare the server-side world**
   - On your BDS host, create a folder under `./worlds/` named exactly as you want the server world name to appear.
   - Copy **all contents** of the matching client world folder (`db/`, `level.dat`, etc.) into the new folder on the server.
   - In `server.properties` on BDS, set `level-name=<exact world folder name>`; spaces are allowed and should match the folder name and `levelname.txt` content.[^12]

5. **Start the Bedrock Dedicated Server**
   - Ensure the server user has permission to read/write the world folder.
   - Start BDS; it will load the existing world data instead of generating a new world.

6. **Verify in-game**
   - Connect from a Bedrock client using the server IP and port.
   - Confirm spawn area, player inventories, and structures are present.

### 3.3 Migration to a hosting panel (if used)

If you use a generic game panel (Crafty, AMP, Pterodactyl, MCSManager) that auto-manages world paths, you typically:

- Stop the server instance.
- Use the panel’s file manager or SFTP to upload the world folder into the server’s designated world directory (often named `worlds/`, sometimes a specific `world` folder depending on template).
- Update `server.properties` and any panel‑level world name settings to point at that folder.
- Start the instance and verify.

Tutorials for commercial hosts like Apex Hosting and WiseHosting follow this same pattern for Bedrock: download Realm → export or copy folder → upload to server → set `level-name` → start.[^11][^24]

### 3.4 Version compatibility and pitfalls

Key considerations:

- **Version parity:** Ensure the BDS version roughly matches or is newer than the client/Realm version used to download the world; running an older BDS against a newer world can cause issues.
- **Add-ons/behavior packs:** If the Realm used Marketplace or custom behavior/resource packs, ensure those packs are installed on the server and referenced properly; missing packs may cause warnings or altered behavior.[^14][^13]
- **Permissions model:** BDS uses `allowlist.json` and `permissions.json` instead of `ops.json`; after migration, you must re‑configure operator and player permission levels in these files or via panel tooling.[^25][^1]
- **Backups before experiments:** Always keep the original client world folder backed up; copying worlds between engines (e.g., from Bedrock into Nukkit or Java) is lossy and experimental.


## 4. Server Management Panels

### 4.1 Candidates and capabilities

| Panel | Open source | Bedrock support | Multi-server | Roles/permissions | API | Notes |
|-------|-------------|-----------------|--------------|-------------------|-----|------|
| **Crafty Controller** | Yes | Explicit Java + Bedrock support | Yes | User roles with granular access | Yes (documented) | Minecraft-focused panel with automated backups, monitoring, web console, user roles.[^19][^26][^27] |
| **MCSManager** | Yes | Generic process manager; supports Minecraft & Steam | Yes | Granular multi-user permission system | Yes (HTTP API) | Distributed, multi-node, modern panel, more generic than Minecraft-specific.[^20][^28][^29][^30] |
| **Pterodactyl** | Yes | Supports Bedrock via “eggs” templates | Yes (Docker-based) | Per-server subusers with fine-grained permissions | Yes, full REST client API | Heavyweight hosting-grade panel; excellent API surface.[^31][^32][^21][^33] |
| **AMP (CubeCoders)** | Proprietary (paid) | Dedicated Minecraft Bedrock module | Yes | Rich role-based permission system at global and per-instance levels | Yes (web API) | Polished commercial product with strong RBAC and many integrations.[^34][^35][^36][^37] |

Crafty Controller:

- Designed specifically for Minecraft with support for both Java and Bedrock servers, automated backup scheduling, and user role management.[^26][^19]
- Provides a web console, CPU/RAM/player monitoring, and multi-server management via a simple web UI.[^19]

MCSManager:

- Open-source, distributed panel for Minecraft and Steam game servers; supports multiple physical or virtual nodes and provides a granular multi-user permission system.[^20][^28][^29]
- More generic and somewhat more complex; documentation is partly in Chinese, though newer docs have English quick-starts.

Pterodactyl:

- Open-source panel and Wings daemon, running each game server in an isolated container and exposing REST APIs.[^32][^38][^31]
- Provides per-server subusers; the API allows listing, creating, and updating subusers with granular permissions like `control.start`, `control.stop`, `file.read`, etc., suitable for delegated access.[^33][^21]
- Well-suited as a “backend” for a custom UI but heavier to install and maintain for a small single-node setup.

AMP (CubeCoders):

- Commercial panel with strong, well-documented role-based permissions; roles can be defined globally and per-instance, with controls over starting/stopping instances, scheduling tasks, and backups.[^36][^37][^39]
- Actively marketed as an all-in-one game server panel; supports a Minecraft Bedrock configuration via instance templates.[^34][^40]

### 4.2 Recommended panels for this project

For your use case (single powerful home server, small number of Bedrock worlds, need for very simple family-facing UI plus more advanced admin panel):

- **Best technical admin panel:**
  - **Crafty Controller** or **AMP**.
  - Crafty is free/open-source, Minecraft-focused, includes multi-server support, automated backups, and a modern web UI out of the box.[^27][^26][^19]
  - AMP is more polished and has extremely flexible RBAC and templating but requires a license; if you’re comfortable paying, it is an excellent single-pane-of-glass solution.[^35][^36]

- **Best backend for a simplified custom UI:**
  - **Pterodactyl** (if you want the cleanest documented REST API and Docker isolation) or **Crafty** (if you prefer less complexity and a Minecraft-centric stack).
  - Pterodactyl’s client API for subusers and server control is well documented and stable, making it straightforward to implement a thin custom frontend that only exposes safe operations.[^21]
  - Crafty 4 exposes a technical documentation and API reference specifically for scripting and automation, allowing you to integrate a custom web app while using Crafty to actually manage BDS processes.[^18]

Given you want low operational complexity and this is a small homelab deployment, a strong default choice is:

- **Run Crafty Controller as the primary management panel** on your “game VM”.
- **Build a tiny separate “family admin” web UI** that uses Crafty’s API or wrapper scripts for only the safe operations you listed.


## 5. Custom Friendly Web UI Architecture

### 5.1 Requirements recap

The friendly UI for non-technical admins should expose:

- World controls: start, stop, restart server; trigger a world backup; change difficulty; toggle whitelist.
- Player tools: whitelist/unwhitelist; kick; ban; set gamemode.
- Presets: kid-friendly mode, hard survival, build event mode, etc.

It must **never** expose dangerous capabilities such as arbitrary console access, RAM allocation, startup parameters, or file editing.

### 5.2 Recommended tech stack

Backend:

- A small **REST API service** written in a language you’re comfortable with (e.g., Node.js/TypeScript with Express, Python with FastAPI, or Go).
- Runs inside its own container or VM and talks to the game panel (Crafty or Pterodactyl) via their HTTP APIs or, alternatively, runs shell scripts that call BDS console commands.

Frontend:

- Lightweight single-page or multi-page app built with React, Svelte, or a simple server-rendered framework (e.g., Next.js/SvelteKit/Flask + HTMX) depending on your preference.
- Focus is on **large buttons**, simple language, guards against dangerous actions (confirmation dialogs), and clear status indicators.

Persistence and auth:

- An internal database (SQLite or PostgreSQL) for storing UI-only metadata such as presets, non-technical role definitions, and audit logs.
- Authentication delegating to **OIDC** (e.g., Authentik or Keycloak) or simply to the panel’s user accounts if API tokens can be tied to specific “family admin” roles.

### 5.3 Integration pattern: panel APIs vs wrapper scripts

**Panel API approach (recommended where available):**

- Use Crafty or Pterodactyl’s APIs as the source of truth for server lifecycle.
- Example operations via Pterodactyl-like APIs: start/stop/restart server, view basic stats, trigger backups, and manage subusers with limited permissions.[^19][^21]
- Your friendly UI front-end never talks directly to BDS; it only talks to your “family-api” backend, which in turn calls the panel with a service account token that only has limited permissions.

**Wrapper script approach:**

- Your backend calls local scripts (e.g., `systemd` services, `tmux` sessions, or Crafty CLI if provided) to start/stop servers and to issue commands into BDS stdin.
- It manipulates JSON files (`allowlist.json`, `permissions.json`) and `server.properties` for whitelist and difficulty changes.
- This can work but bypasses some of the safety and monitoring benefits of a mature panel.

Given your goals and that Crafty 4 exposes an API, using the **panel API as the control plane** is preferable, reducing the amount of custom low‑level logic.

### 5.4 Authentication and role permissions

Suggested auth model:

- Use a small **identity provider** (e.g., Authentik) or the panel’s built-in user management for primary authentication.
- Provide two main roles in your custom UI:
  - **Owner/Technical Admin:** full access via Crafty/AMP/Pterodactyl native UI; can also see the “family UI” if desired.
  - **Family Admin:** access only to the custom friendly UI, which exposes a strictly limited subset of functionality; their accounts do not have direct credentials for the management panel.

If using Pterodactyl, you can map each family admin to a **subuser** for a given server with only `control.start`, `control.stop`, `control.restart`, `backup.create`, and similar permissions and keep file and console access disabled.[^33][^21]
If using Crafty, create roles in Crafty with restricted permissions and then map your UI’s actions to those roles via API calls, while hiding everything else in your UI.[^18]

### 5.5 UI design best practices

- **Use domain language, not technical:** “Kid Friendly Mode” instead of “Difficulty: Peaceful + KeepInventory.”
- **Large, obvious buttons** for primary actions: Start, Stop, Restart, Backup.
- **Stateful indicators**: show “Online / Offline / Starting / Backing up…” with colors and plain-language messages.
- **Guard rails:** confirmations on destructive actions (Stop/Restart/Kick/Ban), with short explanations.
- **Presets abstraction:** map named presets to underlying server settings:
  - Kid Friendly Mode: `difficulty=peaceful`, `pvp=false`, `keepInventory=true`, maybe whitelist on.
  - Hard Survival: `difficulty=hard`, `pvp=true`, no cheats.
  - Event Mode: peaceful or easy, world backup triggered automatically before enabling, etc.


## 6. Hosting Architecture on Proxmox

### 6.1 VM vs LXC for Minecraft and panel

For Proxmox, you can host services either in full virtual machines (VMs) or in LXC containers.

General trade-offs:

- **LXC containers** share the Proxmox host kernel, giving lower overhead, faster startup, and higher density but less isolation and some sensitivity to host kernel changes.[^41][^42]
- **VMs** run their own OS and kernel, offering stronger isolation, more predictable behavior across Proxmox upgrades, and better compatibility with software that expects a full OS.[^43][^42][^41]

Community practice often runs application stacks (Minecraft servers, Docker, etc.) in VMs to avoid container‑kernel quirks, while using LXC for lighter tooling such as monitoring and backup services.[^42][^41]
Some users successfully run Bedrock servers inside Proxmox LXC containers with Docker and port mapping, but this requires more tuning and can be more fragile on kernel upgrades.[^44]

Given your Mac Mini has ample RAM and CPU but you prioritize reliability over absolute density, a simple, robust design is:

- **VMs for the Minecraft panel and BDS instances**.
- **LXCs for monitoring/backup utilities** that can be easily rebuilt if needed.

### 6.2 Proposed Proxmox layout

**Physical host:** Mac Mini 2019, Proxmox VE, ZFS or ext4 storage pool.

**Virtual machines:**

1. **VM: `infra-edge`** (Ubuntu Server)
   - Services:
     - Reverse proxy (e.g., Caddy or Nginx) terminating HTTPS for the panel and custom UI.
     - Tailscale client for secure admin VPN access.
     - Optional: Cloudflare Tunnel for exposing web UIs without opening ports.
   - Resources: 2 vCPU, 2–4 GB RAM (very modest load).

2. **VM: `mc-node-1`** (Ubuntu Server)
   - Services:
     - Crafty Controller (or AMP/Pterodactyl) panel.
     - 1–2 BDS instances (each as separate “servers” managed by the panel).
   - Resources: 4–6 vCPU, 8–12 GB RAM to start; see performance section below.

3. **(Optional) VM: `family-ui`** (if you want complete separation)
   - Services:
     - Custom friendly admin web app + API.
   - Alternatively, host this alongside `infra-edge`.

**LXC containers:**

- `monitoring`: Prometheus + Grafana or a lightweight monitoring stack for CPU/RAM/disk/players metrics.
- `backups`: rclone or restic for offsite sync, plus cron jobs for pushing world backups to cloud storage.

### 6.3 High-level architecture diagram

```mermaid
graph TD
  Internet((Internet))
  subgraph RemotePlayers[Remote Players]
    PC[PC Bedrock Clients]
    Mobile[Mobile Bedrock]
    Console[Console Bedrock]
  end

  Internet -->|UDP 19132 via Playit.gg or direct| EdgeIP[Public Endpoint]

  subgraph ProxmoxHost[Mac Mini / Proxmox]
    subgraph VM1[VM: infra-edge]
      RP[HTTPS Reverse Proxy]
      TS[Tailscale Client]
      CF[Cloudflare Tunnel (Web only)]
    end

    subgraph VM2[VM: mc-node-1]
      Crafty[Crafty / AMP / Pterodactyl]
      BDS1[Bedrock Server 1]
      BDS2[Bedrock Server 2]
    end

    subgraph LXC[Monitoring & Backups]
      Mon[Monitoring]
      Bkp[Backup/Snapshot Jobs]
    end
  end

  EdgeIP --> BDS1
  EdgeIP --> BDS2

  PC --> Internet
  Mobile --> Internet
  Console --> Internet

  AdminPC[Your Admin Devices] -->|Tailscale| TS
  AdminPC -->|HTTPS via Tunnel/DNS| RP

  RP --> Crafty
  RP --> FamilyUI[Custom Family UI]
  FamilyUI --> Crafty
```


## 7. Secure Remote Access

### 7.1 Goals and constraints

- Avoid exposing SSH or admin web UIs directly to the internet.
- Avoid router port forwarding where possible, especially for management traffic.
- Still allow easy player access from Bedrock clients.

### 7.2 Tools

- **Tailscale:** Mesh VPN built on WireGuard, providing a private IP for each device and end-to-end encrypted connections; ideal for secure admin access to Proxmox, SSH, and panels.[^45][^46][^47]
- **Cloudflare Tunnel:** Outbound-only connector (`cloudflared`) that exposes web services (HTTPS) via Cloudflare’s edge without opening inbound ports; traffic is proxied through Cloudflare, which terminates TLS and can apply access controls.[^46][^48][^45]
- **Playit.gg:** Reverse-proxy tunneling solution designed for game servers (including Minecraft Bedrock), allowing you to expose a Bedrock UDP port via a public hostname without port forwarding.[^49][^50][^51][^52]
- **WireGuard (self-hosted):** Traditional VPN requiring port forwarding and more manual management.
- **TCPShield:** Primarily targeted at Java servers for DDoS protection and reverse proxying; less critical for a small family Bedrock server.

### 7.3 Recommended security architecture

Admin access:

- Install **Tailscale** on `infra-edge`, `mc-node-1`, and your admin devices.
- Use Tailscale to access Proxmox web UI, SSH, Crafty/AMP/Pterodactyl admin panels, and monitoring dashboards via their **Tailscale IPs**, eliminating the need for public-facing management ports.[^47][^45]

Family-friendly web access:

- Run your **custom friendly UI** (and optionally the Crafty UI) behind **Cloudflare Tunnel** or Tailscale’s Funnel, using HTTPS with a nice domain, but **locked down via Cloudflare Access** or equivalent SSO.
- This keeps the management surfaces behind strong authentication even if reachable over the public internet.[^48][^45][^46]

Player access:

- Expose the Bedrock game port (default UDP 19132) via:
  - **Playit.gg**: recommended if you want to avoid router configuration entirely; the Playit agent runs on `mc-node-1` and creates a Bedrock tunnel you can share as a hostname and port.[^50][^51][^52][^49]
  - Or **traditional port forwarding** from your stepfather’s router to `mc-node-1` if you are comfortable managing it.
- Keep the Distinction: management is only via Tailscale, while game traffic flows via Playit.gg or a single forwarded UDP port.


## 8. Player Connection Experience

### 8.1 PC and mobile Bedrock clients

On Windows 10/11, Android, and iOS Bedrock clients, adding a custom server is straightforward:

- Players add a server in the **Servers** tab by specifying a hostname and port.
- With Playit.gg, they will see a hostname and port you can copy from the Playit dashboard, mapped to your internal BDS port.[^52][^49][^50]

You can optionally point a custom DNS name (e.g., `familycraft.example.com`) at the Playit endpoint if they support CNAMEs, or at your static IP if using direct port forwarding.

### 8.2 Console limitations

On consoles (Xbox, PlayStation, Nintendo Switch), Bedrock Edition currently **does not allow players to freely add arbitrary custom servers in the base UI**; players are limited to a set of featured servers and Realms.[^53][^54][^55]
Community workarounds include:

- **Server hubs and DNS tricks** such as OniionCraft or BedrockConnect, where players join a special hub server listed under “Servers” that then lets them route to arbitrary IPs from within Minecraft.[^56][^9][^57][^58]
- Changing console DNS settings to point at a BedrockConnect instance, which injects a custom server list, but this is more technical and not officially supported.[^54][^56]

Therefore:

- Your self-hosted Bedrock server **cannot appear like a Realm** in console menus.
- Console players will either:
  - Use a server hub (such as OniionCraft Bedrock Server Hub) that can route them to your server’s IP and port.[^57]
  - Or play via PC/mobile for a smoother custom-server experience.

### 8.3 Summary of player join paths

- **PC/Mobile:** Add custom server → Hostname (Playit or direct) + port → Join.
- **Consoles:** Use a server hub or DNS trick to get access to arbitrary servers; join from the in-game hub UI.
- **No Realms-equivalent listing:** There is no way to make your server show up in the Realms list; that is controlled by Microsoft and requires their Realms infrastructure.


## 9. Backup and Recovery System

### 9.1 Goals

- Automatic daily world backups with minimal downtime.
- Easy one-click or scripted restore.
- Offsite backups (cloud storage) where possible.
- Snapshots before server updates or configuration changes.

### 9.2 Backup layers

1. **Application-level backups (Crafty/Panel):**
   - Crafty Controller offers automated backup scheduling with retention policies; it can compress server directories (including worlds) on a schedule.[^26][^19]
   - These backups can be stored in a dedicated dataset or directory, then further synced offsite.

2. **Filesystem/VM snapshots (Proxmox):**
   - Use Proxmox snapshots (especially if using ZFS) to snapshot the `mc-node-1` VM before major updates, panel upgrades, or big config changes.
   - This gives you full-system rollback capability.

3. **Offsite backups:**
   - In an `LXC` backup container, run `restic` or `rclone` to sync compressed world backups to a cloud provider (e.g., Backblaze B2, Wasabi, or S3-compatible storage).

### 9.3 Safe world backup procedure

For BDS specifically, to avoid world corruption, you should either rely on the panel’s integrated backup (which issues proper commands) or ensure the following in custom scripts:

1. Instruct BDS to **flush world data**:
   - Send `save hold` and then `save query` to ensure all pending chunks are written (or use whatever precise sequence the latest BDS expects).
2. Copy the world folder (`worlds/<name>`) to a timestamped backup location.
3. Resume normal saves with `save resume`.
4. Compress (e.g., `tar.gz`) the copied folder asynchronously.

Crafty’s automated backups abstract this away and are simpler to rely on, but you can add custom pre/post hooks if you want additional logic.[^26][^19]

### 9.4 Recovery procedure

- **Per-world restore:**
  - Stop the target BDS instance.
  - Move the existing world folder aside (archive or delete after verifying backup).
  - Extract the desired backup archive into the `worlds/` directory with the same folder name.
  - Start the server and verify the world.

- **Full VM restore:**
  - If a major issue arises (e.g., OS corruption, panel misconfiguration), revert the `mc-node-1` VM from a Proxmox snapshot or restore from a Proxmox backup.


## 10. Performance Considerations

### 10.1 Hardware capabilities vs Bedrock requirements

Your Mac Mini 2019 with 64 GB RAM has significantly more resources than a typical small Bedrock server host, which often runs with 2–6 GB RAM and a modest CPU for 4–20 players.[^17][^16][^14]
Guides indicate:

- A **4-player vanilla Bedrock server** is comfortable at **2 GB RAM**, with add-ons pushing this to 3–4 GB.[^14]
- Small Bedrock servers (10–20 players) typically allocate 4–6 GB RAM.[^17][^14]
- Community experiences report acceptable performance for small Bedrock SMPs around 2–3 GB RAM, scaling with player count and world size.[^59][^60]

Given this, even with two Bedrock worlds and a management panel, allocating **8–12 GB RAM** to `mc-node-1` provides generous headroom.

### 10.2 Recommended allocations

- **VM `mc-node-1`:** 4–6 vCPU, 8–12 GB RAM.
- **Per BDS instance:**
  - Limit via panel or cgroup if desired to about 2–4 GB RAM per world depending on player count and add-ons.
- **Storage:**
  - Use SSD/NVMe-backed storage for worlds to minimize chunk load latency.

### 10.3 Tuning Bedrock servers

Key knobs to consider in `server.properties` and BDS config:

- Simulation distance and view distance: lower values reduce CPU load and chunk generation pressure, especially if players explore widely.[^61][^13]
- Tick rate and mob spawning: extremely entity-heavy farms or high simulation distances can increase CPU usage.
- Pre-generating regions: for large event worlds, pre-generating common play areas can reduce lag spikes from initial chunk generation.[^13]

For a small family server, defaults plus modestly reduced simulation distance are usually sufficient.


## 11. End-to-End Recommended Architecture

### 11.1 Software stack summary

- **Host:** Proxmox VE on Mac Mini 2019.
- **Game VM:** Ubuntu Server `mc-node-1`.
  - Bedrock Dedicated Server (BDS) instances (1–2 worlds).
  - Crafty Controller (or AMP/Pterodactyl) for control and monitoring.
- **Edge VM:** Ubuntu Server `infra-edge`.
  - Reverse proxy (Caddy/Nginx).
  - Tailscale client.
  - Cloudflare Tunnel daemon (`cloudflared`) for external HTTPS to friendly admin UI.
- **Optionally:** separate `family-ui` VM/container hosting the custom friendly UI.
- **LXC containers:** monitoring stack and backup/offsite sync utilities.
- **Tunneling:** Playit.gg agent on `mc-node-1` exposing a Bedrock endpoint for players.

### 11.2 Security architecture overview

- No direct SSH or admin panels exposed to the public internet.
- Admin access via Tailscale only (SSH, Proxmox, Crafty/AMP/Pterodactyl).
- Family-friendly UI optionally exposed via Cloudflare Tunnel with Cloudflare Access (SSO/2FA).
- Game traffic exposed via a single Playit.gg tunnel or a carefully forwarded UDP port.


## 12. Step-by-Step Implementation Plan

1. **Prepare Proxmox host**
   - Install Proxmox VE on the Mac Mini and configure storage (preferably ZFS).
   - Create a backup schedule for Proxmox itself.

2. **Create core VMs**
   - VM `infra-edge` (Ubuntu): install Tailscale, Nginx/Caddy, optional Cloudflare Tunnel.
   - VM `mc-node-1` (Ubuntu): allocate 4–6 vCPU, 8–12 GB RAM, SSD-backed disk.

3. **Install Tailscale and join tailnet**
   - On Proxmox host, `infra-edge`, `mc-node-1`, and your admin devices, install Tailscale and authenticate to your tailnet.[^45][^47]
   - Verify you can SSH and access Proxmox and `mc-node-1` via Tailscale IPs.

4. **Deploy Crafty Controller (or AMP/Pterodactyl) on `mc-node-1`**
   - Follow Crafty installation docs or a Docker Compose recipe; confirm web UI reachable via Tailscale/Reverse proxy.[^19][^26]
   - Create two BDS server instances (e.g., `family-survival`, `kids-world`) using Crafty’s “add server” workflows.

5. **Install Playit.gg agent on `mc-node-1`**
   - Install the Playit agent and create a Bedrock tunnel mapping the Playit hostname/port to your BDS port (19132 or another).[^51][^49][^50][^52]
   - Test connecting from a PC Bedrock client using the Playit address.

6. **Migrate Realms worlds**
   - On a Windows 10/11 machine, download each Realm world as a local world via the Bedrock client.[^23][^22][^11]
   - Locate the world under `minecraftWorlds` and copy its contents to the appropriate world folder for each BDS instance on `mc-node-1`.
   - Update `server.properties` `level-name` and start each BDS instance.[^12]
   - Verify in-game that the worlds look correct.

7. **Configure backups and monitoring**
   - In Crafty, configure scheduled backups for each server with a sensible retention policy.[^26][^19]
   - Set up an LXC container with restic/rclone to push backup archives to a cloud storage bucket.
   - Optionally install monitoring (Prometheus/Grafana) to log CPU/RAM/player counts over time.

8. **Build and deploy the custom friendly UI**
   - Implement a small backend that talks to the Crafty (or Pterodactyl) API using a service account with limited permissions.[^21][^18]
   - Implement frontend pages for:
     - Server status and power controls.
     - Player management (whitelist, kick, ban, gamemode) via safe APIs.
     - Preset selector for kid-friendly, hard survival, and event modes.
   - Host the friendly UI on `family-ui` or inside `infra-edge`, fronted by Nginx/Caddy.
   - Secure access via Cloudflare Access or Tailscale auth.

9. **Finalize player onboarding**
   - Document for your group how to join:
     - For PC/mobile: add a custom server with the Playit hostname and port.
     - For consoles: join via a hub server (e.g., OniionCraft/BedrockConnect) if desired, or use PC/mobile instead.[^58][^56][^57]

10. **Test failure scenarios**
    - Test restoring a world from backup.
    - Test Proxmox VM snapshot rollback.
    - Test revoking access to the friendly UI and ensuring Tailscale ACLs are correct.


## 13. Estimated Setup Difficulty and Future Improvements

### 13.1 Difficulty

- **Proxmox and VM setup:** Moderate if you are already comfortable with virtualization; plenty of tutorials exist for Minecraft on Proxmox and for BDS on Ubuntu.[^62][^44]
- **Crafty/AMP/Pterodactyl installation:** Moderate; scripted installers and Docker recipes are available, but SSL and reverse proxy configuration require some Linux familiarity.[^32][^35][^19]
- **Tailscale and Playit:** Relatively easy; both provide step-by-step guides for basic setups.[^46][^49][^51][^45]
- **Custom UI development:** Depends on your web dev experience; the scope can be kept small by focusing on the named feature set and reusing a simple web framework.

Overall, this architecture is well within reach for a homelab user with moderate Linux and networking experience.

### 13.2 Future improvements

- Introduce a **Nukkit/PowerNukkitX** instance for plugin-rich event servers while keeping main survival worlds on BDS.[^6][^4][^5]
- Add **GeyserMC + Java server** in parallel if you later want Java plugins while letting Bedrock players join, treating it as a separate realm of play.[^9][^7][^8]
- Enhance observability with Discord webhooks or a small status dashboard showing which worlds are online and how many players are connected.
- Automate more via the panel APIs: scheduled “kid mode” windows, pre‑event snapshots, or one-click world cloning for experiments.

---

## References

1. [Bedrock Dedicated Server - Minecraft Wiki - Fandom](https://minecraft.fandom.com/wiki/Bedrock_Dedicated_Server) - Bedrock Dedicated Servers allow Minecraft players on Windows and Linux computers to set up their own...

2. [Minecraft Bedrock Server Types](https://shockbyte.com/help/knowledgebase/articles/minecraft-bedrock-server-types)

3. [Minecraft Bedrock Server Types](https://shockbyte.com/billing/knowledgebase/31/Minecraft-Bedrock-Server-Types.html) - The Shockbyte Knowledgebase contains hundreds of tutorials for managing your game servers for Minecr...

4. [How to Install Nukkit and Add Plugins - Sparked Host Knowledge Base](https://help.sparkedhost.com/en/article/how-to-install-nukkit-and-add-plugins-1883vid/) - Nukkit is an open-source server software designed for hosting Minecraft: Bedrock Edition servers. It...

5. [Adding Plugins to Your Minecraft: Bedrock Edition Server - Nodecraft](https://nodecraft.com/support/games/minecraft-bedrock/adding-plugins-to-your-minecraft-bedrock-edition-server) - This article will guide you through the process of how to install plugins to your Minecraft: Bedrock...

6. [Bedrock Server Software](https://wiki.bedrock.dev/servers/server-software) - A High-level Plugin API for Modding Bedrock Dedicated Servers, in both Python and C++. ... Support f...

7. [Configuring GeyserMC to Allow Bedrock Clients to Connect to Java ...](https://shockbyte.com/tr/help/knowledgebase/articles/configuring-geysermc-to-allow-bedrock-clients-to-connect-to-java-servers) - GeyserMC is a proxy for Minecraft that allows Bedrock edition players to join Java/PC edition server...

8. [How to configure GeyserMC to allow Bedrock Clients to join Java ...](https://mintservers.com/knowledgebase/how-to-configure-geysermc-to-allow-bedrock-clients-to-join-java-servers) - GeyserMC is a powerful bridge that allows Minecraft Bedrock Edition players (Windows 10/11, mobile, ...

9. [GeyserMC Floodgate - Java Bedrock Crossplay 2025 - MineStrator](https://minestrator.com/en/blog/article/install-geysermc-floodgate-java-bedrock-crossplay-2025) - GeyserMC is a proxy that lets Bedrock Edition players (consoles, mobile, Windows 10) join a Java Edi...

10. [Bedrock server plugins without loader? : r/MinecraftServer - Reddit](https://www.reddit.com/r/MinecraftServer/comments/1q64sqe/bedrock_server_plugins_without_loader/) - You can not have plugins on a bedrock dedicated server only add-ons, there is a software called nukk...

11. [How To Upload Your Minecraft Bedrock Realms World ...](https://help.wisehosting.com/en/articles/138-how-to-upload-your-minecraft-bedrock-realms-world-to-your-server)

12. [Using a saved Realm world on a Bedrock Dedicated Server](https://www.reddit.com/r/MCPE/comments/aqlld1/using_a_saved_realm_world_on_a_bedrock_dedicated/)

13. [Minecraft Bedrock Server Hosting | OVHcloud Worldwide](https://www.ovhcloud.com/en/bare-metal/game/minecraft-bedrock-server/) - Rent a Minecraft Bedrock Server to create and host your own gaming world. Play Minecraft with a fast...

14. [Bedrock Vs Java -- Ram...](https://gbnodes.host/blogs/minecraft-bedrock-dedicated-server-ram-4-players-2026/) - A vanilla Minecraft Bedrock dedicated server for 4 players needs 2 GB of RAM — but behaviour packs a...

15. [Minecraft Server RAM Guide: How Much Memory Do You Really ...](https://gameteam.io/blog/minecraft-server-ram-guide/) - Learn exactly how much RAM your Minecraft server needs. Complete guide covering vanilla, modded, and...

16. [Is 2 GB RAM Enough for Minecraft Server - GameTeam - Bloggameteam.io › blog › is-2-gb-ram-enough-for-minecraft-server](https://gameteam.io/blog/is-2-gb-ram-enough-for-minecraft-server/) - Two gigabytes of RAM will run a basic Minecraft server, but whether it’s “enough” depends entirely o...

17. [Minecraft Bedrock (Pocket Edition) Server Hosting](https://scalacube.com/hosting/server/minecraft-pe) - Affordable Minecraft Bedrock hosting! Easily create your own Pocket Edition server. Get started and ...

18. [User/Role Configuration - Crafty Documentation](https://docs.craftycontrol.com/pages/user-guide/user-role-config/) - Crafty 4's Technical Documentation & API Reference

19. [Crafty Controller Minecraft Manager - Docker Compose Recipe](https://docker.recipes/homelab/crafty-controller) - Web-based Minecraft server management with multiple server support and monitoring.

20. [MCSManager/README.md at master · MCSManager/MCSManager](https://github.com/MCSManager/MCSManager/blob/master/README.md) - Quick deployment, distributed, multi-user, modern management panel for Minecraft and Steam game serv...

21. [User Management | NETVPX Pterodactyl API Documentation](https://pterodactyl-api-docs.netvpx.com/docs/v0.7/client/users) - Manage server subusers and their permissions.

22. [How To Upload Your Minecraft Bedrock Realms World to Your Server](https://www.youtube.com/watch?v=SkM3v7PZWBw) - How To Upload Your Minecraft Bedrock Realms World to Your Minecraft Server On WiseHosting - https://...

23. [How to upload local / realms world to Minecraft Bedrock server & vise versa](https://www.youtube.com/watch?v=pzmlFsMNh8E) - Do you want to play your local world, realms world on your Minecraft bedrock server? Even back up yo...

24. [How to Add a World to Your Minecraft Bedrock Edition Server (Full Guide)](https://www.youtube.com/watch?v=aBn2syT-WNg) - Want to upload a custom world to your Minecraft Bedrock server? Learn how to add single-player world...

25. [How to Setup OP (admin) on Your Minecraft: Bedrock Edition Server](https://nodecraft.com/support/games/minecraft-bedrock/how-to-setup-op-admin-in-your-minecraft-bedrock-edition-server) - Learn how to setup OP (admin) on your Minecraft Bedrock server. Our guide covers enabling cheats, us...

26. [Crafty Control for Minecraft Bedrock](https://www.youtube.com/watch?v=EbYBwxxORd0) - ————————————————————————————
Chapters
0:00 intro
0:03 Download Crafty Control
0:27 Download Bedrock ...

27. [Game Changer: Free Minecraft Server Setup with Crafty Controller](https://www.youtube.com/watch?v=Xqsc9sNTq0I) - Crafty is a Minecraft Server Wrapper / Controller / Launcher. The purpose of Crafty is to launch a M...

28. [MCSManager: Quick start](https://docs.mcsmanager.com) - MCSManager Document

29. [Build software better, together](https://github.com/MCSManager/MCSManager/pkgs/container/mcsmanager-daemon) - GitHub is where people build software. More than 150 million people use GitHub to discover, fork, an...

30. [MCSManager: Free, Secure, Distributed, Modern Control Panel for Minecraft and Steam Game](https://alternativeto.net/software/mcsmanager/about/) - Free, Secure, Distributed, Modern Control Panel for Minecraft and Steam Game Servers.

31. [Updating the Panel | Pterodactyl](https://pterodactyl.io/panel/1.0/updating.html) - Pterodactyl is an open-source game server management panel built with PHP, React, and Go. Designed w...

32. [How To Easily Install Pterodactyl Panel And Wings](https://www.youtube.com/watch?v=myqd7G_Dm9o) - In this video, we’ll show you how to install the Pterodactyl panel on your server using a simple one...

33. [How to Create Sub-users in Pterodactyl: A Comprehensive Guide for Beginners](https://lazerhosting.com/billing/knowledgebase/5/How-to-Create-Sub-users-in-Pterodactyl-A-Comprehensive-Guide-for-Beginners.html?language=english) - At Lazer Hosting, we know how vital it is for our clients to ensure smooth management of their serve...

34. [Configuration with Minecraft - Configuring Bedrock on Hostsinger](https://discourse.cubecoders.com/t/configuration-with-minecraft-configuring-bedrock-on-hostsinger/15833) - Am I looking at Instance Deployment > Instance Management > Configuration Repositories? Only one lis...

35. [How I easily made my own GAME SERVER using AMP! - TechteamGB](https://www.youtube.com/watch?v=xhVs-bDIDc4) - SPONSORED BY CubeCoders Check out AMP here: https://cubecoders.com/AMP AMP is an excellent one-stop-...

36. [Managing user permissions in AMP - How To](https://discourse.cubecoders.com/t/managing-user-permissions-in-amp/2301) - This page was contributed by a member of the AMP community Overview AMP has a well-developed permiss...

37. [Managing user permissions in AMP](https://github.com/CubeCoders/AMP/wiki/Managing-user-permissions-in-AMP) - Issue tracking and documentation for AMP. Contribute to CubeCoders/AMP development by creating an ac...

38. [How to Install Pterodactyl Wings | Complete Step-by-Step Guide (2025)](https://www.youtube.com/watch?v=rEIeHomPLcE) - Learn how to install Pterodactyl Wings on your server in this detailed, step-by-step tutorial. Ptero...

39. [Does anyone have a link to detailed documentation for User Management? Bonus points what's the best way to expose User Management ports safely?](https://www.reddit.com/r/Amp/comments/1iz3ujy/does_anyone_have_a_link_to_detailed_documentation/) - Does anyone have a link to detailed documentation for User Management? Bonus points what's the best ...

40. [Set Up AMP and Take Total Control of Your Game Servers - YouTube](https://www.youtube.com/watch?v=M6vJryMvqkY) - In this video, I'll walk you through how to set up CubeCoders AMP so you can easily manage your game...

41. [Proxmox LXC vs VM: A Comprehensive Comparison Guide](https://readyspace.com/proxmox-lxc-vs-vm/) - Explore Proxmox LXC vs VM in our comprehensive guide. Understand the pros, cons, and ideal usage sce...

42. [(Proxmox) How to decide when to use an LXC container vs a VM?](https://www.reddit.com/r/selfhosted/comments/16e442w/proxmox_how_to_decide_when_to_use_an_lxc/)

43. [Deciding Between LXC and VM for Hosting Network Services on Proxmox](https://www.reddit.com/r/Proxmox/comments/1pei32f/deciding_between_lxc_and_vm_for_hosting_network/) - Deciding Between LXC and VM for Hosting Network Services on Proxmox

44. [Proxmox VM / Ubuntu 22.04.3 / Minecraft Bedrock Dedicated Server 1.20.51](https://www.reddit.com/r/Proxmox/comments/19c8hss/proxmox_vm_ubuntu_22043_minecraft_bedrock/)

45. [Cloudflare vs. Tailscale | Compare Access and Gateway to Tailscale](https://tailscale.com/compare/cloudflare-access) - Compare Cloudflare vs Tailscale to find which VPN alternative is best for your security, IdP, and ex...

46. [Deep Dive: Comparing Key...](https://dev.to/mechcloud_academy/cloudflare-tunnel-vs-ngrok-vs-tailscale-choosing-the-right-secure-tunneling-solution-4inm) - In today's interconnected world, the need to securely expose local services to the internet has...

47. [OpenVPN vs. Cloudflare | A Comparison to Tailscale for Developers](https://tailscale.com/learn/openvpn-vs-cloudflare-developer-friendly-networking) - Compare OpenVPN and Cloudflare WARP to Tailscale. See which VPN alternative provides developers with...

48. [tailscale vs cloudflare tunnel? which is better a homelab](https://programming.dev/comment/4614701) - Hello I’ve been using cloudflare to get remote access for the couple apps I selfhost, but lately I’v...

49. [Host a Minecraft Server Without Port Forwarding Using Playit.gg](https://www.youtube.com/watch?v=itVVhcid2_Q) - ... Minecraft Content about Minecraft Plugins & Mods. Plugin & Mod Tutorials / Showcases / Reviews f...

50. [Make a public bedrock server without port forwarding - YouTube](https://www.youtube.com/watch?v=trGZLf3bsDg) - We use https://playit.gg to make our server public! You can download the official bedrock server her...

51. [How To Make Your Minecraft Server Public Without Port Forwarding!](https://www.youtube.com/watch?v=cg0-fnBQA7s) - Want your friends to join your Minecraft Java server but confused by port forwarding? This tutorial ...

52. [Expose Any Game Server to the Internet Without Port Forwarding ...](https://www.youtube.com/watch?v=-Yg3aJW3QvY) - ... tunnel 3:24 If playit and the game server are on different computers 3 ... Host a Minecraft Serv...

53. [TIL that Minecraft Bedrock Edition on consoles doesn't let you add ...](https://www.reddit.com/r/Minecraft/comments/1hdhz7k/til_that_minecraft_bedrock_edition_on_consoles/) - You can get a app on your phone that let's you connect console users to your custom Bedrock server. ...

54. [Let's Talk About Custom Server Access in Bedrock Edition!](https://feedback.minecraft.net/hc/en-us/community/posts/30645407467917-Let-s-Talk-About-Custom-Server-Access-in-Bedrock-Edition) - I'd like to share the idea of the ability for players on the Nintendo Switch, Xbox or versions of Mi...

55. [Join External Minecraft Servers On Bedrock for Console (PlayStation ...](https://www.youtube.com/watch?v=AoLPhKW2Xis) - ... Servers On Bedrock for Console (PlayStation, Xbox, Switch). In ... How To Join Custom Servers in...

56. [How to connect to Java + different bedrock servers? : r/GeyserMC](https://www.reddit.com/r/GeyserMC/comments/tbuiou/how_to_connect_to_java_different_bedrock_servers/) - Join this IP through the MC server connector and then select the custom server option and add a serv...

57. [How to Join Any Minecraft Server on Console Using the OniionCraft ...](https://oniioncraft.com/how-to-join-any-minecraft-server-on-console-using-the-oniioncraft-bedrock-server-hub-xbox-playstation-and-switch-copy) - Console players have always had one major limitation in Minecraft Bedrock Edition: you can't manuall...

58. [How to join CUSTOM SERVERS on ANY CONSOLE - YouTube](https://www.youtube.com/watch?v=_lP7PnpbqvY) - ... custom servers on any console, including: Xbox, PlayStation and Nintendo Switch ... CONSOLE - Sw...

59. [How much RAM is needed for a bedrock minecraft server?](https://www.reddit.com/r/Minecraft/comments/nbh9ru/how_much_ram_is_needed_for_a_bedrock_minecraft/)

60. [Bedrock dedicated server](https://www.reddit.com/r/realms/comments/miu0k5/bedrock_dedicated_server/) - Bedrock dedicated server

61. [Minecraft Bedrock Server Hosting | OVHcloud India](https://www.ovhcloud.com/en-in/bare-metal/game/minecraft-bedrock-server/) - Rent a Minecraft Bedrock Server to create and host your own gaming world. Play Minecraft with a fast...

62. [Proxmox | Teil 2 -So erstelltst du deinen Eigenen Minecraft Server auf Proxmox ! - Bedrock + Java](https://www.youtube.com/watch?v=oSPehF7v9mE) - In diesem Video erkläre ich dir, wie du innerhalb 30 Minuten deinen eigenen Minecraft Bedrock oder J...

