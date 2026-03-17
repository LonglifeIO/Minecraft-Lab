#!/usr/bin/env python3
"""BDS Wrapper API — lightweight HTTP API for controlling Minecraft Bedrock Dedicated Server.
Runs in each BDS container alongside the game server.
"""

from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json
import subprocess
import os
import time
import re
import shutil
from datetime import datetime
from pathlib import Path

API_TOKEN = os.environ.get("BDS_API_TOKEN", "changeme")
BDS_PATH = os.environ.get("BDS_PATH", "/opt/bedrock")
SCREEN_NAME = "bedrock"
LOG_FILE = os.path.join(BDS_PATH, "logs", "server.log")
BACKUP_DIR = os.path.join(BDS_PATH, "backups")
PORT = int(os.environ.get("API_PORT", "8080"))
MC_USER = "minecraft"

os.makedirs(os.path.join(BDS_PATH, "logs"), exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)


def run(cmd, timeout=10):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip(), r.returncode
    except:
        return "", -1


def is_running():
    _, code = run(f"pgrep -u {MC_USER} bedrock_server")
    return code == 0


def screen_cmd(cmd):
    escaped = cmd.replace("\\", "\\\\").replace('"', '\\"')
    run(f'sudo -u {MC_USER} screen -p 0 -S {SCREEN_NAME} -X stuff "{escaped}\\n"')


def send_and_capture(cmd, wait=1.0):
    if not os.path.exists(LOG_FILE):
        screen_cmd(cmd)
        time.sleep(wait)
        return ""
    try:
        size_before = os.path.getsize(LOG_FILE)
    except:
        size_before = 0
    screen_cmd(cmd)
    time.sleep(wait)
    try:
        with open(LOG_FILE, "r") as f:
            f.seek(size_before)
            return f.read().strip()
    except:
        return ""


def strip_log_prefix(line):
    return re.sub(r"^\[.*?\]\s*", "", line).strip()


def read_properties():
    props = {}
    try:
        with open(os.path.join(BDS_PATH, "server.properties")) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    props[k.strip()] = v.strip()
    except:
        pass
    return props


def read_allowlist():
    try:
        with open(os.path.join(BDS_PATH, "allowlist.json")) as f:
            return json.load(f)
    except:
        return []


def write_allowlist(data):
    path = os.path.join(BDS_PATH, "allowlist.json")
    with open(path, "w") as f:
        json.dump(data, f, indent=4)
    run(f"chown {MC_USER}:{MC_USER} {path}")


def get_version():
    try:
        if os.path.exists(LOG_FILE):
            out, _ = run(f"grep 'Version:' {LOG_FILE} | tail -1")
            m = re.search(r"Version:\s*([\d.]+)", out)
            if m:
                return m.group(1)
    except:
        pass
    return "unknown"


def get_status():
    running = is_running()
    props = read_properties()
    result = {
        "online": running,
        "players": 0,
        "maxPlayers": int(props.get("max-players", "20")),
        "playerList": [],
        "version": "unknown",
        "worldName": props.get("server-name", "Unknown"),
        "difficulty": props.get("difficulty", "normal"),
        "gamemode": props.get("gamemode", "survival"),
    }

    if running:
        result["version"] = get_version()
        output = send_and_capture("list", wait=0.5)
        lines = output.strip().split("\n")
        for i, line in enumerate(lines):
            clean = strip_log_prefix(line)
            m = re.match(r"There are (\d+)/(\d+) players online", clean)
            if m:
                result["players"] = int(m.group(1))
                result["maxPlayers"] = int(m.group(2))
                if result["players"] > 0 and i + 1 < len(lines):
                    next_clean = strip_log_prefix(lines[i + 1])
                    if next_clean:
                        result["playerList"] = [
                            p.strip() for p in next_clean.split(",") if p.strip()
                        ]
                break

    return result


def do_backup():
    if not is_running():
        return {"success": False, "error": "Server not running"}

    props = read_properties()
    world_name = props.get("level-name", "world")
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_name = f"{world_name}-{timestamp}"
    backup_path = os.path.join(BACKUP_DIR, backup_name)
    world_path = os.path.join(BDS_PATH, "worlds", world_name)

    screen_cmd("save hold")
    time.sleep(2)

    ready = False
    for _ in range(10):
        output = send_and_capture("save query", wait=1.5)
        if "Files are now ready" in output or "Data saved" in output:
            ready = True
            break

    try:
        shutil.copytree(world_path, backup_path)
    except Exception as e:
        screen_cmd("save resume")
        return {"success": False, "error": str(e)}
    finally:
        screen_cmd("save resume")

    run(f'tar -czf "{backup_path}.tar.gz" -C "{BACKUP_DIR}" "{backup_name}"', timeout=120)
    run(f'rm -rf "{backup_path}"')
    run(f'chown {MC_USER}:{MC_USER} "{backup_path}.tar.gz"')

    size = 0
    try:
        size = os.path.getsize(f"{backup_path}.tar.gz")
    except:
        pass

    return {"success": True, "filename": f"{backup_name}.tar.gz", "size": size}


