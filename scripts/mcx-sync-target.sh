#!/usr/bin/env bash
# Keep one MCXboxBroadcast instance in step with the world bound to its Xbox account slot.
# Looks up the world whose xboxAccount == ACCOUNT in host-api's /worlds list, then:
#   bound world, config differs (port / host-name / world-name) -> rewrite, then restart the service
#   bound world, service not running, unit enabled              -> start it
#   bound world, nothing to do                                  -> nothing
#   no bound world                                              -> stop the service if running
#                                                                  (a deleted world must not stay on the friends tab)
#   host-api unreachable                                        -> exit 1, touch nothing
# The friends-tab tile shows host-name/world-name from config.yml, so both follow the world's name.
# Runs from mcxboxbroadcast*-sync.timer every minute and as ExecStartPre of each broadcaster unit. When it
# runs as ExecStartPre (unit state 'activating') it only edits the config: java starts with it right after.
# It restarts/starts the unit itself; systemd gives ExecStartPost no $EXIT_STATUS, so the old
# "exit 10 -> ExecStartPost restarts" hook never fired.
# To keep a broadcaster off on purpose: systemctl disable --now <unit>  (disabled units are never auto-started).
# Repo copy: scripts/mcx-sync-target.sh -> pushed to /opt/mcxboxbroadcast{,2}/sync-target.sh in CT 105.
set -euo pipefail

CONFIG="${1:?usage: sync-target.sh CONFIG ACCOUNT}"
ACCOUNT="${2:?usage: sync-target.sh CONFIG ACCOUNT}"
HOST_API="http://192.168.2.34:8090/worlds"
# host-api bearer token: HOST_API_TOKEN in the environment, else the token file (mode 0600, root).
# Never put the real token in this script; the repo is public.
TOKEN="${HOST_API_TOKEN:-}"
TOKEN_FILE="${TOKEN_FILE:-/etc/minecraftlab/host-api.token}"
[ -n "${TOKEN}" ] || { [ -r "${TOKEN_FILE}" ] && TOKEN="$(tr -d '[:space:]' < "${TOKEN_FILE}")"; }
[ -n "${TOKEN}" ] || { echo "sync-target: no host-api token (set HOST_API_TOKEN or ${TOKEN_FILE})" >&2; exit 1; }
SVC="$(basename "$(dirname "${CONFIG}")").service"

json=$(curl -fsS -m 5 -H "Authorization: Bearer ${TOKEN}" "${HOST_API}")
state=$(systemctl is-active "${SVC}" 2>/dev/null || true)

# Prints NONE (no world bound), SAME (config already matches) or "CHANGED <what>" after rewriting.
result=$(ACCOUNT="${ACCOUNT}" CONFIG="${CONFIG}" python3 - "${json}" <<'PY'
import json, os, re, sys
ws = json.loads(sys.argv[1])
account = os.environ["ACCOUNT"]
world = next((w for w in ws if w.get("xboxAccount") == account), None)
if world is None:
    print("NONE")
    sys.exit(0)
name = str(world.get("name") or "Minecraft Server")
def yaml_quote(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
want = {"port": str(world["externalPort"]), "host-name": yaml_quote(name), "world-name": yaml_quote(name)}
path = os.environ["CONFIG"]
text = open(path).read()
lines = text.split("\n")
changed = []
for key, val in want.items():
    pat = re.compile(r"^(\s+)" + re.escape(key) + r":\s*(.*?)\s*$")
    for i, line in enumerate(lines):
        m = pat.match(line)
        if m:
            if m.group(2) != val:
                changed.append(f"{key}: {m.group(2)} -> {val}")
                lines[i] = f"{m.group(1)}{key}: {val}"
            break
if changed:
    open(path, "w").write("\n".join(lines))
    print("CHANGED " + "; ".join(changed))
else:
    print("SAME")
PY
)

changed=0
case "${result}" in
    NONE)
        if [ "${state}" = active ]; then
            systemctl stop "${SVC}"
            echo "No world bound to account ${ACCOUNT}; stopped ${SVC}"
        fi
        systemctl reset-failed "${SVC}" 2>/dev/null || true
        exit 0 ;;
    CHANGED*)
        echo "Retargeted ${CONFIG}: ${result#CHANGED }"
        changed=1 ;;
esac

case "${state}" in
    activating|reloading)
        exit 0 ;;                       # we are this unit's own ExecStartPre; java picks the config up next
    active)
        if [ "${changed}" = 1 ]; then
            systemctl restart "${SVC}"
            echo "Restarted ${SVC}"
        fi
        exit 0 ;;
esac
if [ "$(systemctl is-enabled "${SVC}" 2>/dev/null || true)" = enabled ]; then
    echo "World bound to account ${ACCOUNT} but ${SVC} is ${state}; starting"
    systemctl reset-failed "${SVC}" 2>/dev/null || true
    systemctl start "${SVC}"
fi
exit 0
