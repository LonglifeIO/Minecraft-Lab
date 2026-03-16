# Self-Hosted Minecraft Bedrock Server Platform

## 1. Bedrock Server Software Options
We compared all major Bedrock engines:

- **Official Bedrock Dedicated Server (BDS):** 100% vanilla-compatible (same world format as Realms) but closed-source. It offers stable vanilla play but **no built-in RCON or plugin API**, and is known to perform poorly under heavy entity loads【112†L780-L785】.  It can run only one world per instance, and migrating worlds is straightforward. However, Mojang support may wane, and advanced features require external tools (e.g. BDSX or LiteLoaderBDS). 

- **PocketMine-MP:** A PHP-based custom server (Bedrock API) with a rich plugin ecosystem. **Highly customizable** (many plugins on Poggit), multi-world support, and low baseline resource use. **Downside:** It is *not* fully vanilla – many features (e.g. full redstone mechanics, mob AI, world gen) are missing【116†L7-L10】. This means Realms worlds may not behave correctly without plugins. It can use RCON via plugins, but requires world conversion (PocketMine uses NBT regions, not LevelDB). PocketMine is best for mini-games or modded gameplay, but is *poorly suited to pure survival play*【116†L7-L10】.

- **Nukkit (Java, Bedrock Edition):** A Java-based Bedrock server originally by CloudburstNukkit. It **supports LevelDB worlds** and closely matches vanilla behavior【113†L105-L108】. It offers a plugin API (Java plugins) and multi-world support. Performance is generally good: it was *“designed to be fast, stable, and plugin-friendly”*【113†L105-L108】. The actively developed forks **Cloudburst Nukkit** and **PowerNukkitX** add modern blocks/items and performance enhancements【117†L312-L320】. They also include features like RCON (in NukkitX) and better entity handling. Cloudburst is under active development with high vanilla compatibility【117†L312-L320】. Overall, Nukkit/PowerNukkit provide near-vanilla Bedrock support with a robust plugin ecosystem, making them very strong candidates.

- **Geyser Proxy + Java Server:** Not a Bedrock engine per se, but a bridge. Geyser acts as a proxy so Bedrock clients can join a Java server (e.g. Paper). This gives access to the Java ecosystem. **Note:** Realms worlds (Bedrock format) would require a world converter to Java (complex), so this approach adds conversion steps and complexity. If cross-play with Java players were needed, it could be considered, but for pure Bedrock hosting it is optional.

| **Software**          | **Engine** | **Vanilla Support**                        | **Plugin API**               | **Notes**                                               |
|-----------------------|------------|---------------------------------------------|------------------------------|---------------------------------------------------------|
| Official BDS (vanilla)| C++        | Full (official format)                     | Very limited (add-ons only)  | Stable vanilla, single-world, no RCON/API【112†L780-L785】. |
| PocketMine-MP         | PHP        | Incomplete (no redstone/mobs)【116†L7-L10】 | Extensive (PHP plugins)      | Customizable but missing many vanilla features.          |
| Nukkit (Cloudburst)   | Java       | High (LevelDB worlds supported)            | Extensive (Java plugins)     | Fast/stable and plugin-friendly【113†L105-L108】【117†L312-L320】.  |
| PowerNukkitX (fork)   | Java       | Very high (latest blocks/items)            | Extensive (Java plugins)     | Adds new MCPE features (waterlogging, offhand, etc)【117†L312-L320】. |
| Geyser + Java server  | Java/C#    | Converts Bedrock to Java on the fly        | Uses Java plugins            | Enables Bedrock clients on a Java server; requires world conversion to Java. |

**Recommendation:** For our needs (vanilla-like survival worlds with plugins), a Nukkit-based server is best. Cloudburst Nukkit or PowerNukkitX offers near-full compatibility with Realms worlds and strong performance【113†L105-L108】【117†L312-L320】. They support multi-worlds and have RCON. PocketMine-MP’s missing features and BDS’s limitations make them less ideal here. Geyser+Java is a valid alternative only if we wanted Java-server features and cross-play, which is not required.

## 2. Migrating Existing Realms Worlds
To migrate your Realms Bedrock worlds:

