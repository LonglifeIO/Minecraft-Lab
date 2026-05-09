#!/usr/bin/env python3
"""MinecraftLab Host API — runs on the Proxmox host.
Manages world registry, container lifecycle, auto-stop idle worlds,
and pre-provisions standby containers for instant world creation.
"""

from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json
import subprocess
import os
import time
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor

CONFIG_PATH = "/etc/minecraftlab/worlds.json"
PORT = 8090

# ============ CONFIG ============

_config_lock = threading.Lock()

def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)

def save_config(cfg):
    with _config_lock:
        with open(CONFIG_PATH, "w") as f:
            json.dump(cfg, f, indent=2)

# ============ HELPERS ============

def run(cmd, timeout=60):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip(), r.returncode
    except:
        return "", -1

def ct_status(ctid):
    out, _ = run(f"pct status {ctid}")
    return "running" in out

def ct_exists(ctid):
    _, code = run(f"pct config {ctid}")
    return code == 0

def bds_api_call(ip, port, path):
    cfg = load_config()
    token = cfg.get("apiToken", "")
    req = urllib.request.Request(
        f"http://{ip}:{port}{path}",
        headers={"Authorization": f"Bearer {token}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except:
        return None

# ============ STANDBY PROVISIONING ============

_provisioning = False

def _provision_standby():
    """Clone a new standby container in the background."""
    global _provisioning
    if _provisioning:
        return
    _provisioning = True

    try:
        cfg = load_config()

        # Check if standby already exists
        standby = cfg.get("standbyCtid")
        if standby and ct_exists(standby):
            print(f"[standby] CT {standby} already exists, skipping")
            return

        ctid = cfg["nextCtid"]
        ip_suffix = cfg["nextIpSuffix"]
        subnet = cfg["subnet"]
        gateway = cfg["gateway"]
        source = cfg["sourceCtid"]
        ip = f"{subnet}.{ip_suffix}"

        print(f"[standby] Provisioning CT {ctid} at {ip}...")

        out, code = run(f"pct clone {source} {ctid} --hostname mc-standby --full --snapname template", timeout=300)
        if code != 0:
            print(f"[standby] Clone failed: {out}")
            return

        run(f"pct set {ctid} --net0 name=eth0,bridge=vmbr0,ip={ip}/24,gw={gateway} --nameserver 8.8.8.8")
        run(f"pct set {ctid} --memory 2048 --swap 512 --cores 2 --onboot 0")

        # Start briefly to clean all cloned data and reset to a blank slate
        run(f"pct start {ctid}")
        time.sleep(5)
        run(f'''pct exec {ctid} -- bash -c '
            systemctl stop bedrock 2>/dev/null; sleep 1
            killall -u minecraft bedrock_server 2>/dev/null; sleep 1
            rm -rf /opt/bedrock/worlds/*
            rm -f /opt/bedrock/logs/server.log
            echo "[]" > /opt/bedrock/allowlist.json
            echo "[]" > /opt/bedrock/permissions.json
            sed -i "s/server-name=.*/server-name=New World/" /opt/bedrock/server.properties
            sed -i "s/level-name=.*/level-name=world/" /opt/bedrock/server.properties
            systemctl disable bedrock
            systemctl disable bds-api
            chown -R minecraft:minecraft /opt/bedrock/
        '
        ''', timeout=30)
        run(f"pct stop {ctid}", timeout=30)
        time.sleep(2)

        # Save standby info
        cfg = load_config()  # re-read in case it changed
        cfg["standbyCtid"] = ctid
        cfg["standbyIp"] = ip
        cfg["nextCtid"] = ctid + 1
        cfg["nextIpSuffix"] = ip_suffix + 1
        save_config(cfg)

        print(f"[standby] CT {ctid} ready")
    except Exception as e:
        print(f"[standby] Error: {e}")
    finally:
        _provisioning = False


def ensure_standby():
    """Start background provisioning if no standby exists."""
    cfg = load_config()
    standby = cfg.get("standbyCtid")
    if not standby or not ct_exists(standby):
        threading.Thread(target=_provision_standby, daemon=True).start()


# ============ WORLD MANAGEMENT ============

def _boot_world_background(ctid, name, seed=""):
    """Start container and configure BDS in background."""
    safe_name = name.replace('"', '\\"')
    safe_seed = seed.replace('"', '') if seed else ""
    run(f"pct start {ctid}")
    time.sleep(5)
    # Copy allowlist from source world so players can join immediately
    cfg_fresh = load_config()
    source = cfg_fresh.get("sourceCtid", 100)
    run(f"pct pull {source} /opt/bedrock/allowlist.json /tmp/mc-allowlist.json")
    run(f"pct push {ctid} /tmp/mc-allowlist.json /opt/bedrock/allowlist.json")
    run(f"pct pull {source} /opt/bedrock/permissions.json /tmp/mc-permissions.json")
    run(f"pct push {ctid} /tmp/mc-permissions.json /opt/bedrock/permissions.json")

    # Always push latest bds-api.py so new containers have all features
    base_dir = os.path.dirname(os.path.abspath(__file__))
    script_path = os.path.join(base_dir, "bds-api.py")
    run(f"pct push {ctid} {script_path} /opt/bedrock/bds-api.py")

    # Sync BDS binary from the source container so new worlds match the active version
    source_ver, _ = run(f"pct exec {source} -- cat /opt/bedrock/version.txt")
    standby_ver, _ = run(f"pct exec {ctid} -- cat /opt/bedrock/version.txt")
    if source_ver and standby_ver and source_ver.strip() != standby_ver.strip():
        print(f"[create] Updating BDS {standby_ver.strip()} → {source_ver.strip()}")
        # Pull BDS binary tarball from source (excludes world/config data)
        run(f"pct exec {source} -- tar cf /tmp/bds-bin.tar -C /opt/bedrock bedrock_server resource_packs behavior_packs definitions version.txt --exclude='worlds' 2>/dev/null", timeout=120)
        run(f"pct pull {source} /tmp/bds-bin.tar /tmp/bds-bin.tar", timeout=120)
        run(f"pct push {ctid} /tmp/bds-bin.tar /tmp/bds-bin.tar", timeout=120)
        run(f"pct exec {ctid} -- bash -c 'tar xf /tmp/bds-bin.tar -C /opt/bedrock && chmod +x /opt/bedrock/bedrock_server && chown -R minecraft:minecraft /opt/bedrock && rm /tmp/bds-bin.tar'", timeout=60)
        run(f"pct exec {source} -- rm -f /tmp/bds-bin.tar")
        run("rm -f /tmp/bds-bin.tar")

    # BDS is disabled in the standby — configure first, then start
    seed_cmd = f'sed -i "s/level-seed=.*/level-seed={safe_seed}/" /opt/bedrock/server.properties' if safe_seed else ""
    run(f'''pct exec {ctid} -- bash -c '
        killall -u minecraft bedrock_server 2>/dev/null
        rm -rf /opt/bedrock/worlds/*
        rm -f /opt/bedrock/logs/server.log
        sed -i "s|/opt/bedrock/api.py|/opt/bedrock/bds-api.py|" /etc/systemd/system/bds-api.service 2>/dev/null
        systemctl daemon-reload
        chown minecraft:minecraft /opt/bedrock/allowlist.json /opt/bedrock/permissions.json
        sed -i "s/server-name=.*/server-name={safe_name}/" /opt/bedrock/server.properties
        sed -i "s/level-name=.*/level-name={safe_name}/" /opt/bedrock/server.properties
        {seed_cmd}
        systemctl enable bedrock
        systemctl enable bds-api
        systemctl start bedrock
        sleep 5
        systemctl start bds-api
    '
    ''', timeout=45)
    _worlds_cache["data"] = None
    print(f"[create] {name} (CT {ctid}) is ready")


def create_world(name, seed=""):
    cfg = load_config()
    standby_ctid = cfg.get("standbyCtid")
    standby_ip = cfg.get("standbyIp")

    if not standby_ctid or not ct_exists(standby_ctid):
        return {"error": "No standby container ready. Please wait a few minutes and try again."}

    world_id = f"world{standby_ctid}"

    # Rename the standby (instant)
    run(f"pct set {standby_ctid} --hostname mc-{world_id}")

    # Register immediately so the UI can navigate to it
    world = {
        "id": world_id,
        "name": name,
        "ctid": standby_ctid,
        "ip": standby_ip,
        "gamePort": 19132,
        "apiPort": 8080,
        "alwaysOn": True,
    }
    cfg["worlds"].append(world)
    cfg["standbyCtid"] = None
    cfg["standbyIp"] = None
    save_config(cfg)
    _worlds_cache["data"] = None

    # Boot the container in background
    threading.Thread(target=_boot_world_background, args=(standby_ctid, name, seed), daemon=True).start()

    # Provision next standby in background
    ensure_standby()

    return {"success": True, "world": world}


def delete_world(world_id):
    cfg = load_config()
    world = next((w for w in cfg["worlds"] if w["id"] == world_id), None)
    if not world:
        return {"error": "World not found"}
    if world["ctid"] in [100, 101]:
        return {"error": "Cannot delete original worlds"}

    ctid = world["ctid"]
    if ct_status(ctid):
        run(f'''pct exec {ctid} -- bash -c '
            su - minecraft -c "screen -S bedrock -X stuff \\"stop\\n\\"" 2>/dev/null
            sleep 3
        '
        ''')
        run(f"pct stop {ctid}", timeout=30)
        time.sleep(3)
    run(f"pct destroy {ctid} --purge", timeout=30)

    cfg["worlds"] = [w for w in cfg["worlds"] if w["id"] != world_id]
    save_config(cfg)
    _worlds_cache["data"] = None
    return {"success": True}


def start_world(world_id):
    cfg = load_config()
    world = next((w for w in cfg["worlds"] if w["id"] == world_id), None)
    if not world:
        return {"error": "World not found"}
    if ct_status(world["ctid"]):
        return {"error": "Already running"}
    run(f"pct start {world['ctid']}")
    time.sleep(6)
    _worlds_cache["data"] = None
    return {"success": True}


def stop_world(world_id):
    cfg = load_config()
    world = next((w for w in cfg["worlds"] if w["id"] == world_id), None)
    if not world:
        return {"error": "World not found"}
    if not ct_status(world["ctid"]):
        return {"error": "Not running"}
    run(f'''pct exec {world["ctid"]} -- bash -c '
        su - minecraft -c "screen -S bedrock -X stuff \\"stop\\n\\"" 2>/dev/null
        sleep 3
    '
    ''')
    run(f"pct stop {world['ctid']}", timeout=30)
    _worlds_cache["data"] = None
    return {"success": True}


# ============ WORLD LIST (cached + parallel) ============

_worlds_cache = {"data": None, "time": 0}
_CACHE_TTL = 2

def _fetch_world_status(w):
    running = ct_status(w["ctid"])
    entry = {**w, "running": running}
    if running:
        status = bds_api_call(w["ip"], w["apiPort"], "/status")
        if status:
            entry["bdsStatus"] = status
    return entry

def list_worlds():
    now = time.time()
    if _worlds_cache["data"] is not None and (now - _worlds_cache["time"]) < _CACHE_TTL:
        return _worlds_cache["data"]

    cfg = load_config()
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_fetch_world_status, w): w for w in cfg["worlds"]}
        worlds = [f.result() for f in futures]

    _worlds_cache["data"] = worlds
    _worlds_cache["time"] = now
    return worlds


