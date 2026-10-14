#!/usr/bin/env python3
"""MinecraftLab Host API — runs on the Proxmox host.
Manages world registry, container lifecycle, auto-stop idle worlds,
and pre-provisions standby containers for instant world creation.
"""

from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json
import subprocess
import struct
import base64
import os
import time
import threading
import urllib.request
import urllib.error
import hashlib
import base64
import zipfile
import shutil
import fcntl
import tarfile
import tempfile
import re
from datetime import datetime
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

def run_argv(argv, timeout=60):
    """Like run(), but takes an argument list and never goes through a shell.
    Use this when a command embeds a generated script or upstream metadata
    (release tags, filenames) that must not be re-parsed by the host shell."""
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip(), r.returncode
    except:
        return "", -1

# ============ UPNP ============

import re as _re

_public_ip_cache = {"ip": None, "time": 0}
_PUBLIC_IP_TTL = 300  # 5 min

def upnp_available():
    out, code = run("which upnpc", timeout=5)
    return code == 0 and out.strip() != ""

def get_public_ip(force=False):
    """Returns current external IP via UPnP, or None if unavailable."""
    now = time.time()
    if not force and _public_ip_cache["ip"] and (now - _public_ip_cache["time"]) < _PUBLIC_IP_TTL:
        return _public_ip_cache["ip"]
    if not upnp_available():
        return None
    out, _ = run("upnpc -s 2>&1", timeout=15)
    m = _re.search(r"ExternalIPAddress\s*=\s*(\d+\.\d+\.\d+\.\d+)", out)
    if not m:
        return _public_ip_cache.get("ip")
    ip = m.group(1)
    _public_ip_cache.update({"ip": ip, "time": now})
    return ip

def _upnpc_in_container(ctid, args):
    """Run upnpc inside a specific container. Many home routers (Bell Hub, etc.)
    enforce a per-host UPnP policy — only the device whose IP matches the
    target gets to open a forward to itself. Running upnpc inside the target
    container makes the source IP match the destination."""
    return run(f"pct exec {ctid} -- upnpc {args}", timeout=20)

def upnp_add(ctid, internal_ip, external_port, internal_port=None, protocol="UDP", description="MinecraftLab"):
    """Add a UPnP port forward by running upnpc *inside the target container*.
    Returns True if the forward is in place."""
    if internal_port is None:
        internal_port = external_port
    proto = protocol.upper()
    # upnpc -a takes <internal ip> <internal port> <external port> <protocol> [lease]
    args = f"-e {description!r} -a {internal_ip} {internal_port} {external_port} {proto} 0"
    out, code = _upnpc_in_container(ctid, args)
    ok = code == 0 and "is redirected" in out
    if not ok:
        # 718 ConflictInMappingEntry is expected when a manual forward already
        # exists — caller can decide whether that's acceptable.
        snippet = out.replace("\n", " ")[-200:]
        print(f"[upnp] add failed for {description} ({external_port}/{proto}): {snippet}")
    return ok

def upnp_remove(ctid, external_port, protocol="UDP"):
    out, code = _upnpc_in_container(ctid, f"-d {external_port} {protocol.upper()}")
    return code == 0 and "returned : 0" in out

UPNP_PORT_RANGE_START = 19200  # Worlds with manual router forwards typically use 19132/19134; start UPnP above that

def allocate_external_port(start=UPNP_PORT_RANGE_START):
    """Pick the next free even port for a new UPnP-managed world."""
    cfg = load_config()
    used = set()
    for w in cfg.get("worlds", []):
        if w.get("externalPort"):
            used.add(int(w["externalPort"]))
    p = start
    while p in used:
        p += 2
    return p

def ensure_upnp_forwards():
    """On startup or refresh, re-establish all UPnP forwards from worlds.json.
    Idempotent: re-adding an existing forward is a no-op on most routers.
    Worlds with `staticPort: true` are skipped (assumed to be managed by
    manual router rules)."""
    if not upnp_available():
        print("[upnp] miniupnpc not installed — skipping UPnP refresh")
        return
    cfg = load_config()
    public_ip = get_public_ip(force=True)
    print(f"[upnp] external IP: {public_ip or 'unknown'}")

    for w in cfg.get("worlds", []):
        if w.get("staticPort"):
            continue
        if w.get("externalPort"):
            upnp_add(int(w["ctid"]), w["ip"], int(w["externalPort"]),
                     int(w.get("gamePort", 19132)),
                     "UDP", f"MinecraftLab/{w['id']}")

def upnp_refresh_loop(interval=600):
    """Re-assert UPnP forwards now and every 10 min. Routers drop UPnP leases on reboot, and
    worlds on ports >= 19200 have no static router rule to fall back on. Re-adding is a no-op."""
    while True:
        try:
            ensure_upnp_forwards()
        except Exception as e:
            print(f"[upnp] refresh failed: {e}", flush=True)
        time.sleep(interval)

def ct_status(ctid):
    out, _ = run(f"pct status {ctid}")
    return "running" in out

def ct_exists(ctid):
    _, code = run(f"pct config {ctid}")
    return code == 0

SEED_DIR = "/etc/minecraftlab/seed"  # allowlist.json/permissions.json copied from the last deleted world

def _template_ctid(cfg=None):
    """Container new standbys are cloned from: the dedicated, always-stopped template
    (`templateCtid`). Falls back to the legacy `sourceCtid` (a live world with a 'template' snapshot)."""
    cfg = cfg or load_config()
    return cfg.get("templateCtid") or cfg.get("sourceCtid")

def _version_tuple(v):
    try:
        return tuple(int(x) for x in (v or "").strip().split("."))
    except ValueError:
        return ()

def _save_seed_from(ctid):
    """Keep the host-side allowlist/permissions seed current from a running world."""
    os.makedirs(SEED_DIR, exist_ok=True)
    for fn in ("allowlist.json", "permissions.json"):
        tmp = os.path.join(SEED_DIR, f".{fn}.tmp")
        _, code = run_argv(["pct", "pull", str(ctid), f"/opt/bedrock/{fn}", tmp])
        if code == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > 1:
            os.replace(tmp, os.path.join(SEED_DIR, fn))
        elif os.path.exists(tmp):
            os.remove(tmp)

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


def bds_api_post(ip, port, path, body, timeout=120):
    """POST to bds-api with a JSON body. Raises on transport error; returns
    parsed JSON on any non-error HTTP response."""
    cfg = load_config()
    token = cfg.get("apiToken", "")
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"http://{ip}:{port}{path}",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        # bds-api returns JSON error bodies even on 4xx/5xx — surface them
        try:
            return json.loads(e.read())
        except Exception:
            return {"success": False, "error": f"HTTP {e.code}"}

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
        source = _template_ctid(cfg)
        ip = f"{subnet}.{ip_suffix}"
        if not source or not ct_exists(source):
            print(f"[standby] No template container to clone (templateCtid={source}) — cannot provision")
            return

        print(f"[standby] Provisioning CT {ctid} at {ip} from CT {source}...")

        # The dedicated template is stopped and clones as-is; a running source (legacy: a live
        # world) can only be cloned from its 'template' snapshot.
        snap = " --snapname template" if ct_status(source) else ""
        out, code = run(f"pct clone {source} {ctid} --hostname mc-standby --full{snap}", timeout=600)
        if code != 0:
            print(f"[standby] Clone failed: {out}")
            return

        run(f"pct set {ctid} --net0 name=eth0,bridge=vmbr0,ip={ip}/24,gw={gateway} --nameserver 8.8.8.8")
        run(f"pct set {ctid} --memory 4096 --swap 1024 --cores 4 --onboot 0")

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

        # Ensure miniupnpc is present so create_world's UPnP forwarding actually
        # works. The Proxmox template snapshot predates this dependency, so older
        # standbies silently came up missing it and create_world's port-forward
        # call failed with empty stderr.
        run(f"pct exec {ctid} -- bash -c 'command -v upnpc >/dev/null || (apt-get update -qq && apt-get install -y miniupnpc)'", timeout=120)

        # Freshen BDS to Mojang's latest before sealing the standby. The Proxmox snapshot
        # we cloned from is whatever-version-it-was-when-snapped, so without this step
        # every standby ships stale BDS and every new world inherits it.
        try:
            latest, url = fetch_latest_bds_version()
            if latest and url:
                zip_path = f"/tmp/bedrock-server-{latest}.zip"
                if not os.path.exists(zip_path):
                    print(f"[standby] Downloading BDS {latest}...")
                    req = _urllib.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                    with _urllib.urlopen(req, timeout=300) as resp, open(zip_path, "wb") as f:
                        f.write(resp.read())
                print(f"[standby] Freshening BDS to {latest}")
                run(f"pct push {ctid} {zip_path} /tmp/bds.zip", timeout=120)
                run(f'''pct exec {ctid} -- bash -c '
                    cd /opt/bedrock
                    unzip -o /tmp/bds.zip -x "worlds/*" "server.properties" "allowlist.json" "permissions.json" "valid_known_packs.json" -d . > /dev/null
                    chmod +x bedrock_server
                    echo "{latest}" > version.txt
                    chown -R minecraft:minecraft /opt/bedrock
                    rm -f /tmp/bds.zip
                '
                ''', timeout=120)
        except Exception as e:
            print(f"[standby] BDS freshen failed (continuing with cloned binary): {e}")

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

def _bad_world_text(value):
    """Reject characters that break a world name/seed: line breaks would inject extra
    server.properties lines; slashes would nest the level folder under worlds/."""
    if any(c in value for c in "\n\r"):
        return "name/seed must not contain line breaks"
    if any(c in value for c in "/\\"):
        return "name/seed must not contain slashes"
    return None


def _write_properties(ctid, updates):
    """Set keys in a container's server.properties by pull/edit/push, so values never pass
    through a shell or sed (world names like "Greg's" or "World #1 & Hal" stay intact)."""
    props_tmp = f"/tmp/mc-props-{ctid}-{os.getpid()}-{threading.get_ident()}.properties"
    run_argv(["pct", "pull", str(ctid), "/opt/bedrock/server.properties", props_tmp])
    out, seen = [], set()
    with open(props_tmp) as f:
        for line in f.read().splitlines():
            key = line.split("=", 1)[0] if ("=" in line and not line.startswith("#")) else None
            if key in updates:
                out.append(f"{key}={updates[key]}")
                seen.add(key)
            else:
                out.append(line)
    out += [f"{k}={v}" for k, v in updates.items() if k not in seen]
    with open(props_tmp, "w") as f:
        f.write("\n".join(out) + "\n")
    run_argv(["pct", "push", str(ctid), props_tmp, "/opt/bedrock/server.properties"])
    run_argv(["pct", "exec", str(ctid), "--", "chown", "minecraft:minecraft", "/opt/bedrock/server.properties"])
    os.remove(props_tmp)


