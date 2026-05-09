#!/bin/bash
# BDS world backup using save hold/query/resume
# Runs inside the BDS container
# Usage: bash bds-backup.sh

set -e

BDS_DIR="/opt/bedrock"
BACKUP_DIR="$BDS_DIR/backups"
WORLD_NAME=$(grep "level-name=" "$BDS_DIR/server.properties" | cut -d'=' -f2)
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${WORLD_NAME}_${TIMESTAMP}.tar.gz"
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting backup of '$WORLD_NAME' at $(date)"

# Check if BDS is running via screen
if ! su - minecraft -s /bin/bash -c "screen -list" 2>/dev/null | grep -q bedrock; then
    echo "[backup] BDS not running — backing up world directly"
    tar -czf "$BACKUP_FILE" -C "$BDS_DIR/worlds" "$WORLD_NAME"
    echo "[backup] Done (offline backup): $BACKUP_FILE"
else
    # Safe online backup using save hold/query/resume
    echo "[backup] BDS running — using save hold/query/resume"

    su - minecraft -s /bin/bash -c "screen -S bedrock -X stuff 'save hold\r'"
    sleep 2

    # Wait for save to be ready (up to 30s)
    for i in $(seq 1 15); do
        su - minecraft -s /bin/bash -c "screen -S bedrock -X stuff 'save query\r'" 2>/dev/null
        sleep 2
        if tail -10 "$BDS_DIR/logs/server.log" 2>/dev/null | grep -q "Data saved"; then
            break
        fi
    done

    tar -czf "$BACKUP_FILE" -C "$BDS_DIR/worlds" "$WORLD_NAME"
    su - minecraft -s /bin/bash -c "screen -S bedrock -X stuff 'save resume\r'"
    echo "[backup] Done (online backup): $BACKUP_FILE"
fi

# Prune old backups
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +$KEEP_DAYS -delete
echo "[backup] Pruned backups older than $KEEP_DAYS days"

# Write latest backup path for reference
echo "$BACKUP_FILE" > "$BACKUP_DIR/latest.txt"