# ============ BDS UPDATES ============

import urllib.request as _urllib
import re as _re

_LATEST_CACHE = {"version": None, "url": None, "time": 0}
_LATEST_TTL = 300  # 5 minutes

def fetch_latest_bds_version():
    now = time.time()
    if _LATEST_CACHE["version"] and (now - _LATEST_CACHE["time"]) < _LATEST_TTL:
        return _LATEST_CACHE["version"], _LATEST_CACHE["url"]
    try:
        req = _urllib.Request(
            "https://net.web.minecraft-services.net/api/v1.0/download/links",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        with _urllib.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        url = next(l["downloadUrl"] for l in data["result"]["links"] if l["downloadType"] == "serverBedrockLinux")
        m = _re.search(r"\d+\.\d+\.\d+\.\d+", url)
        version = m.group(0) if m else None
        _LATEST_CACHE.update({"version": version, "url": url, "time": now})
        return version, url
    except Exception as e:
        print(f"[updates] fetch failed: {e}")
        return None, None

def get_world_version(ctid):
    try:
        out, _ = run(f"pct exec {ctid} -- cat /opt/bedrock/version.txt", timeout=10)
        return out.strip() if out else None
    except Exception:
        return None

def check_updates():
    """Return per-world current vs latest version info."""
    latest, _ = fetch_latest_bds_version()
    cfg = load_config()
    worlds = []
    for w in cfg["worlds"]:
        current = get_world_version(w["ctid"])
        worlds.append({
            "id": w["id"],
            "name": w["name"],
            "ctid": w["ctid"],
            "current": current,
            "latest": latest,
            "needsUpdate": bool(latest and current and current != latest),
        })
    return {"latest": latest, "worlds": worlds}

_update_state = {"running": False, "log": [], "startedAt": None, "finishedAt": None}

def _update_log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    _update_state["log"].append(line)
    print(f"[updates] {msg}")

def _apply_updates(force=False):
    """Run update for all alwaysOn worlds. Background thread."""
    try:
        _update_state.update({"running": True, "log": [], "startedAt": time.time(), "finishedAt": None})
        latest, url = fetch_latest_bds_version()
        if not latest or not url:
            _update_log("Could not fetch latest BDS version")
            return
        _update_log(f"Latest BDS: {latest}")

        cfg = load_config()
        targets = [w for w in cfg["worlds"] if w.get("alwaysOn")]
        needs = []
        for w in targets:
            current = get_world_version(w["ctid"])
            if current and current != latest:
                needs.append((w, current))

        if not needs:
            _update_log("All worlds already up to date")
            return

        # Download once
        zip_path = f"/tmp/bedrock-server-{latest}.zip"
        if not os.path.exists(zip_path):
            _update_log(f"Downloading {latest}...")
            req = _urllib.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with _urllib.urlopen(req, timeout=300) as resp, open(zip_path, "wb") as f:
                f.write(resp.read())
            _update_log("Download complete")

        base_dir = os.path.dirname(os.path.abspath(__file__))
        update_script = os.path.join(base_dir, "scripts", "bds-update.sh")

        for w, current in needs:
            # Check players online
            status = bds_api_call(w["ip"], w["apiPort"], "/status") or {}
            players = status.get("players", 0)
            if players > 0 and not force:
                _update_log(f"[{w['id']}] {players} player(s) online — skipping (use force)")
                continue

            _update_log(f"[{w['id']}] Updating {current} -> {latest}")
            run(f"pct push {w['ctid']} {zip_path} /tmp/bedrock-server-{latest}.zip", timeout=120)
            run(f"pct push {w['ctid']} {update_script} /tmp/bds-update.sh", timeout=30)
            try:
                run(f"pct exec {w['ctid']} -- bash /tmp/bds-update.sh /tmp/bedrock-server-{latest}.zip", timeout=180)
                _update_log(f"[{w['id']}] Updated successfully")
            except Exception as e:
                _update_log(f"[{w['id']}] FAILED: {e}")
    except Exception as e:
        _update_log(f"Update run failed: {e}")
    finally:
        _update_state["running"] = False
        _update_state["finishedAt"] = time.time()

def trigger_updates(force=False):
    if _update_state["running"]:
        return {"success": False, "error": "Update already in progress"}
    threading.Thread(target=_apply_updates, kwargs={"force": force}, daemon=True).start()
    return {"success": True}


# ============ AUTO-STOP DAEMON ============

idle_counters = {}

def auto_stop_loop():
    # Wait for startup, then provision standby if needed
    time.sleep(10)
    ensure_standby()

    while True:
        try:
            cfg = load_config()
            timeout = cfg.get("idleTimeoutMinutes", 10)

            for w in cfg["worlds"]:
                wid = w["id"]
                if w.get("alwaysOn"):
                    idle_counters.pop(wid, None)
                    continue
                if not ct_status(w["ctid"]):
                    idle_counters.pop(wid, None)
                    continue

                status = bds_api_call(w["ip"], w["apiPort"], "/status")
                if status and status.get("online"):
                    players = status.get("players", 0)
                    if players == 0:
                        idle_counters[wid] = idle_counters.get(wid, 0) + 1
                        if idle_counters[wid] >= timeout:
                            print(f"[auto-stop] {w['name']} idle for {timeout}min, stopping")
                            stop_world(wid)
                            idle_counters.pop(wid, None)
                    else:
                        idle_counters[wid] = 0
        except Exception as e:
            print(f"[auto-stop] error: {e}")

        time.sleep(60)


# ============ HTTP HANDLER ============

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass

    def _auth(self):
        cfg = load_config()
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {cfg.get('apiToken', '')}":
            self._json(401, {"error": "unauthorized"})
            return False
        return True

    def _json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length:
            return json.loads(self.rfile.read(length))
        return {}

    def do_GET(self):
        if not self._auth(): return
        p = self.path.rstrip("/")
        if p == "/worlds":
            self._json(200, list_worlds())
        elif p == "/standby":
            cfg = load_config()
            ready = cfg.get("standbyCtid") and ct_exists(cfg["standbyCtid"])
            self._json(200, {"ready": ready, "provisioning": _provisioning})
        elif p == "/updates/check":
            self._json(200, check_updates())
        elif p == "/updates/status":
            self._json(200, _update_state)
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth(): return
        p = self.path.rstrip("/")
        body = self._body()

        if p == "/worlds":
            name = body.get("name", "").strip()
            if not name:
                self._json(400, {"error": "missing name"})
                return
            seed = body.get("seed", "").strip()
            result = create_world(name, seed=seed)
            self._json(200 if result.get("success") else 500, result)

        elif p.startswith("/worlds/") and p.endswith("/start"):
            wid = p.split("/")[2]
            self._json(200, start_world(wid))

        elif p.startswith("/worlds/") and p.endswith("/stop"):
            wid = p.split("/")[2]
            self._json(200, stop_world(wid))

        elif p == "/updates/apply":
            force = bool(body.get("force", False))
            self._json(200, trigger_updates(force=force))

        elif p.startswith("/worlds/") and p.endswith("/importing"):
            wid = p.split("/")[2]
            importing = body.get("importing", False)
            cfg = load_config()
            world = next((w for w in cfg["worlds"] if w["id"] == wid), None)
            if not world:
                self._json(404, {"error": "not found"}); return
            world["importing"] = importing
            save_config(cfg)
            _worlds_cache["data"] = None
            self._json(200, {"success": True})

        else:
            self._json(404, {"error": "not found"})

    def do_DELETE(self):
        if not self._auth(): return
        p = self.path.rstrip("/")
        if p.startswith("/worlds/"):
            wid = p.split("/")[2]
            result = delete_world(wid)
            self._json(200 if result.get("success") else 400, result)
        else:
            self._json(404, {"error": "not found"})


if __name__ == "__main__":
    t = threading.Thread(target=auto_stop_loop, daemon=True)
    t.start()
    print(f"[host-api] Auto-stop daemon started ({load_config().get('idleTimeoutMinutes', 10)} min timeout)")
    print(f"[host-api] Listening on port {PORT}")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