def _boot_world_background(ctid, name, seed=""):
    """Start container and configure BDS in background."""
    run(f"pct start {ctid}")
    run(f"pct set {ctid} --onboot 1 --startup order=2,up=15")  # a world must come back after a host reboot
    time.sleep(5)
    # Seed allowlist/permissions so the family can join immediately: a running world has the
    # freshest list; otherwise the host copy saved when the last world was deleted.
    cfg_fresh = load_config()
    donors = [w["ctid"] for w in cfg_fresh["worlds"] if w["ctid"] != ctid and ct_status(w["ctid"])]
    source = donors[0] if donors else None
    if source:
        _save_seed_from(source)
    for fn in ("allowlist.json", "permissions.json"):
        seed_file = os.path.join(SEED_DIR, fn)
        if os.path.exists(seed_file):
            run_argv(["pct", "push", str(ctid), seed_file, f"/opt/bedrock/{fn}"])

    # Always push latest bds-api.py so new containers have all features
    base_dir = os.path.dirname(os.path.abspath(__file__))
    script_path = os.path.join(base_dir, "bds-api.py")
    run(f"pct push {ctid} {script_path} /opt/bedrock/bds-api.py")

    # If a running world is on a newer BDS than the standby, sync its binaries so the new
    # world matches the active version. Never downgrade (a donor skipped during an update
    # because players were online may be behind the freshly updated standby).
    source_ver, _ = run(f"pct exec {source} -- cat /opt/bedrock/version.txt") if source else ("", 1)
    standby_ver, _ = run(f"pct exec {ctid} -- cat /opt/bedrock/version.txt")
    if source and source_ver and _version_tuple(source_ver) > _version_tuple(standby_ver):
        print(f"[create] Updating BDS {standby_ver.strip()} → {source_ver.strip()}")
        # Pull BDS binary tarball from source (excludes world/config data)
        run(f"pct exec {source} -- tar cf /tmp/bds-bin.tar -C /opt/bedrock bedrock_server resource_packs behavior_packs definitions version.txt --exclude='worlds' 2>/dev/null", timeout=120)
        run(f"pct pull {source} /tmp/bds-bin.tar /tmp/bds-bin.tar", timeout=120)
        run(f"pct push {ctid} /tmp/bds-bin.tar /tmp/bds-bin.tar", timeout=120)
        run(f"pct exec {ctid} -- bash -c 'tar xf /tmp/bds-bin.tar -C /opt/bedrock && chmod +x /opt/bedrock/bedrock_server && chown -R minecraft:minecraft /opt/bedrock && rm /tmp/bds-bin.tar'", timeout=60)
        run(f"pct exec {source} -- rm -f /tmp/bds-bin.tar")
        run("rm -f /tmp/bds-bin.tar")

    # BDS is disabled in the standby — configure first, then start. Name and seed go through
    # _write_properties, so quotes, '#' or '&' in them never meet a shell or sed.
    # cheats off before the first start: a world generated with allow-cheats=true is born with
    # commandsEnabled + hasBeenLoadedInCreative set, which disables achievements for good
    _write_properties(ctid, {"server-name": name, "level-name": name, "level-seed": seed or "", "allow-cheats": "false"})
    run(f'''pct exec {ctid} -- bash -c '
        killall -u minecraft bedrock_server 2>/dev/null
        rm -rf /opt/bedrock/worlds/*
        rm -f /opt/bedrock/logs/server.log
        sed -i "s|/opt/bedrock/api.py|/opt/bedrock/bds-api.py|" /etc/systemd/system/bds-api.service 2>/dev/null
        systemctl daemon-reload
        chown minecraft:minecraft /opt/bedrock/allowlist.json /opt/bedrock/permissions.json
        systemctl enable bedrock
        systemctl enable bds-api
        systemctl start bedrock
        sleep 5
        systemctl start bds-api
    '
    ''', timeout=45)
    # Open the public port now that the container (and upnpc inside it) is running; the
    # 10-minute refresh loop re-asserts it from here on.
    reg = next((w for w in load_config()["worlds"] if w["ctid"] == ctid), None)
    if reg and reg.get("externalPort"):
        gport = int(reg.get("gamePort", 19132))
        if upnp_add(ctid, reg["ip"], int(reg["externalPort"]), gport, "UDP", f"MinecraftLab/{reg['id']}"):
            print(f"[create] UPnP forward {reg['externalPort']}/udp -> {reg['ip']}:{gport}", flush=True)
        else:
            print("[create] UPnP forward failed; refresh loop retries within 10 min", flush=True)
    _worlds_cache["data"] = None
    print(f"[create] {name} (CT {ctid}) is ready", flush=True)
    # Put the new world on the Xbox friends tab (sync-target.sh repoints the port on start)
    world = next((w for w in load_config()["worlds"] if w["ctid"] == ctid), None)
    if world and world.get("xboxAccount"):
        _mcx_set_broadcaster(world["xboxAccount"], True)


def create_world(name, seed="", backup=True):
    bad = _bad_world_text(name) or _bad_world_text(seed)
    if bad:
        return {"error": bad}
    cfg = load_config()
    standby_ctid = cfg.get("standbyCtid")
    standby_ip = cfg.get("standbyIp")

    if not standby_ctid or not ct_exists(standby_ctid):
        return {"error": "No standby container ready. Please wait a few minutes and try again."}

    world_id = f"world{standby_ctid}"

    # Rename the standby (instant)
    run(f"pct set {standby_ctid} --hostname mc-{world_id}")

    # Allocate a public-facing port. The UPnP forward itself is added by _boot_world_background:
    # upnpc runs inside the target container, which is still stopped at this point.
    external_port = allocate_external_port()

    # Pick the next free Xbox-broadcaster slot ("primary" first, then "secondary").
    # If both are taken, leave the world without an account assignment.
    taken = {w.get("xboxAccount") for w in cfg["worlds"]}
    xbox_account = next((s for s in ("primary", "secondary") if s not in taken), None)

    # Register immediately so the UI can navigate to it
    world = {
        "id": world_id,
        "name": name,
        "ctid": standby_ctid,
        "ip": standby_ip,
        "gamePort": 19132,
        "externalPort": external_port,
        "apiPort": 8080,
        "alwaysOn": True,
        "backup": bool(backup),  # nightly daily-backup.sh includes this world (off for throwaway test worlds)
    }
    if xbox_account:
        world["xboxAccount"] = xbox_account
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
    ctid = world["ctid"]
    if ctid in (_template_ctid(cfg), cfg.get("standbyCtid")):
        return {"error": "That container is the template/standby, not a deletable world"}

    if ct_status(ctid):
        # Remember who was allowed in, so the next new world starts with the same family list
        _save_seed_from(ctid)
        # Stop BDS gracefully but keep the container's network stack alive
        # long enough to release its UPnP forward (the router only accepts
        # remove-requests from the IP that owns the mapping).
        run(f'''pct exec {ctid} -- bash -c '
            su - minecraft -c "screen -S bedrock -X stuff \\"stop\\n\\"" 2>/dev/null
            sleep 3
        '
        ''')
        # Release UPnP forward while container is still running
        if world.get("externalPort") and not world.get("staticPort"):
            if upnp_remove(ctid, int(world["externalPort"])):
                print(f"[delete] UPnP forward {world['externalPort']}/udp removed")
            else:
                print(f"[delete] UPnP forward {world['externalPort']}/udp could not be removed (will expire on router reboot)")
        run(f"pct stop {ctid}", timeout=30)
        time.sleep(3)
    run(f"pct destroy {ctid} --purge", timeout=30)

    cfg["worlds"] = [w for w in cfg["worlds"] if w["id"] != world_id]
    save_config(cfg)
    _worlds_cache["data"] = None
    # Take the world off the Xbox friends tab too
    _mcx_set_broadcaster(world.get("xboxAccount"), False)
    return {"success": True}


def reset_world(world_id, name, seed=""):
    """Wipe a world's save data and let BDS generate a fresh world with a new name and seed.
    This is how an original world (CT 100, the standby template) is "deleted and recreated":
    the container, its external port and its Xbox account slot all stay; only the world changes.
    The old world is archived to /var/backups/minecraft/<id>/keep/ first (outside the daily
    rotation's prune) and the reset aborts, with BDS restarted, if that archive can't be made."""
    cfg = load_config()
    world = next((w for w in cfg["worlds"] if w["id"] == world_id), None)
    if not world:
        return {"error": "World not found"}
    name = (name or "").strip()
    if not name:
        return {"error": "missing name"}
    if any(c in name for c in '"\\\n\r/'):
        return {"error": "name contains unsupported characters"}
    seed = (seed or "").strip()
    if any(c in seed for c in '"\\\n\r'):
        return {"error": "seed contains unsupported characters"}
    bad = _bad_world_text(name)
    if bad:
        return {"error": bad}
    ctid = world["ctid"]
    if not ct_status(ctid):
        run(f"pct start {ctid}", timeout=60)
        time.sleep(5)

    # 1. Stop BDS gracefully (bedrock.service's stop.sh sends "stop" to the console, then waits)
    print(f"[reset] {world_id}: stopping BDS in CT {ctid}", flush=True)
    run(f"pct exec {ctid} -- systemctl stop bedrock", timeout=120)
    run_argv(["pct", "exec", str(ctid), "--", "pkill", "-u", "minecraft", "bedrock_server"], timeout=15)

    # 2. Archive the old world outside the backup rotation
    old_props, _ = run(f"pct exec {ctid} -- grep -m1 '^level-name=' /opt/bedrock/server.properties")
    old_level = old_props.split("=", 1)[1].strip() if "=" in old_props else ""
    archive = None
    _, code = run_argv(["pct", "exec", str(ctid), "--", "test", "-d", f"/opt/bedrock/worlds/{old_level}"])
    if old_level and code == 0:
        keep_dir = f"/var/backups/minecraft/{world_id}/keep"
        os.makedirs(keep_dir, exist_ok=True)
        archive = f"{keep_dir}/{world_id}_pre-reset_{time.strftime('%Y%m%d-%H%M%S')}.tar.gz"
        remote_tmp = "/tmp/mc-world-reset.tar.gz"
        _, code = run_argv(["pct", "exec", str(ctid), "--", "tar", "-czf", remote_tmp,
                            "-C", "/opt/bedrock/worlds", old_level], timeout=900)
        if code == 0:
            _, code = run_argv(["pct", "pull", str(ctid), remote_tmp, archive], timeout=900)
        run_argv(["pct", "exec", str(ctid), "--", "rm", "-f", remote_tmp])
        if code != 0 or not os.path.exists(archive):
            run(f"pct exec {ctid} -- systemctl start bedrock", timeout=60)
            return {"error": "Could not archive the old world; nothing was changed and BDS was restarted"}
        print(f"[reset] {world_id}: old world '{old_level}' archived to {archive}", flush=True)

    # Remember which add-ons the old world had enabled: the pack files stay in behavior_packs/ and
    # resource_packs/, only the per-world enable lists live inside the world folder that is wiped.
    pack_lists = {}
    for fn in ("world_behavior_packs.json", "world_resource_packs.json"):
        out, code = run_argv(["pct", "exec", str(ctid), "--", "cat", f"/opt/bedrock/worlds/{old_level}/{fn}"]) if old_level else ("", 1)
        if code == 0 and out.strip():
            try:
                if isinstance(json.loads(out), list):
                    pack_lists[fn] = out
            except ValueError:
                pass

    # 3. Wipe the save data and point server.properties at the new world
    run_argv(["pct", "exec", str(ctid), "--", "bash", "-c",
              "rm -rf /opt/bedrock/worlds/* && rm -f /opt/bedrock/logs/server.log"], timeout=120)
    _write_properties(ctid, {"server-name": name, "level-name": name, "level-seed": seed, "allow-cheats": "false"})

    # Pre-create the new world folder with the same add-ons enabled; BDS generates the world into it.
    if pack_lists:
        _ct_sh(ctid, 'mkdir -p "/opt/bedrock/worlds/$1" && chown minecraft:minecraft "/opt/bedrock/worlds/$1"', name)
        for fn, content in pack_lists.items():
            _ct_sh(ctid, 'printf "%s" "$3" > "/opt/bedrock/worlds/$1/$2" && chown minecraft:minecraft "/opt/bedrock/worlds/$1/$2"', name, fn, content)
        print(f"[reset] {world_id}: carried over {len(pack_lists)} add-on list(s) into the new world", flush=True)

    # 4. Start BDS and wait for the new world to generate
    run(f"pct exec {ctid} -- systemctl start bedrock", timeout=60)
    started = False
    for _ in range(24):
        time.sleep(5)
        _, code = run_argv(["pct", "exec", str(ctid), "--", "grep", "-q", "Server started", "/opt/bedrock/logs/server.log"])
        if code == 0:
            started = True
            break

    # 5. Registry
    cfg = load_config()
    world = next((w for w in cfg["worlds"] if w["id"] == world_id), None)
    if world:
        world["name"] = name
        save_config(cfg)
    _worlds_cache["data"] = None
    _seed_cache.pop(world["ctid"], None)
    print(f"[reset] {world_id}: new world '{name}' seed='{seed or 'random'}' started={started}", flush=True)
    return {"success": True, "world": world, "archivedTo": archive, "started": started}


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


