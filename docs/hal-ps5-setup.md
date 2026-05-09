# MinecraftLab on PS5 — One-Time Setup

These steps let a PS5 player join self-hosted Minecraft Bedrock worlds, even though PS5 has no native "Add Server" button.

> **For host operators:** Replace `<PUBLIC_HOST_IP>` and `<BCONNECT_PORT>` below with your deployment's actual values before sharing this doc with players. The defaults shipped in the codebase are `19131` for `<BCONNECT_PORT>`. The IP is whatever your `host-api` reports as the external IP (run `upnpc -s` on the host or check `whatismyip.com`). For long-term stability, point a DDNS hostname at your public IP and substitute that hostname in the steps below.

After this one-time setup, joining any MinecraftLab world is one tap from any Featured Server (e.g., The Hive) in Minecraft.

## Step 1: Set the DNS on your PS5

This makes Minecraft route through a service called BedrockConnect that lets consoles see custom servers.

1. PS5 home screen → **Settings**
2. **Network** → **Settings** → **Set Up Internet Connection**
3. Pick your current Wi-Fi (or wired) connection → **Advanced Settings**
4. **DNS Settings** → **Manual**
5. Enter:
   - **Primary DNS:** `104.238.130.180`
   - **Secondary DNS:** `1.1.1.1`
6. Save / Done. PS5 may briefly reconnect.

> **Tip:** The secondary `1.1.1.1` is just a fallback so the rest of your PS5 (Netflix, store, etc.) keeps working normally if BedrockConnect ever has a hiccup.

## Step 2: Add MinecraftLab as a saved server (in-game)

1. Open **Minecraft** on the PS5
2. Tap **Play** → **Servers** tab
3. Tap any **Featured Server** at the top of the list (The Hive works great)
4. Instead of joining Hive, you'll see a custom in-game menu pop up — this is the BedrockConnect menu
5. Scroll down and tap **Add Server**
6. Fill out the form:
   - **Server Name:** `MinecraftLab`
   - **Server Address:** `<PUBLIC_HOST_IP>` *(or your DDNS hostname)*
   - **Server Port:** `<BCONNECT_PORT>` *(default: `19131`)*
7. Confirm / Submit

That's it for setup.

---

## How to play (every session after that)

1. Open Minecraft → **Play** → **Servers** tab
2. Tap any Featured Server (The Hive, Galaxite, whatever — they all route the same way)
3. The BedrockConnect menu pops up. **MinecraftLab** is right there in the list
4. Tap **MinecraftLab**
5. You'll see a second menu — this one's the MinecraftLab world picker, showing every world that's currently up
6. Tap the world you want to play

---

## Troubleshooting

**"Connection failed" or stuck on "Connecting..."**
- Verify the DNS entries above are still set. Some PS5 system updates reset network settings.
- Toggle Wi-Fi off and back on to flush cached DNS.

**MinecraftLab entry isn't in the BedrockConnect menu**
- Open the form again (Add Server) and re-enter the address. Check there are no typos.

**MinecraftLab menu shows worlds but tapping one fails**
- Network hiccup on our side or a world is restarting. Wait 30s and try again.
- If it persists, message the host — the world's container may need a kick.

---

*Note: The DNS change applies system-wide on the PS5 — it's safe and reversible. To restore default DNS, go back to **Network → Set Up Internet Connection → Advanced Settings → DNS Settings → Automatic**.*