1. **Download Realms World:** In Minecraft, go to **Play → Realms → Configure → Backups**. Click **Download Latest** to save the current Realm world to your local device【41†L86-L90】. Confirm it appears in your Single-Player world list.
2. **Locate World Files:** On Windows, the downloaded world is in `%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\minecraftWorlds\`. On macOS/Linux Bedrock, check `~/Library/Application Support/minecraft/games/com.mojang/minecraftWorlds/`. Each world is a folder of files (usually LevelDB). Be sure to note the folder name.
3. **Version Check:** Ensure the world’s version matches your server’s version. An older server (e.g. 1.13) might refuse a 1.14+ Realm world (e.g. “LevelDB 8 not supported” on PocketMine)【73†L93-L100】【41†L64-L68】. Update your server software if needed so versions align.
4. **Upload to Server:** Using SFTP or your panel’s file manager, upload the entire world folder (and any `behavior_packs`/`resource_packs` subfolders) to the server host. For example, if using Nukkit/PowerNukkit, place it under the server’s main directory (e.g. `/home/minecraft/server/worlds/`).
5. **Configure World in Server:**
   - **Nukkit/PowerNukkit:** These use LevelDB natively. Simply name the folder appropriately. If using NukkitX (leveldb backend), enable `use-native-leveldb` in `nukkit.yml` for better performance. As [PowerNukkit docs](37) note, copy the leveldb folder to `worlds/` and then restart with that world name in the config【37†L145-L153】.
   - **PocketMine:** It uses a different format (NBT regions). You’d need a converter (tools exist but can be unreliable) or recreate the world. This is why PocketMine is not recommended for world import.
   - **Official BDS:** Place the folder under `worlds/` and set `level-name=world_folder_name` in `server.properties`【110†L108-L115】. (Or upload via panel and adjust “Level Name” accordingly【110†L108-L115】.)
6. **Verify Add-ons:** If your Realm used behavior or resource packs (in `behavior_packs/` etc), copy those into the server’s corresponding directories. Ensure the world’s `manifest.json` references are correct. Note: Nukkit/PowerNukkit do not use these packs, so custom content may not transfer exactly.
7. **Test and Fix:** Start the server and join. Look for missing textures or errors. Update plugins or server build if any issues. Common pitfalls include: **version mismatches**【73†L93-L100】, missing add-on content, or file permission problems.

These steps ensure your Realms worlds (and any add-ons) move into the new server. 

## 3. Server Management Panels
We evaluated modern panels for Bedrock support:

| Panel             | Bedrock Support            | Multi-Server | Role-Based Access | API / Automation      | Ease of Install | Notes                                  |
|-------------------|----------------------------|--------------|-------------------|-----------------------|-----------------|----------------------------------------|
| **Crafty Controller** | ✅ (since v4)【58†L80-L82】   | ✅           | ✅ (roles/users)  | REST API v2, tasks    | Medium (Python) | Simple UI, multi-server, supports RCON |
| **MCSManager**    | ✅ (configure Bedrock)【107†L125-L133】 | ✅           | Likely (auth)      | REST API, Docker-based| Medium (Docker)| Distributed architecture, open-source  |
| **Pterodactyl**  | ✅ (via Bedrock “Eggs”)      | ✅           | ✅ (subusers)     | REST/GraphQL API      | Medium (Docker) | Very popular; many community eggs (e.g. BDS, PocketMine) |
| **AMP (CubeCoders)**    | ✅ (commercial panel)      | ✅           | ✅ (user roles)   | Some API (limited)    | Simple (UI)     | Polish UI, supports Minecraft including Bedrock; proprietary/paid beyond small scale. |

- **Crafty Controller:** An open-source web panel (PHP/Python) for Minecraft servers. Version 4 added official Bedrock support【58†L80-L82】. It supports multiple servers per install, has fine-grained roles, a built-in console and REST API v2. It’s relatively easy to set up (Python app or Docker). Crafty’s UI is user-friendly, and you can restrict non-technical admins to simple controls via roles. 

- **MCSManager:** A modern, distributed panel supporting many game types. It allows setting up Bedrock servers (you select “Minecraft Server (Bedrock)” and upload the bedrock_server executable【107†L125-L133】). It supports multi-node and has an HTTP API. It’s Docker-based, free and open-source. It can run on a single server if needed. Role management is possible, though its UI might be heavier than Crafty’s.

- **Pterodactyl Panel:** The de-facto open-source game panel. It uses Docker (Wings) and supports any game through “eggs.” The community has “eggs” for Bedrock (e.g. a vanilla BDS egg, PocketMine egg). It has multi-server, sub-user roles, a web console, and a robust API (GraphQL). Installation is more involved (requires a Linux VM and Wings agent). Its UI is powerful but may be overkill for non-tech admins, unless you restrict features via sub-user permissions. Overall, Pterodactyl is excellent for a technical admin, and its API can be used for custom tools.

- **AMP (by CubeCoders):** A commercial panel (free for small use) with a modern UI. It supports dozens of games including Minecraft Bedrock. It offers role-based accounts and an easy setup wizard. Being proprietary, it may simplify management for non-tech users, but it has licensing considerations and a less flexible API.

**Recommendations:** For the power user (technical admin), **Pterodactyl** stands out due to its flexibility, community support, and open-source nature. For a lightweight, user-friendly backend, **Crafty** or **MCSManager** could serve as the simpler interface. One strategy: use Pterodactyl (or MCSManager) as the core engine, then build or customize a limited UI on top for non-technical admins (see next section). 

## 4. Building a Friendly Custom Web UI
To satisfy non-technical admins, we propose a custom web dashboard that exposes only simple controls. The UI will likely be a single-page app (React, Vue, or similar) communicating with the server via RCON or the panel’s API. Key design points:

- **Tech Stack:** A JavaScript frontend (React/Vue) and a lightweight backend (e.g. Node.js or Python) that interfaces with RCON or the chosen panel’s API. For example, if using Pterodactyl, calls can go to its REST/GraphQL endpoints; with Crafty, use its API v2; or use a Node RCON library to send commands to Nukkit. 

- **Controls to Expose:** Only safe, high-level actions:
  - **Server Controls:** Start, Stop, Restart, and Backup (trigger a world copy)【98†embed_image】. A simple toggle for **Whitelist** (on/off).
  - **Game Settings:** Buttons or toggles for **Change Difficulty** (Peaceful, Easy, Normal, Hard), **Set Gamemode** (Survival/Creative) for selected players, and presets like **“Kid Friendly Mode”** (e.g. Peaceful + Slowness) or **“Event Mode”** (maybe Creative + world borders).
  - **Player Tools:** A box to **Whitelist/Add Player**, **Kick/Ban Player**, or **Set Player Gamemode**. The UI should show the online player list and allow actions via dropdown.
  - **Safety:** No exposure of RAM, CPU, network, or server console. Avoid showing raw commands. 

- **Backend Integration:** 
  - Use authenticated API calls (e.g., JWT or OAuth integrated with panel accounts). 
  - If using RCON directly, implement a secure login and token system. Use TLS if possible. 
  - The backend will translate UI actions into commands (e.g., `difficulty <level>`, `whitelist on`, `ban <player>`, `save-backup`, etc.) via the API or RCON. 

- **Authentication & Roles:** Use the panel’s user system if possible, or an external auth. For instance, create “Admin” and “Moderator” roles. Admins get all controls; moderators get basic controls (start/stop, kick/ban). Use HTTPS/SSL for access. SSO with Tailscale/Cloudflare for admin access is an option too.

- **UI Best Practices:** 
  - Clear labels and icons (e.g. green Start, red Stop buttons). 
  - One screen layout (no nested menus). For example, a top section for Server status (Online/Offline, player count), and collapsible panels for World Controls and Player Tools. 
  - Mobile-friendly/responsive so parents can use it on phones/tablets. 
  - Provide confirmations for destructive actions (e.g. ban player).
  - Embed example UI image【105†embed_image】 as inspiration: minimal clutter, code-free display.

- **Example Workflow (Startup):** On page load, fetch server status (via API) and list of players. Display buttons: “Start Server” (if stopped) or “Stop Server” (if running). Player list with action dropdown (Kick/Ban/Gamemode). A separate section for world backup and difficulty toggles.

By isolating technology (no raw console, no memory sliders) and using big buttons/toggles, this custom UI will allow non-technical admins to manage the server safely.

## 5. Hosting Architecture (Proxmox)
We recommend running Proxmox VE on the Mac Mini to host containers/VMs for modularity. The proposed layout:

【98†embed_image】 *Figure: Example Proxmox layout with separate containers for the Minecraft server, web panel, and support services.*

- **Proxmox Host:** The Mac Mini (64 GB RAM, 8-core Intel i7) runs Proxmox VE. Allocate resources flexibly.

- **VM/LXC: Minecraft Server Node:** Use an LXC container (or small VM) for the Bedrock server(s). For two worlds, either run two separate containers (one per server) or run one container with multi-world support (Nukkit supports multi-worlds). Assign ~8 vCPUs and 16–32 GB RAM to this container (Bedrock is single-thread-sensitive【112†L780-L785】, so high clock speed is helpful). Nukkit’s Java server might use ~2–4 GB RAM per world, plus headroom. Use a performance-optimized Linux (Debian/Ubuntu).

- **VM/LXC: Panel/Proxy Node:** Run the web panel (Pterodactyl/Crafty/AMP) in another container. Give it ~2 vCPUs and 4–8 GB RAM. Install the panel and any database it needs (MySQL/MariaDB). Also host the reverse proxy (e.g. Nginx) here. This node will handle HTTP/HTTPS for the panel dashboard and API, and optionally TLS termination if using Cloudflare Tunnel or similar for access.

- **LXC: Reverse Proxy/Security (optional):** If preferred, a dedicated reverse-proxy container can handle domain SSL (Cloudflare Tunnel or Let’s Encrypt) and forward only necessary ports to the Minecraft container internally. For example, only forward the Bedrock UDP port to that container. This can also run WireGuard or firewall rules to protect admin ports. However, if combining with the panel container, ensure isolation.

- **Monitoring/Backup Containers:** Use small containers for auxiliary tasks. For example, a Prometheus/Grafana container for performance monitoring, and a backup management container (running rclone, Borg, or simple cron jobs) for offsite backups.

- **Resources & Scaling:** The Mac’s 64 GB easily supports this. E.g., 16–32 GB for the MC container, 4–8 GB for panel, rest for overhead and future use. If future demand rises, Proxmox can dynamically reallocate CPU/RAM. You can also add more containers if needed (e.g. a third world).

- **Proxmox Snapshots & Backup:** Utilize Proxmox’s built-in `vzdump` to snapshot LXC images daily. For example, snapshot the MC container before any major update. Offsite: configure Proxmox Backup Server (or simply `vzdump` to a network share or external drive). Additionally, schedule in-game world backups (see Section 8).

## 6. Secure Remote Access
Since the server is offsite, security is crucial. We recommend:

- **Admin Access:** Use a VPN (e.g. Tailscale or WireGuard) for remote administration of Proxmox and the web panel. This avoids exposing SSH or the Proxmox web GUI to the public internet. Tailscale can run on the host and panel container, letting you VPN in with multi-factor auth.

- **Gameplay Access (no port-forwarding):** For Bedrock player connections, avoid opening the game port publicly:
  - **Playit.gg:** A free gaming tunnel that supports UDP. Run the Playit client on the server; it creates a stable hostname (like `*.playit.gg`) that players use. This means your router doesn’t need manual port forwarding, and your real IP stays hidden.
  - **Cloudflare/TCPShield:** Cloudflare’s Tunnels are HTTP-only, so not directly applicable to Bedrock UDP. However, *TCPShield (Cloudflare for Minecraft)* offers DDoS protection. Note: Bedrock support requires a paid plan【81†L86-L89】. If budget allows, TCPShield can front your server (players connect via a Cloudflare IP and domain, then to you). This hides your IP and filters attacks.
  - **Optionally** put the panel behind Cloudflare Access for additional 2FA authentication.

- **DNS and Domain:** Register a domain (optional). You can point a subdomain (e.g. `play.mc.example.com`) to the Playit or TCPShield endpoint. Players on PC/mobile add this domain (with port 19132) in their client. For consoles, manual addition isn’t possible (see next section).

- **Firewall:** At minimum, forward only the required Bedrock port (19132 UDP) or use the tunnel service. Block all other inbound traffic at the router and host firewall. Use fail2ban or similar on the Proxmox host if SSH must be open (though VPN is safer).

Combining Tailscale for admin and Playit.gg or TCPShield for players achieves both security and usability. No matter the choice, do not expose the panel or Proxmox web UI publicly; require VPN access.

## 7. Player Connection Experience
Bedrock clients connect differently depending on platform:

- **PC/Windows/Mobile:** These clients have a “Servers” or “Friends” tab where you can manually **Add Server** by IP/domain. For example, if using Playit.gg, give players the `playit.gg` hostname (or your custom domain) and port. They can save it in their list like any server.

- **Consoles (Xbox, PlayStation, Switch):** By default, consoles *cannot manually add* custom servers【84†L224-L231】. They only list Realms and Featured Servers. This means console players can’t just enter your IP. Workarounds include DNS tricks (e.g. [BedrockConnect](84)), which redirect a fake official server name to your server. However, this is **not user-friendly** and is considered unofficial. If console play is required, the only seamless solution is to switch back to Realms or use a Geyser/Java proxy with an official-listed server (not covered here). In practice, for a small family group, focus on PC/mobile players. 

- **Realm-Like Appearance:** You *cannot* make a self-hosted server appear as a Realm. Players will **always** need to add your server manually (except consoles, which can’t). Realms are a Microsoft service only. 

- **DNS/Domain:** If you have a domain, create an A/UDP record (if your DNS provider supports SRV for Bedrock) or instruct players to use `domain:19132`. Consoles ignore this, so it only helps PC/mobile. Automatic reconnects aren’t available; users must re-add the server if the address changes.

In summary, players on supported platforms will add the custom server (e.g. `play.myserver.example:19132`) under the add-server screen. Console players would need technical workarounds (not recommended).

## 8. Backup and Recovery System
A robust backup regime is critical:

- **Automatic Daily World Backups:** Use a scheduled task (cron or panel schedule) to stop the server auto-save, compress the world folder, and store it. For Nukkit/PowerNukkit, you can issue commands like `save hold` then copy, or use a backup plugin. Example steps: run `save hold`, wait a second, `tar czf /backups/world-$(date).tar.gz <world_folder>`, then `save resume`. This ensures consistency. Alternatively, use Proxmox LXC freeze (if supported) or simply stop the server each night for 1-2 minutes during backup.

- **Offsite Backups:** After creating backups locally, sync them offsite. For example, use `rclone` to upload to Google Drive/Dropbox or a remote server. You could also configure Proxmox Backup Server or `vzdump` to store LXC snapshots on another network location or cloud. Keep at least 7 days of backups.

- **Snapshots Before Updates:** Before updating the server software or adding plugins, take a Proxmox snapshot of the container (or a VM snapshot). If anything goes wrong, revert quickly. Similarly, snapshot before OS/kernel updates on the host or panel node.

- **Versioned Backups:** Label backups with timestamps and keep separate directories for each world. For multi-world setups, back up each world independently. Store separate backups for the panel’s database (if used) as well.

- **Recovery Plan:** Test your backups: periodically spin up a recovery container, restore a backup, and load the world to ensure it’s not corrupt. Document the restore steps so even a non-technical admin can follow them if needed.

By combining container snapshots (for full system restore) with daily world file backups (for data safety), you ensure minimal data loss and quick recovery.

## 9. Performance Considerations
The Mac Mini 2019 (Intel 8-core i7, high clock, 64 GB RAM) is well-suited for this. Recommendations:

- **CPU:** Bedrock (BDS/Nukkit) is *single-thread sensitive*【112†L780-L785】. The i7’s high per-core speed is ideal. Allocate at least 4 cores to each world instance. For two worlds, 8 cores total is comfortable.

- **RAM:** Allocate around **4–8 GB per world**. Bedrock servers typically use less RAM than Java, but Java-based Nukkit can use 2–4 GB under load. The Mac’s 64 GB means you can easily allocate, e.g., 16 GB to Minecraft (both servers combined) and still have RAM for the panel and OS.

- **Server Tuning:** 
  - For **Nukkit/Java**, start with `-Xmx4G -Xms4G` (heap) and use G1GC (`-XX:+UseG1GC`). Keep `view-distance` low (e.g. 8) to reduce CPU load. Enable `use-native-leveldb` in Nukkit to improve disk I/O performance. 
  - For **PocketMine**, not needed since we recommend Nukkit.
  - If using **BDS**, there are no flags to set; monitor CPU. Avoid excessive redstone/mob farms since BDS can lag beyond ~150-200 entities【112†L780-L785】.

- **Multiple Worlds:** Running separate server processes (or containers) for each world isolates loads. You can also run both worlds on one Nukkit instance (it supports multi-worlds via plugins), but separate instances simplifies management and allows tailored resources per world.

- **Network:** Use a gigabit connection at the server location. Bedrock uses UDP (port 19132) and needs low latency. If using Playit.gg or a relay, ensure it has good bandwidth.

Overall, the hardware is ample. With the above resource allocations and settings, both worlds should run smoothly even with ~10–20 players. Monitor CPU/RAM (Prometheus) and adjust as needed.

## Implementation Steps and Difficulty
1. **Prepare Hardware/Proxmox:** Install Proxmox on the Mac Mini. Create LXC containers as above. (Difficulty: *Medium*, Proxmox installation and container setup).

2. **Install Server Software:** In the Minecraft container(s), install Java (for Nukkit) or appropriate requirements. Download and configure the recommended Bedrock server (NukkitX or PowerNukkit). Test launching a blank world. (Difficulty: *Medium*, basic Linux tasks).

3. **Import Worlds:** Follow Section 2 steps to upload and configure the Realms worlds. Verify loading. (Difficulty: *Low*, fairly straightforward if versions match).

4. **Install Control Panel:** On the panel container, install Crafty/MCSManager/Pterodactyl/AMP as chosen. Configure a server instance pointing to the Minecraft container. Ensure it can start/stop the MC server via RCON or container. (Difficulty: *High*, panel setup can be intricate).

5. **Develop Custom UI:** Build or configure the limited interface. If using Pterodactyl, the panel UI is ready, but consider hiding advanced settings via user roles. For a bespoke UI, spin up a web app (React + Node) that calls the panel API or RCON. (Difficulty: *High*, requires web development).

6. **Secure Access:** Set up VPN (Tailscale) on relevant machines. Configure firewall rules. If using Playit.gg, install their client. If using TCPShield, configure DNS and firewall per their guides. (Difficulty: *Medium*, depending on chosen method).

7. **Test and Iterate:** Have the non-technical admins try the UI to ensure it is truly simple. Adjust wording and layout for clarity. Monitor performance with a small load. (Difficulty: *Low* to *Medium*).

8. **Backup Automation:** Write and schedule backup scripts (or configure panel’s backup feature). Perform test restores. (Difficulty: *Medium*).

**Setup Difficulty:** Overall **moderate**. Installing Proxmox, Linux containers, and a web panel requires sysadmin skill. Migrating worlds is straightforward. UI development can be a custom effort (if not using panel out-of-box) and may require some programming. Security setup (VPN, tunnels) needs network knowledge. 

**Future Improvements:** Once stable, consider:
- **Analytics:** Integrate Grafana for server stats.
- **Plugins:** Add moderation plugins or world protections.
- **Scalability:** If needed, split worlds onto separate nodes, or allow quick instance cloning for events.
- **Cross-Play:** If later wanting Java players, integrate Geyser & Paper.
- **UI Evolution:** Add optional mobile app integration or notifications (e.g. on world backup success/failure).

This proposal covers the architecture, software choices, migration steps, security, and UI design for a user-friendly, self-hosted Bedrock server platform. All recommendations are geared toward giving non-technical admins an intuitive experience while maintaining strong security and performance. 