def _swr(cache, ttl, compute, max_stale=60):
    """Stale-while-revalidate: a fresh entry is returned as is; a stale one (younger than max_stale)
    is returned immediately while one background thread recomputes it, so page loads never wait on
    the slow pct/journal probes. No entry (first call, or invalidated by an action) computes inline."""
    now = time.time()
    data, age = cache.get("data"), now - cache.get("time", 0)
    if data is not None and age < ttl:
        return data
    if data is not None and age < max_stale:
        lock = cache.setdefault("lock", threading.Lock())
        if lock.acquire(blocking=False):
            def refresh():
                try:
                    fresh = compute()
                    cache["data"], cache["time"] = fresh, time.time()
                except Exception as e:
                    print(f"[cache] background refresh failed: {e}", flush=True)
                finally:
                    lock.release()
            threading.Thread(target=refresh, daemon=True).start()
        return data
    fresh = compute()
    cache["data"], cache["time"] = fresh, time.time()
    return fresh

# ============ WORLD SEED ============
_seed_cache = {}   # ctid -> {"level": level-name, "seed": str | None, "time": epoch}
_SEED_TTL = 600    # the seed only changes on reset, which clears the entry explicitly

def _nbt_le_root(buf):
    """Parse a Bedrock level.dat (8-byte header, then little-endian NBT) into plain Python
    values and return the root compound. Byte/int/long arrays are skipped (not needed)."""
    pos = [8]
    def rd(fmt):
        v = struct.unpack_from("<" + fmt, buf, pos[0]); pos[0] += struct.calcsize("<" + fmt); return v[0]
    def rstr():
        n = rd("H"); v = buf[pos[0]:pos[0] + n].decode("utf-8", "replace"); pos[0] += n; return v
    def payload(t):
        if t == 1: return rd("b")
        if t == 2: return rd("h")
        if t == 3: return rd("i")
        if t == 4: return rd("q")
        if t == 5: return rd("f")
        if t == 6: return rd("d")
        if t == 7: n = rd("i"); pos[0] += n; return None
        if t == 8: return rstr()
        if t == 9:
            et = rd("b"); n = rd("i"); return [payload(et) for _ in range(n)]
        if t == 10:
            c = {}
            while True:
                t2 = rd("b")
                if t2 == 0: return c
                k = rstr(); c[k] = payload(t2)
        if t == 11: n = rd("i"); pos[0] += 4 * n; return None
        if t == 12: n = rd("i"); pos[0] += 8 * n; return None
        raise ValueError(f"bad NBT tag {t}")
    t = rd("b"); rstr()
    return payload(t) if t == 10 else {}

def _world_seed(w, running):
    """The world's seed as a string (64-bit values don't survive JSON -> JS numbers). Read from the
    level's level.dat inside the container (needs a running CT), falling back to level-seed in
    server.properties while the world is still generating. Cached per container; an unknown seed is
    retried after 30 s instead of the full TTL."""
    ctid = w["ctid"]; now = time.time()
    cached = _seed_cache.get(ctid)
    if cached and (now - cached["time"]) < _SEED_TTL:
        return cached["seed"]
    if not running:
        return cached["seed"] if cached else None
    out, code = run_argv(["pct", "exec", str(ctid), "--", "bash", "-c",
        'cd /opt/bedrock || exit 1; L=$(sed -n "s/^level-name=//p" server.properties | head -n1); '
        'echo "$L"; sed -n "s/^level-seed=//p" server.properties | head -n1; '
        'base64 -w0 "worlds/$L/level.dat" 2>/dev/null'], timeout=15)
    if code != 0:
        return cached["seed"] if cached else None
    level, prop_seed, b64 = ((out.split("\n") + ["", "", ""])[:3])
    level, prop_seed, b64 = level.strip(), prop_seed.strip(), b64.strip()
    seed = None
    if b64:
        try:
            root = _nbt_le_root(base64.b64decode(b64))
            if root.get("RandomSeed") is not None:
                seed = str(root["RandomSeed"])
        except Exception as e:
            print(f"[seed] CT {ctid}: level.dat parse failed: {e}", flush=True)
    if seed is None and prop_seed:
        seed = prop_seed
    _seed_cache[ctid] = {"level": level, "seed": seed, "time": now if seed else now - _SEED_TTL + 30}
    return seed

# ============ XBOX BRIDGE PER ACCOUNT ============
_xbox_info_cache = {}   # account -> {"data": {...}, "time": epoch}
_XBOX_INFO_TTL = 60

def _xbox_info(account):
    """Which gamertag advertises this world on the Xbox friends tab, and whether its MCXboxBroadcast
    unit in CT 105 is running. The gamertag comes from the unit's journal since its last start. Cached 60 s."""
    svc = _MCX_SERVICE_BY_ACCOUNT.get(account or "")
    if not svc:
        return None
    now = time.time()
    c = _xbox_info_cache.get(account)
    if c and (now - c["time"]) < _XBOX_INFO_TTL:
        return c["data"]
    script = (f'st=$(systemctl is-active {svc}); since=$(systemctl show {svc} -p ActiveEnterTimestamp --value); tag=""; '
              f'[ -n "$since" ] && tag=$(journalctl -u {svc} --since "$since" --no-pager -o cat 2>/dev/null '
              '| grep -a -o "authenticated as [A-Za-z0-9 ]*" | tail -n1 | cut -d" " -f3-); echo "$st|$tag"')
    out, code = run_argv(["pct", "exec", str(_MCX_CTID), "--", "bash", "-c", script], timeout=20)
    data = {"account": account, "service": svc, "active": False, "gamertag": None}
    if code == 0 and "|" in out:
        st, tag = out.strip().split("|", 1)
        data["active"] = (st.strip() == "active")
        data["gamertag"] = tag.strip() or None
    _xbox_info_cache[account] = {"data": data, "time": now}
    return data

# ============ XBOX BRIDGE HEALTH + RESTART ============
_mcx_bridges_cache = {"data": None, "time": 0}
_MCX_BRIDGES_TTL = 15
_ANSI_RE = _re.compile(r"\x1b\[[0-9;]*m")

def mcx_bridges():
    """Per-bridge health for the dashboard: running, signed-in gamertag, last session check-in
    (the bridge refreshes its Xbox session every ~30 s), last console hand-off, recent errors, and
    whether its game protocol matches the worlds. A bridge can still fail silently while all of
    this looks fine (2026-10-12), which is what the restart action is for."""
    return _swr(_mcx_bridges_cache, _MCX_BRIDGES_TTL, _compute_bridges)


def _compute_bridges():
    now = time.time()
    cfg = load_config()
    world_by_account = {w.get("xboxAccount"): w for w in cfg["worlds"] if w.get("xboxAccount")}
    bridges = []
    for account, svc in _MCX_SERVICE_BY_ACCOUNT.items():
        script = (f'st=$(systemctl is-active {svc}); since=$(systemctl show {svc} -p ActiveEnterTimestamp --value); '
                  f'echo "STATE|$st|$(systemctl show {svc} -p ActiveEnterTimestamp --value --timestamp=unix 2>/dev/null)"; '
                  f'if [ -n "$since" ]; then J=$(journalctl -u {svc} --since "$since" --no-pager -o short-unix 2>/dev/null); '
                  'echo "$J" | grep -a -m1 "Starting MCXboxBroadcast"; echo "$J" | grep -a -m1 "authenticated as"; '
                  'echo "$J" | grep -a "Updated session!" | tail -n 1; '
                  'echo "$J" | grep -a -E "Failed to update session|NetherNet Broadcaster started|Transferred bedrock client|websocket lost|Signaling Exception" | tail -n 60; fi')
        out, code = run_argv(["pct", "exec", str(_MCX_CTID), "--", "bash", "-c", script], timeout=20)
        b = {"account": account, "service": svc.replace(".service", ""), "active": False, "since": None, "gamertag": None,
             "build": None, "bridgeVersion": None, "bridgeProtocol": None,
             "lastCheckIn": None, "lastError": None, "lastErrorText": None, "lastHandoff": None, "lastHandoffPlayer": None, "lastSignalling": None}
        w = world_by_account.get(account)
        b["world"] = {"id": w["id"], "name": w["name"]} if w else None
        for line in (out or "").splitlines():
            if line.startswith("STATE|"):
                parts = line.split("|")
                b["active"] = len(parts) > 1 and parts[1].strip() == "active"
                try: b["since"] = int(float(parts[2].strip().lstrip("@"))) if len(parts) > 2 and parts[2].strip() else None
                except ValueError: b["since"] = None
                continue
            try:
                ts = int(float(line.split(" ", 1)[0]))
            except ValueError:
                continue
            msg = _ANSI_RE.sub("", line)
            if "Starting MCXboxBroadcast" in msg:
                m = _re.search(r"build (\d+).*?for Bedrock ([\d.]+) \((\d+)\)", msg)
                if m:
                    b["build"], b["bridgeVersion"], b["bridgeProtocol"] = int(m.group(1)), m.group(2), int(m.group(3))
            elif "authenticated as" in msg:
                m = _re.search(r"authenticated as (\S+)", msg)
                if m: b["gamertag"] = m.group(1)
            elif "Updated session!" in msg:
                b["lastCheckIn"] = ts
            elif "Transferred bedrock client" in msg:
                b["lastHandoff"] = ts
                m = _re.search(r"Transferred bedrock client (\S+)", msg)
                b["lastHandoffPlayer"] = m.group(1) if m else None
            elif "NetherNet Broadcaster started" in msg:
                b["lastSignalling"] = ts
            else:
                b["lastError"] = ts
                b["lastErrorText"] = "Couldn't update its Xbox session" if "Failed to update session" in msg else "Lost its connection to Xbox and reconnected"
        live = _raknet_ping(w["ip"], w.get("gamePort", 19132)) if w else None
        server_protocol = live["protocol"] if live else None
        b["protocol"] = {"bridge": b["bridgeProtocol"], "server": server_protocol, "bridgeVersion": b["bridgeVersion"], "build": b["build"],
                         "serverVersion": live["version"] if live else None,
                         "match": (b["bridgeProtocol"] == server_protocol) if (b["bridgeProtocol"] and server_protocol) else None}
        problem = None
        if not b["active"]:
            problem = "Not running"
        elif not b["gamertag"]:
            problem = "Not signed in to Xbox"
        elif not b["lastCheckIn"] or now - b["lastCheckIn"] > 120:
            problem = "No Xbox session check-in for over 2 minutes"
        elif b["lastError"] and now - b["lastError"] < 900 and (not b["lastSignalling"] or b["lastSignalling"] < b["lastError"]):
            problem = b["lastErrorText"] + " recently"
        elif b["protocol"]["match"] is False:
            problem = f"Game version mismatch: bridge speaks protocol {b['bridgeProtocol']}, world speaks {server_protocol}"
        b["healthy"] = problem is None
        b["problem"] = problem
        bridges.append(b)
    return bridges

def mcx_restart(account):
    """Restart one bridge (or 'all') and wait until it has signed in and recreated its Xbox session.
    Players already in a world are unaffected: after the hand-off they talk to the world directly."""
    accounts = list(_MCX_SERVICE_BY_ACCOUNT) if account == "all" else [account]
    results = []
    for acct in accounts:
        svc = _MCX_SERVICE_BY_ACCOUNT.get(acct)
        if not svc:
            return {"error": f"unknown bridge {acct!r}"}
        started = int(time.time())
        _, code = run_argv(["pct", "exec", str(_MCX_CTID), "--", "systemctl", "restart", svc], timeout=90)
        if code != 0:
            results.append({"account": acct, "success": False, "error": f"restart failed (exit {code})"}); continue
        ok, tag = False, None
        for _ in range(20):
            time.sleep(2)
            out, _ = run_argv(["pct", "exec", str(_MCX_CTID), "--", "bash", "-c",
                               f'journalctl -u {svc} --since "@{started}" --no-pager -o cat 2>/dev/null | grep -a -E "authenticated as|Creation of Xbox LIVE session was successful"'], timeout=20)
            clean = _ANSI_RE.sub("", out or "")
            m = _re.search(r"authenticated as (\S+)", clean)
            if m: tag = m.group(1)
            if "Creation of Xbox LIVE session was successful" in clean:
                ok = True; break
        print(f"[mcx] restart {svc} ({acct}) from dashboard: {'signed in as ' + tag if ok else 'not confirmed within 40 s'}", flush=True)
        results.append({"account": acct, "success": ok, "gamertag": tag, "error": None if ok else "Restarted, but it hasn't confirmed its Xbox session yet. Check again in a minute."})
    _mcx_bridges_cache["data"] = None
    for acct in accounts:
        _xbox_info_cache.pop(acct, None)
    return {"success": all(r["success"] for r in results), "results": results}

