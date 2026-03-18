#!/usr/bin/env python3
"""BDS Wrapper API — lightweight HTTP API for controlling Minecraft Bedrock Dedicated Server.
Runs in each BDS container alongside the game server.
"""

from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import fcntl
import json
import subprocess
import os
import time
import re
import shutil
import tempfile
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

API_TOKEN = os.environ.get("BDS_API_TOKEN", "changeme")
BDS_PATH = os.environ.get("BDS_PATH", "/opt/bedrock")
SCREEN_NAME = "bedrock"
LOG_FILE = os.path.join(BDS_PATH, "logs", "server.log")
BACKUP_DIR = os.path.join(BDS_PATH, "backups")
PORT = int(os.environ.get("API_PORT", "8080"))
MC_USER = "minecraft"
BEHAVIOR_PACKS_DIR = os.path.join(BDS_PATH, "behavior_packs")
RESOURCE_PACKS_DIR = os.path.join(BDS_PATH, "resource_packs")
WORLDS_DIR = os.path.join(BDS_PATH, "worlds")
VALID_KNOWN_PACKS_FILE = os.path.join(BDS_PATH, "valid_known_packs.json")
INSTALLED_ADDONS_FILE = os.path.join(BDS_PATH, "installed_addons.json")

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


def default_json_value(default):
    return json.loads(json.dumps(default))


def chown_recursive(path):
    run(f'chown -R {MC_USER}:{MC_USER} "{path}"')


