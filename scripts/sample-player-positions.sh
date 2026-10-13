#!/usr/bin/env bash
# Every few minutes (root crontab): ask each running world where its online players are and remember the
# latest overworld spot per world in /var/lib/minecraftlab/positions/<worldId>.json. The nightly map render
# (scripts/render-maps.sh) centres the world's dashboard icon on that spot; with no spot known it uses the
# world spawn instead. Console `querytarget @a` works with cheats off and costs the game nothing.
set -uo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
WORLDS_JSON=/etc/minecraftlab/worlds.json
OUT=/var/lib/minecraftlab/positions
mkdir -p "$OUT"
python3 - "$WORLDS_JSON" "$OUT" <<'PY'
import json, re, subprocess, sys, time, urllib.request
cfg = json.load(open(sys.argv[1])); out = sys.argv[2]
token = cfg.get("apiToken", "")
for w in cfg["worlds"]:
    wid = w["id"]
    st = subprocess.run(["pct", "status", str(w["ctid"])], capture_output=True, text=True).stdout
    if "running" not in st:
        continue
    try:
        req = urllib.request.Request(f"http://{w['ip']}:{w.get('apiPort', 8080)}/command",
                                     data=json.dumps({"command": "querytarget @a"}).encode(),
                                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        output = json.load(urllib.request.urlopen(req, timeout=15)).get("output", "")
    except Exception as e:
        print(f"[{wid}] query failed: {e}"); continue
    m = re.search(r"\[\s*\{.*\}\s*\]", output, re.S)   # nobody online prints "No targets matched selector"
    if not m:
        continue
    try:
        entries = json.loads(m.group(0))
    except ValueError:
        continue
    now = int(time.time())
    positions = [{"x": e["position"]["x"], "y": e["position"]["y"], "z": e["position"]["z"], "dimension": e.get("dimension", 0)}
                 for e in entries if isinstance(e, dict) and "position" in e]
    overworld = [p for p in positions if p["dimension"] == 0]
    path = f"{out}/{wid}.json"
    try:
        data = json.load(open(path))
    except Exception:
        data = {}
    data["sampledAt"] = now
    data["positions"] = positions
    if overworld:
        data["latest"] = {**overworld[0], "time": now}
    json.dump(data, open(path, "w"))
    print(f"[{wid}] {len(positions)} online; latest overworld spot: {data.get('latest')}")
PY