# ============ HOST BACKUPS PER WORLD ============
BACKUP_ROOT = "/var/backups/minecraft"   # written by scripts/daily-backup.sh (root crontab)

def list_world_backups(world_id):
    """Daily archives kept on the host for one world, plus the last run's summary and the cron schedule."""
    cfg = load_config()
    world = next((w for w in cfg["worlds"] if w["id"] == world_id), None)
    if world is None:
        return None
    d = os.path.join(BACKUP_ROOT, world_id)
    daily = []
    if os.path.isdir(d):
        for f in sorted(os.listdir(d), reverse=True):
            if f.endswith(".tar.gz"):
                st = os.stat(os.path.join(d, f))
                daily.append({"filename": f, "sizeBytes": st.st_size, "modified": int(st.st_mtime)})
    last_run = status = keep = None
    try:
        for line in open(os.path.join(BACKUP_ROOT, "last-run.txt")):
            if line.startswith("last run:"):
                m = _re.search(r"last run: (.+?)\s+exit: (\d+)\s+keep: (\d+)", line)
                if m:
                    last_run, keep = m.group(1).strip(), int(m.group(3))
            elif line.startswith(world_id + ":"):
                status = line.split(":", 1)[1].strip()
    except OSError:
        pass
    schedule = None
    out, _ = run("crontab -l 2>/dev/null | grep -F daily-backup.sh | grep -v '^#' | head -n1", timeout=5)
    m = _re.match(r"^\s*(\d+)\s+(\d+)\s", out)
    if m:
        schedule = f"{int(m.group(2)):02d}:{int(m.group(1)):02d}"
    safety = []
    sd = os.path.join(d, "pre-restore")
    if os.path.isdir(sd):
        for f in sorted(os.listdir(sd), reverse=True):
            if f.endswith(".tar.gz"):
                st = os.stat(os.path.join(sd, f))
                safety.append({"filename": f, "sizeBytes": st.st_size, "modified": int(st.st_mtime)})
    return {"enabled": world.get("backup", True),  # nightly job includes this world
            "daily": daily, "safety": safety, "lastRun": last_run, "lastStatus": status, "keep": keep, "schedule": schedule}


# ============ RESTORE A BACKUP ============
_BACKUP_NAME_RE = _re.compile(r"^[A-Za-z0-9][A-Za-z0-9 #'&+!(),._-]{0,120}\.tar\.gz$")
RESTORE_TMP = "/var/lib/minecraftlab/restore-tmp"
SAFETY_KEEP = 3
_restore_lock = threading.Lock()

def _ct_sh(ctid, script, *args, timeout=120):
    """bash -c inside a container, with values passed as positional args (world names contain spaces and '#')."""
    return run_argv(["pct", "exec", str(ctid), "--", "bash", "-c", script, "_", *[str(a) for a in args]], timeout=timeout)

def _check_world_archive(path):
    """Return the archive's single top folder if it holds a complete Bedrock world; raise ValueError otherwise."""
    try:
        with tarfile.open(path, "r:gz") as tf:
            members = tf.getmembers()
    except (tarfile.TarError, OSError, EOFError) as e:
        raise ValueError(f"the backup file is damaged ({e})")
    names = set()
    for m in members:
        n = m.name[2:] if m.name.startswith("./") else m.name
        if n.startswith("/") or ".." in n.split("/") or m.issym() or m.islnk() or m.isdev():
            raise ValueError(f"the backup contains an unsafe entry ({m.name})")
        names.add(n.rstrip("/"))
    tops = {n.split("/", 1)[0] for n in names if n}
    if len(tops) != 1:
        raise ValueError("the backup must contain exactly one world folder")
    top = tops.pop()
    if f"{top}/level.dat" not in names or f"{top}/db/CURRENT" not in names:
        raise ValueError("the backup is missing level.dat or db/CURRENT, so it isn't a complete world")
    return top

_STOP_BDS = """
pgrep -u minecraft bedrock_server >/dev/null || { echo NOTRUNNING; exit 0; }
sudo -u minecraft screen -S bedrock -p 0 -X stuff "stop$(printf '\\r')"
for i in $(seq 1 60); do sleep 1; pgrep -u minecraft bedrock_server >/dev/null || { echo STOPPED; exit 0; }; done
echo TIMEOUT; exit 1
"""

def _start_bds_and_wait(ctid, ip, port, timeout=120):
    """Start BDS and wait for 'Server started' in the log plus an answer to a status ping."""
    out, _ = _ct_sh(ctid, 'echo $(( $(wc -l < /opt/bedrock/logs/server.log) + 1 ))')
    start_line = int(out.strip()) if out.strip().isdigit() else 1
    run_argv(["pct", "exec", str(ctid), "--", "systemctl", "start", "bedrock"], timeout=60)
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(3)
        o, _ = _ct_sh(ctid, 'tail -n +"$1" /opt/bedrock/logs/server.log | grep -a -c "Server started"', start_line)
        if o.strip().isdigit() and int(o.strip()) > 0:
            # still alive a few seconds later = it loaded the world. The status ping is informational only:
            # a world with LAN visibility off doesn't answer it at all.
            time.sleep(5)
            alive, _ = _ct_sh(ctid, 'pgrep -u minecraft -c bedrock_server')
            if not (alive.strip().isdigit() and int(alive.strip()) > 0):
                return False
            print(f"[restore] CT {ctid}: started; status ping {'answered' if _raknet_ping(ip, port) else 'not answered'}", flush=True)
            return True
    return False

def restore_world_backup(world_id, source, filename, _hooks=None):
    """Replace a world's save with one of its backups (source 'daily' = nightly host archive, 'safety' = the
    copy saved before an earlier restore, 'manual' = a 'Back up now' archive inside the world container)."""
    cfg = load_config()
    w = next((x for x in cfg["worlds"] if x["id"] == world_id), None)
    if not w:
        return {"error": "world not found"}
    if source not in ("daily", "safety", "manual"):
        return {"error": "unknown backup source"}
    if not filename or "/" in filename or not _BACKUP_NAME_RE.match(filename):
        return {"error": "invalid backup name"}
    if not ct_status(w["ctid"]):
        return {"error": "Start the world first; its container is stopped."}
    lockf = open("/var/lock/mc-backup.lock", "a")
    try:
        try:
            fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"error": "The nightly backup is running right now. Try again in a minute."}
        if not _restore_lock.acquire(blocking=False):
            return {"error": "Another restore is already running."}
        try:
            return _restore_locked(w, source, filename, _hooks or {})
        finally:
            _restore_lock.release()
    finally:
        lockf.close()

def _restore_locked(w, source, filename, hooks):
    ctid, ip, wid = w["ctid"], w["ip"], w["id"]
    port, api_port = w.get("gamePort", 19132), w.get("apiPort", 8080)
    t0 = time.time()
    ts = time.strftime("%Y%m%d-%H%M%S")
    os.makedirs(RESTORE_TMP, exist_ok=True)
    work = os.path.join(RESTORE_TMP, f"{wid}-{ts}.tar.gz")
    log = lambda m: print(f"[restore] {wid}: {m}", flush=True)
    try:
        # 1. the archive, copied to a scratch file on the host, checked before anything is touched
        if source in ("daily", "safety"):
            base = os.path.realpath(os.path.join(BACKUP_ROOT, wid) + ("/pre-restore" if source == "safety" else ""))
            real = os.path.realpath(os.path.join(base, filename))
            if not real.startswith(base + os.sep) or not os.path.isfile(real):
                return {"error": "That backup doesn't exist any more."}
            shutil.copyfile(real, work)
        else:
            exists, _ = _ct_sh(ctid, '[ -s "/opt/bedrock/backups/$1" ] && echo YES', filename)
            if "YES" not in exists:
                return {"error": "That backup doesn't exist in the world any more."}
            _, code = run_argv(["pct", "pull", str(ctid), f"/opt/bedrock/backups/{filename}", work], timeout=180)
            if code != 0 or not os.path.isfile(work):
                return {"error": "Nothing was changed: couldn't copy that backup out of the world."}
        try:
            top = _check_world_archive(work)
        except ValueError as e:
            return {"error": f"Nothing was changed: {e}."}
        out, _ = _ct_sh(ctid, 'sed -n "s/^level-name=//p" /opt/bedrock/server.properties | head -n1')
        level = out.strip()
        if not level or "/" in level:
            return {"error": "Nothing was changed: couldn't read the world's folder name."}
        ach = bds_api_call(ip, api_port, "/achievements")
        keep_achievements = bool(isinstance(ach, dict) and ach.get("enabled"))
        log(f"restoring {source}/{filename} (folder {top!r}) into {level!r}; achievements on before: {keep_achievements}")

        # 2. stop the game (waits for it to finish saving)
        out, code = _ct_sh(ctid, _STOP_BDS, timeout=90)
        if code != 0:
            return {"error": "Nothing was changed: the world didn't stop within 60 seconds."}

        # 3. safety copy of the world as it is right now, on the host
        safety_name = None
        out, _ = _ct_sh(ctid, '[ -d "/opt/bedrock/worlds/$1" ] || { echo NOWORLD; exit 0; }; '
                              'tar -czf /tmp/pre-restore.tar.gz -C /opt/bedrock/worlds "$1" && echo OK', level, timeout=600)
        if "OK" in out:
            sdir = os.path.join(BACKUP_ROOT, wid, "pre-restore")
            os.makedirs(sdir, exist_ok=True)
            safety_name = f"{wid}_pre-restore_{ts}.tar.gz"
            spath = os.path.join(sdir, safety_name)
            run_argv(["pct", "pull", str(ctid), "/tmp/pre-restore.tar.gz", spath], timeout=300)
            _ct_sh(ctid, "rm -f /tmp/pre-restore.tar.gz")
            try:
                _check_world_archive(spath)
            except ValueError as e:
                _start_bds_and_wait(ctid, ip, port)
                return {"error": f"Nothing was changed: couldn't make a safety copy of the current world ({e})."}
            for old in sorted((f for f in os.listdir(sdir) if f.endswith(".tar.gz")), reverse=True)[SAFETY_KEEP:]:
                os.remove(os.path.join(sdir, old))
        elif "NOWORLD" not in out:
            _start_bds_and_wait(ctid, ip, port)
            return {"error": "Nothing was changed: couldn't make a safety copy of the current world."}

        # 4. swap the world folders (the current one is kept aside until the restored one starts)
        run_argv(["pct", "push", str(ctid), work, f"/tmp/restore-{ts}.tar.gz"], timeout=300)
        swap = """
set -e
cd /opt/bedrock
LEVEL="$1"; TS="$2"; TOP="$3"; NEW="/opt/bedrock/restore-new-$TS"; OLD="/opt/bedrock/restore-old-$TS"
rm -rf "$NEW"; mkdir -p "$NEW"
tar -xzf "/tmp/restore-$TS.tar.gz" -C "$NEW"
rm -f "/tmp/restore-$TS.tar.gz"
[ -f "$NEW/$TOP/level.dat" ] && [ -f "$NEW/$TOP/db/CURRENT" ] || { echo INCOMPLETE; exit 3; }
if [ -d "worlds/$LEVEL" ]; then mv "worlds/$LEVEL" "$OLD"; fi
mv "$NEW/$TOP" "worlds/$LEVEL"
chown -R minecraft:minecraft "worlds/$LEVEL"
rm -rf "$NEW"
echo SWAPPED
"""
        rollback = """
cd /opt/bedrock
LEVEL="$1"; TS="$2"; OLD="/opt/bedrock/restore-old-$TS"
if [ -d "$OLD" ]; then rm -rf "worlds/$LEVEL"; mv "$OLD" "worlds/$LEVEL"; fi
rm -rf "/opt/bedrock/restore-new-$TS" "/tmp/restore-$TS.tar.gz"
echo ROLLED_BACK
"""
        out, code = _ct_sh(ctid, swap, level, ts, top, timeout=600)
        if code != 0 or "SWAPPED" not in out:
            _ct_sh(ctid, rollback, level, ts, timeout=300)
            _start_bds_and_wait(ctid, ip, port)
            log(f"swap failed ({out.strip()[-120:]}), rolled back")
            return {"error": "The backup couldn't be put in place, so your world was left as it was."}

        # 5. keep the world's achievements setting (the backup may predate turning them on)
        if keep_achievements:
            try:
                bds_api_post(ip, api_port, "/achievements", {"enabled": True}, timeout=60)  # game stopped: patches files only
            except Exception as e:
                log(f"couldn't re-apply achievements: {e}")

        # 6. start and verify; put the old world back if the restored one won't start
        ok = (not hooks.get("fail_start")) and _start_bds_and_wait(ctid, ip, port)
        if not ok:
            _ct_sh(ctid, _STOP_BDS, timeout=90)
            _ct_sh(ctid, rollback, level, ts, timeout=300)
            started = _start_bds_and_wait(ctid, ip, port)
            log(f"restored world didn't start; rolled back (old world running again: {started})")
            return {"error": "The restored world didn't start, so your world was put back exactly as it was."
                             + ("" if started else " It also didn't come back up on its own; start it from the dashboard.")}
        _ct_sh(ctid, 'rm -rf "/opt/bedrock/restore-old-$1"', ts, timeout=300)
        _worlds_cache["data"] = None
        _seed_cache.pop(ctid, None)
        secs = round(time.time() - t0)
        log(f"done in {secs}s; safety copy {safety_name}")
        return {"success": True, "restored": filename, "safetyCopy": safety_name, "seconds": secs}
    finally:
        try:
            os.remove(work)
        except OSError:
            pass