def list_backups():
    backups = []
    if os.path.exists(BACKUP_DIR):
        for f in sorted(Path(BACKUP_DIR).glob("*.tar.gz"), reverse=True):
            stat = f.stat()
            backups.append({
                "filename": f.name,
                "size": stat.st_size,
                "date": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    return backups


PRESETS = {
    "kid_friendly": [
        "difficulty peaceful",
        "gamemode creative @a",
        "gamerule pvp false",
        "gamerule mobGriefing false",
        "gamerule keepInventory true",
    ],
    "hard_survival": [
        "difficulty hard",
        "gamemode survival @a",
        "gamerule keepInventory false",
        "gamerule pvp true",
        "gamerule naturalRegeneration true",
    ],
    "build_event": [
        "difficulty peaceful",
        "gamemode creative @a",
        "gamerule doMobSpawning false",
        "gamerule doDaylightCycle false",
        "gamerule doWeatherCycle false",
        "gamerule mobGriefing false",
    ],
    "normal": [
        "difficulty normal",
        "gamemode survival @a",
        "gamerule keepInventory true",
        "gamerule pvp false",
        "gamerule doDaylightCycle true",
        "gamerule doWeatherCycle true",
        "gamerule doMobSpawning true",
    ],
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _auth(self):
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {API_TOKEN}":
            self._json(401, {"error": "unauthorized"})
            return False
        return True

    def _json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length:
            return json.loads(self.rfile.read(length))
        return {}

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self):
        if not self._auth():
            return
        p = self.path.rstrip("/")
        if p == "/status":
            self._json(200, get_status())
        elif p == "/allowlist":
            self._json(200, read_allowlist())
        elif p == "/properties":
            self._json(200, read_properties())
        elif p == "/backups":
            self._json(200, list_backups())
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth():
            return
        p = self.path.rstrip("/")
        body = self._body()

        if p == "/command":
            cmd = body.get("command", "")
            if not cmd:
                self._json(400, {"error": "missing command"})
                return
            if not is_running():
                self._json(400, {"error": "server not running"})
                return
            output = send_and_capture(cmd)
            self._json(200, {"output": output})

        elif p == "/power":
            action = body.get("action", "")
            if action == "start":
                if is_running():
                    self._json(400, {"error": "already running"})
                    return
                run("systemctl start bedrock")
                time.sleep(8)
                self._json(200, {"success": is_running()})
            elif action == "stop":
                if not is_running():
                    self._json(400, {"error": "not running"})
                    return
                screen_cmd("stop")
                time.sleep(5)
                self._json(200, {"success": not is_running()})
            elif action == "restart":
                if is_running():
                    screen_cmd("stop")
                    time.sleep(5)
                run("systemctl start bedrock")
                time.sleep(8)
                self._json(200, {"success": is_running()})
            else:
                self._json(400, {"error": "invalid action: start, stop, or restart"})

        elif p == "/allowlist/add":
            name = body.get("name", "").strip()
            if not name:
                self._json(400, {"error": "missing name"})
                return
            al = read_allowlist()
            if any(e.get("name", "").lower() == name.lower() for e in al):
                self._json(400, {"error": "already in allowlist"})
                return
            al.append({"ignoresPlayerLimit": False, "name": name})
            write_allowlist(al)
            if is_running():
                screen_cmd(f"allowlist add {name}")
                time.sleep(0.5)
                screen_cmd("allowlist reload")
            self._json(200, {"success": True})

        elif p == "/allowlist/remove":
            name = body.get("name", "").strip()
            if not name:
                self._json(400, {"error": "missing name"})
                return
            al = read_allowlist()
            al = [e for e in al if e.get("name", "").lower() != name.lower()]
            write_allowlist(al)
            if is_running():
                screen_cmd(f"allowlist remove {name}")
                time.sleep(0.5)
                screen_cmd("allowlist reload")
            self._json(200, {"success": True})

        elif p == "/preset":
            preset = body.get("preset", "")
            if not is_running():
                self._json(400, {"error": "server not running"})
                return
            commands = PRESETS.get(preset)
            if not commands:
                self._json(400, {"error": f"unknown preset: {preset}. Valid: {list(PRESETS.keys())}"})
                return
            for cmd in commands:
                screen_cmd(cmd)
                time.sleep(0.3)
            self._json(200, {"success": True, "preset": preset})

        elif p == "/backup":
            result = do_backup()
            self._json(200 if result.get("success") else 500, result)

        else:
            self._json(404, {"error": "not found"})


if __name__ == "__main__":
    print(f"BDS API starting on port {PORT}")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