def atomic_write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(
        dir=os.path.dirname(path),
        prefix=f".{os.path.basename(path)}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=4)
            f.write("\n")
        os.replace(temp_path, path)
        run(f'chown {MC_USER}:{MC_USER} "{path}"')
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def read_json_file(path, default, create=False):
    if not os.path.exists(path):
        data = default_json_value(default)
        if create:
            atomic_write_json(path, data)
        return data
    try:
        with open(path, "r") as f:
            return json.load(f)
    except:
        return default_json_value(default)


def update_json_file(path, default, update_fn):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lock_path = f"{path}.lock"
    with open(lock_path, "w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        data = read_json_file(path, default, create=True)
        if not isinstance(data, type(default)):
            data = default_json_value(default)
        result = update_fn(data)
        atomic_write_json(path, data)
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        return result


def sanitize_folder_name(name, fallback):
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "").strip("._")
    return cleaned or fallback


def validate_world_name(world_name):
    if not world_name or "/" in world_name or "\\" in world_name or world_name in (".", ".."):
        raise ValueError("invalid world name")
    world_dir = os.path.join(WORLDS_DIR, world_name)
    if not os.path.isdir(world_dir):
        raise FileNotFoundError(f"world not found: {world_name}")
    return world_dir


def get_world_packs_file(world_name, pack_type):
    world_dir = validate_world_name(world_name)
    if pack_type == "behavior":
        return os.path.join(world_dir, "world_behavior_packs.json")
    return os.path.join(world_dir, "world_resource_packs.json")


def read_world_packs(world_name, pack_type, create=False):
    path = get_world_packs_file(world_name, pack_type)
    data = read_json_file(path, [], create=create)
    if isinstance(data, list):
        return data
    return []


def update_world_packs(world_name, pack_type, update_fn):
    path = get_world_packs_file(world_name, pack_type)
    return update_json_file(path, [], update_fn)


def version_to_string(version):
    if isinstance(version, list):
        return ".".join(str(v) for v in version)
    return str(version or "")


def normalize_dependencies(dependencies):
    result = []
    for dep in dependencies or []:
        if isinstance(dep, dict) and dep.get("uuid"):
            result.append({
                "uuid": dep.get("uuid"),
                "version": dep.get("version", []),
            })
    return result


def parse_manifest(manifest_path):
    with open(manifest_path, "r") as f:
        manifest = json.load(f)

    header = manifest.get("header", {})
    modules = manifest.get("modules") or []
    module_type = ""
    for module in modules:
        if module.get("type") in ("data", "resources", "script"):
            module_type = module.get("type")
            break
    if not module_type and modules:
        module_type = modules[0].get("type", "")

    return {
        "uuid": header.get("uuid"),
        "name": header.get("name", ""),
        "description": header.get("description", ""),
        "version": header.get("version", []),
        "type": module_type,
        "dependencies": normalize_dependencies(manifest.get("dependencies", [])),
        "manifest": manifest,
    }


def build_addon_info(pack_dir, pack_type, installed_by_uuid):
    manifest_path = os.path.join(pack_dir, "manifest.json")
    if not os.path.isfile(manifest_path):
        return None

    parsed = parse_manifest(manifest_path)
    if not parsed.get("uuid"):
        return None

    installed = installed_by_uuid.get(parsed["uuid"])
    curseforge = None
    if installed and installed.get("modId") is not None and installed.get("fileId") is not None:
        curseforge = {
            "modId": installed.get("modId"),
            "fileId": installed.get("fileId"),
        }

    base_name = os.path.basename(os.path.dirname(pack_dir))
    return {
        "uuid": parsed["uuid"],
        "name": parsed["name"],
        "description": parsed["description"],
        "version": parsed["version"],
        "type": parsed["type"],
        "packType": pack_type,
        "path": f"{base_name}/{os.path.basename(pack_dir)}",
        "dependencies": parsed["dependencies"],
        "curseforge": curseforge,
    }


def read_installed_addons_metadata():
    data = read_json_file(INSTALLED_ADDONS_FILE, [], create=True)
    if isinstance(data, list):
        return data
    return []


def list_installed_addons():
    installed_by_uuid = {}
    for item in read_installed_addons_metadata():
        uuid = item.get("uuid")
        if uuid:
            installed_by_uuid[uuid] = item

    addons = []
    for pack_type, base_dir in (("behavior", BEHAVIOR_PACKS_DIR), ("resource", RESOURCE_PACKS_DIR)):
        if not os.path.isdir(base_dir):
            continue
        for entry in sorted(os.scandir(base_dir), key=lambda e: e.name):
            if not entry.is_dir():
                continue
            try:
                addon = build_addon_info(entry.path, pack_type, installed_by_uuid)
            except:
                addon = None
            if addon:
                addons.append(addon)
    return addons


def list_world_addons(world_name):
    addons_by_uuid = {addon["uuid"]: addon for addon in list_installed_addons()}
    result = []
    seen = set()

    for pack_type in ("behavior", "resource"):
        for entry in read_world_packs(world_name, pack_type, create=True):
            pack_uuid = entry.get("pack_id")
            if not pack_uuid or pack_uuid in seen:
                continue
            addon = addons_by_uuid.get(pack_uuid, {
                "uuid": pack_uuid,
                "name": "",
                "description": "",
                "version": entry.get("version", []),
                "type": "",
                "packType": pack_type,
                "path": "",
                "dependencies": [],
                "curseforge": None,
            }).copy()
            addon["enabled"] = True
            result.append(addon)
            seen.add(pack_uuid)

    return result


def safe_extract_zip(zip_file, dest_dir):
    root = os.path.realpath(dest_dir)
    for member in zip_file.infolist():
        member_path = os.path.realpath(os.path.join(dest_dir, member.filename))
        if not member_path.startswith(root + os.sep) and member_path != root:
            raise ValueError("invalid archive path")
    zip_file.extractall(dest_dir)


def archive_has_manifest(zip_file):
    for name in zip_file.namelist():
        clean = name.strip("/")
        if not clean or clean.endswith("/"):
            continue
        parts = [part for part in clean.split("/") if part]
        if parts and parts[-1] == "manifest.json":
            return True
    return False


def archive_is_java_only(zip_file):
    """Detect Java Edition packs/datapacks (no manifest.json but has Java-specific structure)."""
    names = zip_file.namelist()
    has_manifest = any(os.path.basename(n.rstrip("/")) == "manifest.json" for n in names)
    if has_manifest:
        return False
    # Java datapack: data/ directory
    has_data_dir = any(n.startswith("data/") for n in names)
    # Java resource pack: assets/ directory or pack.mcmeta
    has_assets_dir = any(n.startswith("assets/") for n in names)
    has_pack_mcmeta = any(os.path.basename(n.rstrip("/")) == "pack.mcmeta" for n in names)
    return has_data_dir or has_assets_dir or has_pack_mcmeta


def _is_zip_a_pack(zip_file):
    """Check if an open ZipFile contains a manifest.json (is a Bedrock pack)."""
    return any(os.path.basename(n.rstrip("/")) == "manifest.json" for n in zip_file.namelist())


def extract_pack_archives(archive_path, temp_dir):
    pack_archives = []
    try:
        with zipfile.ZipFile(archive_path, "r") as zip_file:
            names = zip_file.namelist()
            # Collect candidate inner archives: .mcpack / .mcaddon and any .zip inside
            inner_pack_names = [n for n in names if n.lower().endswith((".mcpack", ".mcaddon"))]
            inner_zip_names = [n for n in names if n.lower().endswith(".zip") and not n.lower().endswith((".mcpack", ".mcaddon"))]

            if inner_pack_names:
                # Standard .mcaddon: outer zip holds .mcpack / .mcaddon entries
                for name in inner_pack_names:
                    target = os.path.join(temp_dir, os.path.basename(name))
                    with zip_file.open(name) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    pack_archives.append(target)
            elif archive_has_manifest(zip_file):
                # Outer zip IS the pack (manifest.json somewhere inside)
                pack_archives.append(archive_path)
            elif inner_zip_names:
                # Some authors bundle inner .zip files — check each for a manifest
                found_any = False
                for name in inner_zip_names:
                    target = os.path.join(temp_dir, os.path.basename(name))
                    with zip_file.open(name) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    try:
                        with zipfile.ZipFile(target, "r") as inner_zip:
                            if _is_zip_a_pack(inner_zip):
                                pack_archives.append(target)
                                found_any = True
                    except zipfile.BadZipFile:
                        pass
                if not found_any:
                    raise ValueError("unsupported addon archive format — no manifest.json found in any inner archive")
            elif archive_is_java_only(zip_file):
                raise ValueError("this is a Java Edition addon and cannot be installed on Bedrock servers")
            else:
                raise ValueError("unsupported addon archive format — no manifest.json found")
    except zipfile.BadZipFile:
        raise ValueError("invalid zip archive")

    if not pack_archives:
        raise ValueError("no packs found in archive")
    return pack_archives


def find_manifest_path(root_dir):
    direct = os.path.join(root_dir, "manifest.json")
    if os.path.isfile(direct):
        return direct

    for entry in os.scandir(root_dir):
        if not entry.is_dir():
            continue
        manifest_path = os.path.join(entry.path, "manifest.json")
        if os.path.isfile(manifest_path):
            return manifest_path

    return None


def resolve_pack_destination(pack_name, pack_uuid, pack_type):
    if pack_type in ("data", "script"):
        base_dir = BEHAVIOR_PACKS_DIR
        storage_type = "behavior"
    elif pack_type == "resources":
        base_dir = RESOURCE_PACKS_DIR
        storage_type = "resource"
    else:
        raise ValueError(f"unsupported pack type: {pack_type}")

    os.makedirs(base_dir, exist_ok=True)
    folder_name = sanitize_folder_name(pack_name, f"pack_{pack_uuid[:8]}")
    dest_path = os.path.join(base_dir, folder_name)

    if os.path.exists(dest_path):
        manifest_path = os.path.join(dest_path, "manifest.json")
        existing_uuid = None
        if os.path.isfile(manifest_path):
            try:
                existing_uuid = parse_manifest(manifest_path).get("uuid")
            except:
                existing_uuid = None
        if existing_uuid == pack_uuid:
            shutil.rmtree(dest_path)
        else:
            folder_name = f"{folder_name}_{pack_uuid[:8]}"
            dest_path = os.path.join(base_dir, folder_name)
            if os.path.exists(dest_path):
                manifest_path = os.path.join(dest_path, "manifest.json")
                existing_uuid = None
                if os.path.isfile(manifest_path):
                    try:
                        existing_uuid = parse_manifest(manifest_path).get("uuid")
                    except:
                        existing_uuid = None
                if existing_uuid == pack_uuid:
                    shutil.rmtree(dest_path)
                else:
                    raise ValueError(f"destination already exists: {dest_path}")

    return storage_type, folder_name, dest_path


def upsert_valid_known_pack(relative_path, pack_uuid, version):
    version_str = version_to_string(version)

    def update(data):
        data[:] = [
            item for item in data
            if item.get("uuid") != pack_uuid and item.get("path") != relative_path
        ]
        data.append({
            "file_system": "RawPath",
            "path": relative_path,
            "uuid": pack_uuid,
            "version": version_str,
        })

    update_json_file(VALID_KNOWN_PACKS_FILE, [], update)


def remove_valid_known_pack(relative_path, pack_uuid):
    def update(data):
        data[:] = [
            item for item in data
            if item.get("uuid") != pack_uuid and item.get("path") != relative_path
        ]

    update_json_file(VALID_KNOWN_PACKS_FILE, [], update)


def set_world_pack_enabled(world_name, pack_type, pack_uuid, version, enabled):
    def update(data):
        existing = [item for item in data if item.get("pack_id") == pack_uuid]
        if enabled:
            if not existing:
                data.append({"pack_id": pack_uuid, "version": version})
        else:
            data[:] = [item for item in data if item.get("pack_id") != pack_uuid]

    update_world_packs(world_name, pack_type, update)


def record_installed_addon(pack_uuid, mod_id, file_id, name):
    def update(data):
        data[:] = [item for item in data if item.get("uuid") != pack_uuid]
        data.append({
            "uuid": pack_uuid,
            "modId": mod_id,
            "fileId": file_id,
            "name": name,
            "installedAt": datetime.now().isoformat(),
        })

    update_json_file(INSTALLED_ADDONS_FILE, [], update)


def remove_installed_addon(pack_uuid):
    def update(data):
        data[:] = [item for item in data if item.get("uuid") != pack_uuid]

    update_json_file(INSTALLED_ADDONS_FILE, [], update)


def install_pack_archive(archive_path, world_name, mod_id, file_id, addon_name):
    with tempfile.TemporaryDirectory() as extract_dir:
        try:
            with zipfile.ZipFile(archive_path, "r") as zip_file:
                safe_extract_zip(zip_file, extract_dir)
        except zipfile.BadZipFile:
            raise ValueError("invalid pack archive")

        manifest_path = find_manifest_path(extract_dir)
        if not manifest_path:
            raise ValueError("manifest.json not found in pack")

        parsed = parse_manifest(manifest_path)
        pack_uuid = parsed.get("uuid")
        if not pack_uuid:
            raise ValueError("manifest missing uuid")

        existing = find_addon_by_uuid(pack_uuid)
        if existing:
            existing_path = os.path.join(BDS_PATH, existing["path"])
            if os.path.isdir(existing_path):
                shutil.rmtree(existing_path)

        storage_type, folder_name, dest_path = resolve_pack_destination(
            parsed.get("name") or addon_name,
            pack_uuid,
            parsed.get("type"),
        )

        source_dir = os.path.dirname(manifest_path)
        shutil.copytree(source_dir, dest_path)
        chown_recursive(dest_path)

        relative_path = f"{storage_type}_packs/{folder_name}"
        upsert_valid_known_pack(relative_path, pack_uuid, parsed.get("version", []))
        set_world_pack_enabled(world_name, storage_type, pack_uuid, parsed.get("version", []), True)
        record_installed_addon(
            pack_uuid,
            mod_id,
            file_id,
            addon_name or parsed.get("name", ""),
        )

        addon = build_addon_info(dest_path, storage_type, {
            pack_uuid: {
                "uuid": pack_uuid,
                "modId": mod_id,
                "fileId": file_id,
            }
        })
        if not addon:
            raise ValueError("failed to build installed pack info")
        return addon


def install_addon(url, world_name, mod_id, file_id, addon_name):
    validate_world_name(world_name)

    with tempfile.TemporaryDirectory() as temp_dir:
        archive_path = os.path.join(temp_dir, "addon.zip")
        request = urllib.request.Request(url, headers={"User-Agent": "bds-api"})

        try:
            with urllib.request.urlopen(request, timeout=60) as response, open(archive_path, "wb") as f:
                shutil.copyfileobj(response, f)
        except Exception as e:
            raise ValueError(f"download failed: {e}")

        pack_archives = extract_pack_archives(archive_path, temp_dir)
        installed = []
        for pack_archive in pack_archives:
            installed.append(install_pack_archive(pack_archive, world_name, mod_id, file_id, addon_name))
        return installed


def find_addon_by_uuid(pack_uuid):
    for addon in list_installed_addons():
        if addon.get("uuid") == pack_uuid:
            return addon
    return None


def remove_addon(pack_uuid, world_name):
    validate_world_name(world_name)
    addon = find_addon_by_uuid(pack_uuid)
    if not addon:
        raise FileNotFoundError(f"addon not found: {pack_uuid}")

    full_path = os.path.join(BDS_PATH, addon["path"])
    if os.path.isdir(full_path):
        shutil.rmtree(full_path)

    remove_valid_known_pack(addon["path"], pack_uuid)
    set_world_pack_enabled(world_name, addon["packType"], pack_uuid, addon.get("version", []), False)
    remove_installed_addon(pack_uuid)
    return addon


def toggle_addon(pack_uuid, world_name, enabled):
    validate_world_name(world_name)
    addon = find_addon_by_uuid(pack_uuid)
    if not addon:
        raise FileNotFoundError(f"addon not found: {pack_uuid}")

    set_world_pack_enabled(world_name, addon["packType"], pack_uuid, addon.get("version", []), enabled)
    return addon


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
        parsed = urllib.parse.urlparse(self.path)
        p = parsed.path.rstrip("/") or "/"
        if p == "/status":
            self._json(200, get_status())
        elif p == "/allowlist":
            self._json(200, read_allowlist())
        elif p == "/properties":
            self._json(200, read_properties())
        elif p == "/backups":
            self._json(200, list_backups())
        elif p == "/addons":
            self._json(200, list_installed_addons())
        elif p == "/addons/world":
            params = urllib.parse.parse_qs(parsed.query)
            world_name = (params.get("name") or [""])[0].strip()
            if not world_name:
                self._json(400, {"error": "missing name"})
                return
            try:
                self._json(200, list_world_addons(world_name))
            except FileNotFoundError as e:
                self._json(404, {"error": str(e)})
            except ValueError as e:
                self._json(400, {"error": str(e)})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth():
            return
        parsed = urllib.parse.urlparse(self.path)
        p = parsed.path.rstrip("/") or "/"
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

        elif p == "/addons/install":
            url = str(body.get("url") or "").strip()
            world_name = str(body.get("worldName") or "").strip()
            if not url:
                self._json(400, {"error": "missing url"})
                return
            if not world_name:
                self._json(400, {"error": "missing worldName"})
                return
            try:
                packs = install_addon(
                    url,
                    world_name,
                    body.get("modId"),
                    body.get("fileId"),
                    str(body.get("addonName") or "").strip(),
                )
                self._json(200, {"success": True, "packs": packs, "restartRequired": True})
            except FileNotFoundError as e:
                self._json(404, {"error": str(e)})
            except ValueError as e:
                self._json(400, {"error": str(e)})
            except Exception as e:
                self._json(500, {"error": str(e)})

        elif p == "/addons/remove":
            pack_uuid = str(body.get("uuid") or "").strip()
            world_name = str(body.get("worldName") or "").strip()
            if not pack_uuid:
                self._json(400, {"error": "missing uuid"})
                return
            if not world_name:
                self._json(400, {"error": "missing worldName"})
                return
            try:
                remove_addon(pack_uuid, world_name)
                self._json(200, {"success": True, "restartRequired": True})
            except FileNotFoundError as e:
                self._json(404, {"error": str(e)})
            except ValueError as e:
                self._json(400, {"error": str(e)})
            except Exception as e:
                self._json(500, {"error": str(e)})

        elif p == "/addons/toggle":
            pack_uuid = str(body.get("uuid") or "").strip()
            world_name = str(body.get("worldName") or "").strip()
            enabled = body.get("enabled")
            if not pack_uuid:
                self._json(400, {"error": "missing uuid"})
                return
            if not world_name:
                self._json(400, {"error": "missing worldName"})
                return
            if not isinstance(enabled, bool):
                self._json(400, {"error": "enabled must be true or false"})
                return
            try:
                toggle_addon(pack_uuid, world_name, enabled)
                self._json(200, {"success": True, "restartRequired": True})
            except FileNotFoundError as e:
                self._json(404, {"error": str(e)})
            except ValueError as e:
                self._json(400, {"error": str(e)})
            except Exception as e:
                self._json(500, {"error": str(e)})

        else:
            self._json(404, {"error": "not found"})


if __name__ == "__main__":
    print(f"BDS API starting on port {PORT}")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