def _fetch_world_status(w):
    running = ct_status(w["ctid"])
    entry = {**w, "running": running}
    if running:
        status = bds_api_call(w["ip"], w["apiPort"], "/status")
        if status:
            entry["bdsStatus"] = status
    entry["seed"] = _world_seed(w, running)
    entry["publicIp"] = _public_ip_cache.get("ip")   # kept warm by upnp_refresh_loop; never blocks here
    entry["xbox"] = _xbox_info(w.get("xboxAccount"))
    return entry

def _compute_worlds():
    cfg = load_config()
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_fetch_world_status, w): w for w in cfg["worlds"]}
        return [f.result() for f in futures]


def list_worlds():
    return _swr(_worlds_cache, _CACHE_TTL, _compute_worlds)


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


_MCX_RELEASE_CACHE = {"data": None, "time": 0}
_MCX_RELEASE_TTL = 900  # 15 minutes
_MCX_REPO_API = "https://api.github.com/repos/MCXboxBroadcast/Broadcaster/releases/latest"
_MCX_CTID = 105
_MCX_SERVICE_BY_ACCOUNT = {"primary": "mcxboxbroadcast.service", "secondary": "mcxboxbroadcast2.service"}

def _mcx_set_broadcaster(account, running):
    """Start or stop the MCXboxBroadcast instance bound to an Xbox account slot, in the
    background. A deleted world must not keep being advertised on the friends tab, and a
    new world bound to the slot should appear without waiting for the sync timer.
    Best-effort: sync-target.sh in CT 105 runs every minute and converges the state anyway."""
    svc = _MCX_SERVICE_BY_ACCOUNT.get(account or "")
    if not svc:
        return
    action = "start" if running else "stop"
    def _do():
        _, code = run_argv(["pct", "exec", str(_MCX_CTID), "--", "systemctl", action, svc], timeout=90)
        if not running:
            run_argv(["pct", "exec", str(_MCX_CTID), "--", "systemctl", "reset-failed", svc], timeout=30)
        print(f"[mcx] {action} {svc} ({account}): {'ok' if code == 0 else f'exit {code}'}", flush=True)
    threading.Thread(target=_do, daemon=True).start()
_MCX_JAR_ASSET_NAME = "MCXboxBroadcastStandalone.jar"
_MCX_REMOTE_JARS = [
    "/opt/mcxboxbroadcast/MCXboxBroadcast.jar",
    "/opt/mcxboxbroadcast2/MCXboxBroadcast.jar",
]


def _version_parts(version):
    if not version:
        return ()
    return tuple(int(part) for part in re.findall(r"\d+", str(version)))


def _version_matches_prefix(target, supported):
    target_parts = _version_parts(target)
    supported_parts = _version_parts(supported)
    if not target_parts or not supported_parts or len(target_parts) < len(supported_parts):
        return False
    return target_parts[:len(supported_parts)] == supported_parts


def _download_file(url, dest_path, timeout=180):
    """Atomic download: write to a temp name and rename into place only on
    success, so an interrupted transfer never leaves a truncated file at the
    final path (a truncated jar would otherwise be cached and reused forever)."""
    req = _urllib.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    tmp_path = f"{dest_path}.part-{os.getpid()}"
    try:
        with _urllib.urlopen(req, timeout=timeout) as resp, open(tmp_path, "wb") as f:
            shutil.copyfileobj(resp, f)
        os.replace(tmp_path, dest_path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# Runs inside CT105 as `bash -lc <script> mcx-probe <staged-jar>`. The jar is
# copied into a throwaway dir so the run never touches the installed jars or
# services; the trap cleans up both the workdir and the pushed jar.
_MCX_PROBE_SCRIPT = """\
set -eu
staged="$1"
workdir=$(mktemp -d /tmp/mcx-probe.XXXXXX)
trap 'rm -rf "$workdir" "$staged"' EXIT
cp /opt/mcxboxbroadcast/config.yml "$workdir/config.yml"
cp "$staged" "$workdir/MCXboxBroadcast.jar"
cd "$workdir"
timeout 12s java -jar MCXboxBroadcast.jar 2>&1 || true
"""


def _probe_mcx_supported_bedrock(jar_path):
    """Briefly launch the downloaded jar in a temp dir inside CT105 and parse
    its startup banner for the Bedrock version it targets."""
    remote_probe = f"/tmp/MCXboxBroadcast-probe-{threading.get_ident()}-{time.time_ns()}.jar"
    _, code = run_argv(["pct", "push", str(_MCX_CTID), jar_path, remote_probe], timeout=120)
    if code != 0:
        return None
    out, _ = run_argv(
        ["pct", "exec", str(_MCX_CTID), "--",
         "bash", "-lc", _MCX_PROBE_SCRIPT, "mcx-probe", remote_probe],
        timeout=40,
    )
    match = re.search(r"for Bedrock (\d+\.\d+\.\d+)", out or "")
    return match.group(1) if match else None


def fetch_latest_mcx_release(force=False):
    now = time.time()
    cached = _MCX_RELEASE_CACHE.get("data")
    if not force and cached and (now - _MCX_RELEASE_CACHE["time"]) < _MCX_RELEASE_TTL:
        return cached

    info = {
        "tag": None,
        "name": None,
        "assetUrl": None,
        "localJarPath": None,
        "supportedBedrock": None,
        "error": None,
    }
    try:
        req = _urllib.Request(_MCX_REPO_API, headers={"User-Agent": "Mozilla/5.0"})
        with _urllib.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read())
        info["tag"] = str(data.get("tag_name") or "").strip() or None
        info["name"] = data.get("name")
        asset = next((a for a in data.get("assets", []) if a.get("name") == _MCX_JAR_ASSET_NAME), None)
        if not asset:
            info["error"] = "MCXboxBroadcast standalone release asset not found"
        else:
            info["assetUrl"] = asset.get("browser_download_url")
            jar_name = f"MCXboxBroadcastStandalone-{info['tag'] or 'latest'}.jar"
            jar_path = os.path.join("/tmp", jar_name)
            if not os.path.exists(jar_path):
                _download_file(info["assetUrl"], jar_path, timeout=300)
            info["localJarPath"] = jar_path
            info["supportedBedrock"] = _probe_mcx_supported_bedrock(jar_path)
            if not info["supportedBedrock"]:
                info["error"] = f"Could not determine supported Bedrock version for MCXboxBroadcast release {info['tag'] or 'latest'}"
    except Exception as e:
        info["error"] = str(e)

    _MCX_RELEASE_CACHE.update({"data": info, "time": now})
    return info


def _mcx_bridges_match_live():
    """True when every Xbox bridge bound to a world speaks that world's live protocol — the same
    comparison the bridge menu displays. None when nothing could be compared (a bridge down, no
    world answering), which callers treat as "don't suppress"."""
    try:
        bound = [b for b in mcx_bridges() if b.get("world")]
    except Exception as e:
        print(f"[mcx] live bridge check failed: {e}", flush=True)
        return None
    matches = [b["protocol"]["match"] for b in bound]
    if not matches or any(m is None for m in matches):
        return None
    return all(matches)


def get_mcx_broadcaster_status(target_bds_version=None, force=False, worlds_current=None):
    """Describe the newest official MCXboxBroadcast release relative to a BDS version.
    `compatibleReleaseAvailable` (version-string match) drives auto-install after a BDS update.
    `warning` is only for the dashboard: it must not fire when the installed broadcaster already
    speaks the live server's protocol and no BDS update is pending (worlds_current=True), because
    version strings differ across same-protocol releases (e.g. build 154 "for 1.26.50" vs BDS 1.26.52.3).
    The protocol verdict comes from the watcher when it has one, otherwise from the same live check
    the bridge menu shows (the watcher's state is empty for ~30 s after every host-api restart, which
    made the banner contradict the menu on 2026-10-13)."""
    release = fetch_latest_mcx_release(force=force)
    supported = release.get("supportedBedrock")
    compatible = bool(target_bds_version and supported and _version_matches_prefix(target_bds_version, supported))
    warning = None
    if target_bds_version:
        if release.get("error") and not compatible:
            warning = release["error"]
        elif not release.get("assetUrl"):
            warning = "No official MCXboxBroadcast standalone release asset is available right now."
        elif not supported:
            warning = f"Couldn't determine what Bedrock version MCXboxBroadcast release {release.get('tag') or 'latest'} supports."
        elif not compatible:
            warning = (
                f"Official MCXboxBroadcast release {release.get('tag') or 'latest'} supports Bedrock {supported}, "
                f"but the latest Bedrock server release is {target_bds_version}. World updates can still run, "
                f"but the two Xbox bridge accounts will stay on their current broadcaster until a compatible official release exists."
            )
    if warning and not compatible and worlds_current:
        st = _mcx_watch_state
        if st.get("serverProtocol") is not None and st.get("broadcasterProtocol") is not None:
            bridges_ok = (st.get("mismatch") is False and st["serverProtocol"] == st["broadcasterProtocol"])
        else:
            bridges_ok = _mcx_bridges_match_live()
        if bridges_ok:
            warning = None  # bridge works with the live server; the newer release is optional
    return {
        "releaseTag": release.get("tag"),
        "releaseName": release.get("name"),
        "supportedBedrock": supported,
        "compatibleReleaseAvailable": compatible,
        "warning": warning,
        "assetUrl": release.get("assetUrl"),
        "localJarPath": release.get("localJarPath"),
    }


# Runs inside CT105 as `bash -lc <script> mcx-swap <staged> <hash> <suffix> <jar>...`.
# Validates the staged jar's checksum before touching either installed jar,
# backs up every differing jar first, and restores all backups if any install
# fails — so the two broadcaster services never end up on different jars.
# Deliberately no `set -e`: failures are handled explicitly so we can roll back.
_MCX_SWAP_SCRIPT = """\
exec 2>&1
set -uo pipefail
staged="$1"; want_hash="$2"; suffix="$3"; shift 3

fail() { echo "$1"; rm -f "$staged"; exit 1; }

got_hash=$(sha256sum "$staged" | cut -d' ' -f1) || fail "could not hash staged jar $staged"
[ "$got_hash" = "$want_hash" ] || fail "staged jar checksum mismatch: got $got_hash want $want_hash"

for jar in "$@"; do
  [ -f "$jar" ] || continue
  if [ "$(sha256sum "$jar" | cut -d' ' -f1)" != "$want_hash" ]; then
    cp -a "$jar" "$jar.$suffix" || fail "backup failed for $jar"
  fi
done

failed=""
for jar in "$@"; do
  install -m 0644 "$staged" "$jar" || { failed="$jar"; break; }
done
if [ -n "$failed" ]; then
  for jar in "$@"; do
    [ -f "$jar.$suffix" ] && cp -a "$jar.$suffix" "$jar"
  done
  fail "install failed for $failed — previous jars restored from backup"
fi
rm -f "$staged"

systemctl restart mcxboxbroadcast.service mcxboxbroadcast2.service || fail "failed to restart broadcaster services"
sleep 5
systemctl is-active mcxboxbroadcast.service mcxboxbroadcast2.service
"""


_mcx_install_lock = threading.Lock()

def _update_mcx_broadcasters(release_info):
    """Serialized: the watcher thread and a manual update run must never stage,
    install, or restart concurrently (they share the staged jar path in CT105
    and both restart the broadcaster services)."""
    with _mcx_install_lock:
        return _update_mcx_broadcasters_locked(release_info)

def _update_mcx_broadcasters_locked(release_info):
    jar_path = release_info.get("localJarPath")
    tag = release_info.get("releaseTag") or "latest"
    supported = release_info.get("supportedBedrock") or "unknown"
    if not jar_path or not os.path.exists(jar_path):
        return False, "MCXboxBroadcast release jar is missing"

    target_hash = _sha256_file(jar_path)
    remote_hashes = []
    for remote_path in _MCX_REMOTE_JARS:
        out, code = run_argv(["pct", "exec", str(_MCX_CTID), "--", "sha256sum", remote_path], timeout=20)
        if code != 0 or not out:
            return False, f"Could not read current broadcaster jar hash for {remote_path}"
        remote_hashes.append(out.split()[0])

    if remote_hashes and all(h == target_hash for h in remote_hashes):
        return True, f"MCXboxBroadcast release {tag} is already installed on both Xbox bridge services"

    # The tag comes from GitHub release metadata — never let it reach a shell
    # or form a path with separators in it.
    safe_tag = re.sub(r"[^A-Za-z0-9._-]", "_", tag)
    remote_upload = f"/tmp/MCXboxBroadcast-{safe_tag}.jar"
    _, code = run_argv(["pct", "push", str(_MCX_CTID), jar_path, remote_upload], timeout=120)
    if code != 0:
        return False, f"Could not push MCXboxBroadcast release {tag} into CT {_MCX_CTID}"
    backup_suffix = f"pre-{safe_tag}-{time.strftime('%Y%m%d-%H%M%S')}"
    out, code = run_argv(
        ["pct", "exec", str(_MCX_CTID), "--",
         "bash", "-lc", _MCX_SWAP_SCRIPT, "mcx-swap",
         remote_upload, target_hash, backup_suffix, *_MCX_REMOTE_JARS],
        timeout=90,
    )
    if code != 0:
        return False, out or "Failed to update MCXboxBroadcast jars"
    return True, f"Updated MCXboxBroadcast release {tag} for Bedrock {supported}"


# ============ MCX PROTOCOL WATCHER ============
# Compares the LIVE protocol of the running worlds (RakNet unconnected ping)
# against the protocol the MCXboxBroadcast bridges actually speak (their
# startup banner). When they diverge — e.g. a BDS update landed before a
# compatible broadcaster release existed, as on 2026-08-28 — console
# friend-joins fail with "the host is using an older version of minecraft".
# This watcher keeps polling GitHub until a release whose codec matches the
# live worlds appears, then installs it via _update_mcx_broadcasters.

_MCX_WATCH_INTERVAL = 300  # seconds between checks
_MCX_RELEASE_LIST_API = "https://api.github.com/repos/MCXboxBroadcast/Broadcaster/releases?per_page=6"
_MCX_PROBE_RETRY_SECS = 6 * 3600  # re-probe a release whose banner didn't parse this often

_RAKNET_MAGIC = bytes.fromhex("00ffff00fefefefefdfdfdfd12345678")

_mcx_probe_results = {}  # release tag -> {"version", "protocol", "jarPath", "error", "time"}
_mcx_last_outcome = {"msg": None}
_mcx_watch_state = {
    "lastCheck": None,
    "mismatch": False,
    "serverVersion": None,
    "serverProtocol": None,
    "serverWorld": None,
    "broadcasterBuild": None,
    "broadcasterVersion": None,
    "broadcasterProtocol": None,
    "message": None,
    "lastInstall": None,
    "lastInstallTag": None,
    "log": [],
}


def _mcx_watch_log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    _mcx_watch_state["log"].append(line)
    del _mcx_watch_state["log"][:-80]
    print(f"[mcx-watch] {msg}", flush=True)


def _raknet_ping(ip, port, timeout=3.0, attempts=2):
    """Unconnected-ping a Bedrock server; return {motd, protocol, version} or None."""
    import socket as _socket
    for _ in range(attempts):
        sock = _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        try:
            ts = int(time.time() * 1000) & 0xFFFFFFFFFFFFFFFF
            pkt = b"\x01" + ts.to_bytes(8, "big") + _RAKNET_MAGIC + b"\xab\xcd\xef\x01\x23\x45\x67\x89"
            sock.sendto(pkt, (ip, port))
            deadline = time.time() + timeout
            while time.time() < deadline:
                sock.settimeout(max(0.1, deadline - time.time()))
                try:
                    data, _addr = sock.recvfrom(4096)
                except _socket.timeout:
                    break
                if data and data[0] == 0x1C and len(data) >= 35:
                    strlen = int.from_bytes(data[33:35], "big")
                    fields = data[35:35 + strlen].decode("utf-8", "replace").split(";")
                    # MCPE;<motd>;<protocol>;<version>;<online>;<max>;...
                    if len(fields) >= 4 and fields[2].isdigit():
                        return {"motd": fields[1], "protocol": int(fields[2]), "version": fields[3]}
        except OSError:
            pass
        finally:
            sock.close()
    return None


def _get_live_server_protocols():
    """Ping every configured world over the LAN; return a list of
    (protocol, version, world-name) for the worlds that answered."""
    try:
        cfg = load_config()
    except Exception:
        return []
    results = []
    for w in cfg.get("worlds", []):
        try:
            pong = _raknet_ping(w.get("ip"), int(w.get("gamePort", 19132)))
        except Exception:
            pong = None
        if pong:
            results.append((pong["protocol"], pong["version"], w.get("name")))
    return results


# The banner is printed once at service start, so scan the journal only from
# the service's last start (grep -m1 closes the pipe early). An unbounded scan
# would grow with the journal and eventually exceed the exec timeout.
_MCX_BANNER_SCRIPT = (
    'ts=$(systemctl show mcxboxbroadcast.service -p ActiveEnterTimestamp --value); '
    '[ -n "$ts" ] || exit 1; '
    'journalctl -u mcxboxbroadcast.service --since "$ts" --no-pager -o cat '
    "| grep -a -m1 'Starting MCXboxBroadcast'"
)


def _get_broadcaster_protocol():
    """Parse the running broadcaster's startup banner for (build, version, protocol)."""
    out, code = run_argv(
        ["pct", "exec", str(_MCX_CTID), "--", "bash", "-lc", _MCX_BANNER_SCRIPT],
        timeout=25,
    )
    if code != 0 or not out:
        return None, None, None
    m = re.search(r"build (\d+).*?for Bedrock (\d+\.\d+(?:\.\d+)*) \((\d+)\)", out)
    if not m:
        return None, None, None
    return int(m.group(1)), m.group(2), int(m.group(3))


def _probe_mcx_release(tag, asset_url, expected_size=None):
    """Download + banner-probe one release jar; cache the result per tag.
    Infrastructure failures are marked transient (retried next tick); a banner
    that genuinely doesn't parse is retried only every _MCX_PROBE_RETRY_SECS."""
    def _jar_ok(path):
        return bool(path) and os.path.exists(path) and (not expected_size or os.path.getsize(path) == expected_size)
    cached = _mcx_probe_results.get(tag)
    if cached:
        if cached.get("protocol") and _jar_ok(cached.get("jarPath")):
            return cached
        if cached.get("error") and (time.time() - cached["time"]) < (300 if cached.get("transient") else _MCX_PROBE_RETRY_SECS):
            return cached
    result = {"version": None, "protocol": None, "jarPath": None, "error": None, "transient": False, "time": time.time()}
    try:
        safe_tag = re.sub(r"[^A-Za-z0-9._-]", "_", str(tag))
        jar_path = os.path.join("/tmp", f"MCXboxBroadcastStandalone-{safe_tag}.jar")
        if not _jar_ok(jar_path):
            _download_file(asset_url, jar_path, timeout=300)
        result["jarPath"] = jar_path
        remote_probe = f"/tmp/MCXboxBroadcast-probe-{threading.get_ident()}-{time.time_ns()}.jar"
        _, code = run_argv(["pct", "push", str(_MCX_CTID), jar_path, remote_probe], timeout=120)
        if code != 0:
            result["error"] = "could not push probe jar into CT105"
            result["transient"] = True
        else:
            out, _ = run_argv(
                ["pct", "exec", str(_MCX_CTID), "--",
                 "bash", "-lc", _MCX_PROBE_SCRIPT, "mcx-probe", remote_probe],
                timeout=40,
            )
            m = re.search(r"for Bedrock (\d+\.\d+(?:\.\d+)*) \((\d+)\)", out or "")
            if m:
                result["version"], result["protocol"] = m.group(1), int(m.group(2))
            else:
                result["error"] = "startup banner did not reveal a Bedrock version"
    except Exception as e:
        result["error"] = str(e)
        result["transient"] = True
    _mcx_probe_results[tag] = result
    return result


def _mcx_hunt_and_install(server_protocol):
    """Scan recent releases newest-first; install the first whose codec protocol
    matches the live worlds. Returns a human-readable outcome string."""
    try:
        req = _urllib.Request(_MCX_RELEASE_LIST_API, headers={"User-Agent": "Mozilla/5.0"})
        with _urllib.urlopen(req, timeout=20) as resp:
            releases = json.loads(resp.read())
    except Exception as e:
        return f"GitHub release list unavailable: {e}"
    if not isinstance(releases, list):
        return "GitHub release list unavailable (unexpected response)"

    for rel in releases:
        tag = str(rel.get("tag_name") or "").strip()
        asset = next((a for a in rel.get("assets", []) if a.get("name") == _MCX_JAR_ASSET_NAME), None)
        if not tag or not asset:
            continue
        probe = _probe_mcx_release(tag, asset.get("browser_download_url"), asset.get("size"))
        if probe.get("error") and not probe.get("protocol") and (time.time() - probe["time"]) < _MCX_WATCH_INTERVAL:
            _mcx_watch_log(f"probe of release {tag}: {probe['error']}")
        if probe.get("protocol") != server_protocol:
            continue
        if _update_state.get("running"):
            return "manual update run started — deferring broadcaster install to it"
        info = {
            "localJarPath": probe.get("jarPath"),
            "releaseTag": tag,
            "supportedBedrock": probe.get("version"),
        }
        ok, message = _update_mcx_broadcasters(info)
        if ok:
            _mcx_watch_state["lastInstall"] = f"{tag} ({time.strftime('%Y-%m-%d %H:%M:%S')})"
            _mcx_watch_state["lastInstallTag"] = tag
            return f"installed release {tag} (Bedrock {probe.get('version')}, protocol {probe.get('protocol')}): {message}"
        return f"release {tag} matches but install failed: {message}"
    return f"no release matching protocol {server_protocol} yet"


_mcx_forced_restart = {"tag": None}
_mcx_hunt_skip = {"n": 0}


def _mcx_watch_tick():
    pongs = _get_live_server_protocols()
    bb, bv, bp = _get_broadcaster_protocol()
    st = _mcx_watch_state
    st["lastCheck"] = time.strftime("%Y-%m-%d %H:%M:%S")
    if bp:
        st["broadcasterBuild"], st["broadcasterVersion"], st["broadcasterProtocol"] = bb, bv, bp
    if not pongs or not bp:
        # can't see one side (worlds down mid-update, journal unreadable, ...);
        # keep the previous verdict rather than flapping
        return
    protocols = {p for p, _, _ in pongs}
    sp, sv, world = pongs[0]
    st["serverProtocol"], st["serverVersion"], st["serverWorld"] = sp, sv, world
    if len(protocols) > 1:
        # worlds disagree (one likely mid-update) — one jar can't match both
        detail = ", ".join(f"{n} = {v} ({p})" for p, v, n in pongs)
        st["mismatch"] = bp not in protocols
        st["message"] = (
            f"The worlds are on different Bedrock versions ({detail}) — the Xbox bridge "
            f"accounts can only match one at a time; auto-fix is paused until the worlds agree."
        )
        return
    mismatch = sp != bp
    if mismatch and not st["mismatch"]:
        _mcx_watch_log(
            f"MISMATCH: worlds speak Bedrock {sv} (protocol {sp}) but broadcasters "
            f"(build {bb}) speak {bv} ({bp}) — console friend-joins are broken; hunting for a fix"
        )
    elif not mismatch and st["mismatch"]:
        _mcx_watch_log(f"resolved: broadcasters now match the worlds (Bedrock {bv}, protocol {bp})")
        _mcx_last_outcome["msg"] = None
    st["mismatch"] = mismatch
    if not mismatch:
        st["message"] = None
        return
    st["message"] = (
        f"Console/PS5 friend-joins are DOWN: the Xbox broadcast accounts are on Bedrock {bv} "
        f"(protocol {bp}) but the worlds run {sv} (protocol {sp}). Joining from a friends-list "
        f"tile fails with 'the host is using an older version of Minecraft' until a matching "
        f"MCXboxBroadcast release ships — this server checks for one every few minutes."
    )
    if _update_state.get("running"):
        return  # a manual update run is active; it does its own broadcaster install
    if _mcx_hunt_skip["n"] > 0:
        _mcx_hunt_skip["n"] -= 1
        return
    outcome = _mcx_hunt_and_install(sp)
    if outcome.startswith("no release matching"):
        _mcx_hunt_skip["n"] = 1  # ease off the GitHub API: hunt every other tick
    if outcome != _mcx_last_outcome["msg"]:
        _mcx_watch_log(outcome)
        _mcx_last_outcome["msg"] = outcome
    if outcome.startswith("installed"):
        bb2, bv2, bp2 = _get_broadcaster_protocol()
        if bp2:
            st["broadcasterBuild"], st["broadcasterVersion"], st["broadcasterProtocol"] = bb2, bv2, bp2
            st["mismatch"] = bp2 != sp
        tag = st.get("lastInstallTag")
        if st["mismatch"] and tag and _mcx_forced_restart["tag"] != tag:
            # jars are on disk but the running processes still speak the old
            # protocol (an earlier install's restart step must have failed) —
            # force one restart per tag, never a loop
            _mcx_forced_restart["tag"] = tag
            _mcx_watch_log("services still on the old protocol after install — forcing a restart")
            run_argv(["pct", "exec", str(_MCX_CTID), "--", "systemctl", "restart",
                      "mcxboxbroadcast.service", "mcxboxbroadcast2.service"], timeout=90)
            time.sleep(8)
            bb3, bv3, bp3 = _get_broadcaster_protocol()
            if bp3:
                st["broadcasterBuild"], st["broadcasterVersion"], st["broadcasterProtocol"] = bb3, bv3, bp3
                st["mismatch"] = bp3 != sp
        if not st["mismatch"]:
            st["message"] = None
            _mcx_watch_log(
                f"resolved: broadcasters now on build {st['broadcasterBuild']} "
                f"(Bedrock {st['broadcasterVersion']}, protocol {st['broadcasterProtocol']})"
            )


def mcx_watch_loop():
    time.sleep(20)
    _mcx_watch_log("protocol watcher started")
    while True:
        try:
            _mcx_watch_tick()
        except Exception as e:
            print(f"[mcx-watch] tick failed: {e}", flush=True)
        time.sleep(_MCX_WATCH_INTERVAL)


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
            "needsUpdate": bool(latest and ((not current) or current != latest)),
        })
    worlds_current = bool(worlds) and not any(w["needsUpdate"] for w in worlds)
    return {"latest": latest, "worlds": worlds,
            "broadcaster": get_mcx_broadcaster_status(latest, worlds_current=worlds_current)}

_update_state = {"running": False, "log": [], "startedAt": None, "finishedAt": None}

def _update_log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    _update_state["log"].append(line)
    print(f"[updates] {msg}")

def _update_ct_in_place(ctid, label, current, latest, zip_path):
    """Refresh BDS inside a normally-stopped container (standby/template) without bds-update.sh,
    which would `systemctl start bedrock`. Starts the CT if needed and returns it to stopped."""
    _update_log(f"[{label} CT {ctid}] Updating {current or 'unknown'} -> {latest}")
    status_out, _ = run(f"pct status {ctid}")
    was_running = "running" in (status_out or "")
    try:
        if not was_running:
            run(f"pct start {ctid}", timeout=30)
            time.sleep(4)
        run(f"pct push {ctid} {zip_path} /tmp/bds.zip", timeout=120)
        run(f'''pct exec {ctid} -- bash -c '
            cd /opt/bedrock
            unzip -o /tmp/bds.zip -x "worlds/*" "server.properties" "allowlist.json" "permissions.json" "valid_known_packs.json" -d . > /dev/null
            chmod +x bedrock_server
            echo "{latest}" > version.txt
            chown -R minecraft:minecraft /opt/bedrock
            rm -f /tmp/bds.zip
        '
        ''', timeout=120)
        _update_log(f"[{label} CT {ctid}] Updated successfully")
        return True
    except Exception as e:
        _update_log(f"[{label} CT {ctid}] FAILED: {e}")
        return False
    finally:
        if not was_running:
            run(f"pct stop {ctid}", timeout=30)


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
        updated_any = False
        for w in targets:
            current = get_world_version(w["ctid"])
            if (not current) or current != latest:
                needs.append((w, current or "unknown"))

        # Standby is tracked separately from cfg["worlds"], but we want to keep it
        # on latest BDS too — otherwise the next world created from it ships stale
        # (and goes through fix #1's catch-up sync at click time, which is slower).
        # The standby and the template aren't in cfg["worlds"] but must track latest too, or the
        # next world ships stale BDS. Both are normally stopped, so their version reads as unknown
        # and they get refreshed on every update run (cheap: unzip over the install).
        world_ctids = [w["ctid"] for w in cfg["worlds"]]
        extras = []
        standby_ctid = cfg.get("standbyCtid")
        if standby_ctid and ct_exists(standby_ctid):
            extras.append((standby_ctid, "standby"))
        template_ctid = _template_ctid(cfg)
        if template_ctid and template_ctid not in world_ctids and ct_exists(template_ctid):
            extras.append((template_ctid, "template"))
        extras = [(c, label, get_world_version(c)) for c, label in extras]
        extras = [(c, label, cur) for c, label, cur in extras if (not cur) or cur != latest]

        if not needs and not extras:
            _update_log("All worlds, standby and template already up to date")
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
                updated_any = True
            except Exception as e:
                _update_log(f"[{w['id']}] FAILED: {e}")

        for extra_ctid, label, current in extras:
            if _update_ct_in_place(extra_ctid, label, current, latest, zip_path):
                updated_any = True

        if updated_any:
            broadcaster = get_mcx_broadcaster_status(latest, force=True)
            if broadcaster.get("compatibleReleaseAvailable"):
                ok, message = _update_mcx_broadcasters(broadcaster)
                if ok:
                    _update_log(f"[mcxboxbroadcast] {message}")
                else:
                    _update_log(f"[mcxboxbroadcast] FAILED: {message}")
            else:
                _update_log(f"[mcxboxbroadcast] WARNING: {broadcaster.get('warning') or 'No compatible official MCXboxBroadcast release is available yet'}")
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


# ============ ADDON LIBRARY ============
#
# Server-side catalog of add-ons (CurseForge-downloaded, user-uploaded, or
# Claude-built). One library lives on the host and per-world installs copy
# from it via `pct push` + bds-api `/addons/install-local`. The on-disk shape
# is deliberately simple: one folder per entry, with meta.json describing the
# entry and archive.mcaddon as the source archive. No central index file —
# `list_library()` walks the directory.

LIBRARY_DIR = "/var/lib/minecraftlab/library"

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slug_id(name):
    base = _SLUG_RE.sub("-", (name or "").lower()).strip("-") or "addon"
    h = hashlib.sha1((name or "").encode("utf-8")).hexdigest()[:8]
    return f"{base[:48]}-{h}"


def library_path(library_id):
    if not library_id or "/" in library_id or library_id in (".", ".."):
        raise ValueError("invalid library id")
    return os.path.join(LIBRARY_DIR, library_id)


def _read_library_meta(library_id):
    path = os.path.join(library_path(library_id), "meta.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _write_library_meta(library_id, meta):
    d = library_path(library_id)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "meta.json")
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(meta, f, indent=2)
    os.replace(tmp, path)


_TRAILING_COMMA_RE = re.compile(r",(\s*[}\]])")


def loads_lenient(text):
    """Parse a pack manifest the way the game does: Bedrock accepts // and /* */ comments, a BOM,
    trailing commas and junk after the closing brace, and plenty of popular add-ons ship with them."""
    if isinstance(text, bytes):
        text = text.decode("utf-8-sig", errors="replace")
    text = text.lstrip("﻿")
    out, i, n, in_str = [], 0, len(text), False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1]); i += 2; continue
            if c == '"':
                in_str = False
            i += 1
        elif c == '"':
            in_str = True; out.append(c); i += 1
        elif text.startswith("//", i):
            j = text.find("\n", i); i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2); i = n if j < 0 else j + 2
        else:
            out.append(c); i += 1
    cleaned = _TRAILING_COMMA_RE.sub(r"\1", "".join(out)).strip()
    return json.JSONDecoder().raw_decode(cleaned)[0]


def _packs_in_zip(path):
    """Return [{uuid, name, version, type}] for every manifest.json found in
    a single pack archive. Handles manifests at any depth (single-pack and
    multi-pack-subdirectory layouts both work)."""
    results = []
    with zipfile.ZipFile(path, "r") as zf:
        manifest_paths = [
            n for n in zf.namelist()
            if os.path.basename(n.rstrip("/")) == "manifest.json" and not n.endswith("/")
        ]
        for mp in manifest_paths:
            try:
                manifest = loads_lenient(zf.read(mp))
            except Exception:
                continue
            header = manifest.get("header", {})
            modules = manifest.get("modules") or []
            module_type = ""
            for m in modules:
                if m.get("type") in ("data", "resources", "script"):
                    module_type = m.get("type")
                    break
            if not module_type and modules:
                module_type = modules[0].get("type", "")
            deps = manifest.get("dependencies") or []
            results.append({
                "uuid": header.get("uuid"),
                "name": header.get("name", ""),
                "version": header.get("version", []),
                "type": module_type,
                # script modules pinned to a "-beta" version only load with the Beta APIs experiment on
                "beta": any(d.get("module_name") and "beta" in str(d.get("version", "")) for d in deps if isinstance(d, dict)),
            })
    return results


def parse_archive_packs(archive_path):
    """Inspect a .mcaddon (or .mcpack) and return pack info without installing.
    Mirrors the dispatch logic in bds-api `extract_pack_archives` (outer zip
    containing inner .mcpack/.mcaddon entries vs. outer being a pack itself)."""
    packs = []
    with tempfile.TemporaryDirectory() as work:
        try:
            with zipfile.ZipFile(archive_path, "r") as zf:
                names = zf.namelist()
                inner_packs = [n for n in names if n.lower().endswith((".mcpack", ".mcaddon"))]

                if inner_packs:
                    for n in inner_packs:
                        inner = os.path.join(work, os.path.basename(n))
                        with zf.open(n) as src, open(inner, "wb") as dst:
                            shutil.copyfileobj(src, dst)
                        try:
                            packs.extend(_packs_in_zip(inner))
                        except zipfile.BadZipFile:
                            continue
                else:
                    packs.extend(_packs_in_zip(archive_path))
        except zipfile.BadZipFile:
            raise ValueError("invalid zip archive")
    return [p for p in packs if p.get("uuid")]


def list_library():
    if not os.path.isdir(LIBRARY_DIR):
        return []
    entries = []
    for name in sorted(os.listdir(LIBRARY_DIR)):
        d = os.path.join(LIBRARY_DIR, name)
        if not os.path.isdir(d):
            continue
        meta = _read_library_meta(name)
        if meta:
            entries.append(meta)
    return entries


def get_library_entry(library_id):
    return _read_library_meta(library_id)


def delete_library_entry(library_id):
    d = library_path(library_id)
    real = os.path.realpath(d)
    library_root = os.path.realpath(LIBRARY_DIR)
    if not real.startswith(library_root + os.sep):
        raise ValueError("invalid library id")
    if not os.path.isdir(real):
        raise FileNotFoundError(f"library entry not found: {library_id}")
    shutil.rmtree(real)


def _build_meta_from_archive(library_id, archive_path, name, payload, type_):
    packs = parse_archive_packs(archive_path)
    if not packs:
        raise ValueError("no packs found in archive")
    version = ".".join(str(v) for v in (packs[0].get("version") or []))
    meta = {
        "id": library_id,
        "name": name,
        "description": (payload.get("description") or "").strip(),
        "version": version,
        "type": type_,
        "author": (payload.get("author") or "").strip(),
        "thumbUrl": (payload.get("thumbUrl") or "").strip(),
        "source": payload.get("source") or {},
        "packs": [
            {"uuid": p["uuid"], "name": p.get("name", ""), "type": p.get("type", "")}
            for p in packs
        ],
        "packUuids": [p["uuid"] for p in packs],
        "needsBetaApis": any(p.get("beta") for p in packs),
        "sizeBytes": os.path.getsize(archive_path),
        "addedAt": datetime.now().isoformat(),
    }
    return meta


def download_to_library_from_curseforge(payload):
    """Download a CurseForge file URL into the library."""
    file_url = (payload.get("fileUrl") or "").strip()
    name = (payload.get("name") or "").strip()
    if not file_url:
        raise ValueError("missing fileUrl")
    if not name:
        raise ValueError("missing name")

    library_id = slug_id(name)
    target_dir = library_path(library_id)
    os.makedirs(target_dir, exist_ok=True)
    archive_path = os.path.join(target_dir, "archive.mcaddon")

    req = urllib.request.Request(file_url, headers={"User-Agent": "minecraftlab-host"})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp, open(archive_path, "wb") as f:
            shutil.copyfileobj(resp, f)
    except Exception as e:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise ValueError(f"download failed: {e}")

    enriched = dict(payload)
    enriched["source"] = {
        "kind": "curseforge",
        "modId": payload.get("modId"),
        "fileId": payload.get("fileId"),
        "fileUrl": file_url,
    }
    try:
        meta = _build_meta_from_archive(library_id, archive_path, name, enriched, "downloaded")
    except Exception as e:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise ValueError(f"invalid addon archive: {e}")

    _write_library_meta(library_id, meta)
    return meta


def save_uploaded_to_library(name, file_bytes, description="", author=""):
    """Save user-uploaded .mcaddon to the library as type=imported."""
    if not name:
        raise ValueError("missing name")
    if not file_bytes:
        raise ValueError("missing file contents")

    library_id = slug_id(name)
    target_dir = library_path(library_id)
    os.makedirs(target_dir, exist_ok=True)
    archive_path = os.path.join(target_dir, "archive.mcaddon")

    with open(archive_path, "wb") as f:
        f.write(file_bytes)

    payload = {"description": description, "author": author, "source": {"kind": "upload"}}
    try:
        meta = _build_meta_from_archive(library_id, archive_path, name, payload, "imported")
    except Exception as e:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise ValueError(f"invalid addon archive: {e}")

    _write_library_meta(library_id, meta)
    return meta


def install_library_to_world(library_id, world_id):
    meta = _read_library_meta(library_id)
    if not meta:
        raise FileNotFoundError(f"library entry not found: {library_id}")
    archive = os.path.join(library_path(library_id), "archive.mcaddon")
    if not os.path.isfile(archive):
        raise FileNotFoundError(f"library archive missing: {library_id}")

    cfg = load_config()
    world = next((w for w in cfg.get("worlds", []) if w.get("id") == world_id), None)
    if not world:
        raise FileNotFoundError(f"world not found: {world_id}")

    if not ct_status(world["ctid"]):
        raise ValueError("world container is stopped — start it before installing")

    # Push archive into the LXC's /tmp/, then ask bds-api to install from it.
    remote_path = f"/tmp/mc-library-{library_id}.mcaddon"
    out, code = run(f"pct push {world['ctid']} {archive} {remote_path}", timeout=180)
    if code != 0:
        raise RuntimeError(f"pct push failed: {out or 'unknown error'}")

    # bds-api needs the BDS level-name (filesystem dir), not server-name. Read
    # it from /properties; fall back to worlds.json name if BDS isn't reachable.
    properties = bds_api_call(world.get("ip"), world.get("apiPort", 8080), "/properties") or {}
    world_name = properties.get("level-name") or world.get("name") or "world"

    source = meta.get("source") or {}
    body = {
        "path": remote_path,
        "worldName": world_name,
        "addonName": meta.get("name", ""),
        "libraryId": library_id,
        "modId": source.get("modId"),
        "fileId": source.get("fileId"),
    }
    try:
        return bds_api_post(world.get("ip"), world.get("apiPort", 8080), "/addons/install-local", body, timeout=180)
    finally:
        run(f"pct exec {world['ctid']} -- rm -f {remote_path}", timeout=10)


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
        elif p.startswith("/worlds/") and p.endswith("/restore"):
            pass  # POST only
        elif p.startswith("/worlds/") and p.endswith("/backups"):
            data = list_world_backups(p[len("/worlds/"):-len("/backups")])
            if data is None:
                self._json(404, {"error": "world not found"})
            else:
                self._json(200, data)
        elif p == "/standby":
            cfg = load_config()
            ready = cfg.get("standbyCtid") and ct_exists(cfg["standbyCtid"])
            self._json(200, {"ready": ready, "provisioning": _provisioning})
        elif p == "/updates/check":
            self._json(200, check_updates())
        elif p == "/updates/status":
            self._json(200, _update_state)
        elif p == "/mcx/status":
            self._json(200, _mcx_watch_state)
        elif p == "/mcx/bridges":
            self._json(200, mcx_bridges())
        elif p == "/library":
            self._json(200, list_library())
        elif p.startswith("/library/"):
            try:
                library_id = p.split("/", 2)[2]
                entry = get_library_entry(library_id)
                if entry:
                    self._json(200, entry)
                else:
                    self._json(404, {"error": "library entry not found"})
            except ValueError as e:
                self._json(400, {"error": str(e)})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth(): return
        p = self.path.rstrip("/")
        body = self._body()

        if p.startswith("/worlds/") and p.endswith("/restore"):
            wid = p[len("/worlds/"):-len("/restore")]
            result = restore_world_backup(wid, str(body.get("source", "")), str(body.get("filename", "")))
            self._json(200 if result.get("success") else 400, result)
            return

        if p == "/mcx/restart":
            account = str(body.get("account", "")).strip()
            if account not in ("primary", "secondary", "all"):
                self._json(400, {"error": "account must be primary, secondary or all"})
                return
            result = mcx_restart(account)
            self._json(200 if result.get("success") else (400 if result.get("error") else 502), result)
            return

        if p == "/worlds":
            name = body.get("name", "").strip()
            if not name:
                self._json(400, {"error": "missing name"})
                return
            seed = body.get("seed", "").strip()
            backup = body.get("backup", True) is not False  # on unless the dashboard unticked the box
            result = create_world(name, seed=seed, backup=backup)
            self._json(200 if result.get("success") else 500, result)

        elif p.startswith("/worlds/") and p.endswith("/start"):
            wid = p.split("/")[2]
            self._json(200, start_world(wid))

        elif p.startswith("/worlds/") and p.endswith("/stop"):
            wid = p.split("/")[2]
            self._json(200, stop_world(wid))

        elif p.startswith("/worlds/") and p.endswith("/reset"):
            wid = p.split("/")[2]
            result = reset_world(wid, body.get("name", ""), seed=body.get("seed", ""))
            self._json(200 if result.get("success") else 400, result)

        elif p == "/updates/apply":
            force = bool(body.get("force", False))
            self._json(200, trigger_updates(force=force))

        elif p.startswith("/worlds/") and p.endswith("/backup"):
            # Flip whether the nightly backup job (scripts/daily-backup.sh) includes this world.
            wid = p.split("/")[2]
            enabled = body.get("enabled", True) is not False
            cfg = load_config()
            world = next((w for w in cfg["worlds"] if w["id"] == wid), None)
            if not world:
                self._json(404, {"error": "not found"}); return
            world["backup"] = enabled
            save_config(cfg)
            _worlds_cache["data"] = None
            self._json(200, {"success": True, "backup": enabled})

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

        elif p == "/library/from-curseforge":
            try:
                meta = download_to_library_from_curseforge(body)
                self._json(200, meta)
            except ValueError as e:
                self._json(400, {"error": str(e)})
            except Exception as e:
                self._json(500, {"error": str(e)})

        elif p == "/library/upload":
            name = (body.get("name") or "").strip()
            content_b64 = body.get("contentBase64") or ""
            if not name or not content_b64:
                self._json(400, {"error": "missing name or contentBase64"})
                return
            try:
                file_bytes = base64.b64decode(content_b64)
                meta = save_uploaded_to_library(
                    name, file_bytes,
                    description=(body.get("description") or "").strip(),
                    author=(body.get("author") or "").strip(),
                )
                self._json(200, meta)
            except ValueError as e:
                self._json(400, {"error": str(e)})
            except Exception as e:
                self._json(500, {"error": str(e)})

        elif p.startswith("/library/") and p.endswith("/install"):
            library_id = p.split("/")[2]
            world_id = (body.get("worldId") or "").strip()
            if not world_id:
                self._json(400, {"error": "missing worldId"})
                return
            try:
                result = install_library_to_world(library_id, world_id)
                if result is None:
                    self._json(502, {"success": False, "error": "no response from bds-api"})
                else:
                    self._json(200, result)
            except FileNotFoundError as e:
                self._json(404, {"error": str(e)})
            except ValueError as e:
                self._json(400, {"error": str(e)})
            except Exception as e:
                self._json(500, {"error": str(e)})

        else:
            self._json(404, {"error": "not found"})

    def do_DELETE(self):
        if not self._auth(): return
        p = self.path.rstrip("/")
        if p.startswith("/worlds/"):
            wid = p.split("/")[2]
            result = delete_world(wid)
            self._json(200 if result.get("success") else 400, result)
        elif p.startswith("/library/"):
            try:
                library_id = p.split("/", 2)[2]
                delete_library_entry(library_id)
                self._json(200, {"success": True})
            except FileNotFoundError as e:
                self._json(404, {"error": str(e)})
            except ValueError as e:
                self._json(400, {"error": str(e)})
        else:
            self._json(404, {"error": "not found"})


if __name__ == "__main__":
    t = threading.Thread(target=auto_stop_loop, daemon=True)
    t.start()
    print(f"[host-api] Auto-stop daemon started ({load_config().get('idleTimeoutMinutes', 10)} min timeout)")

    # Re-establish UPnP forwards on startup and every 10 min (handles router reboots)
    threading.Thread(target=upnp_refresh_loop, daemon=True).start()

    # Keep the Xbox bridge accounts protocol-matched to the live worlds
    threading.Thread(target=mcx_watch_loop, daemon=True).start()
    print("[host-api] MCXboxBroadcast protocol watcher started", flush=True)

    print(f"[host-api] Listening on port {PORT}")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
