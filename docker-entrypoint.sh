#!/bin/sh
set -e

HOME_DIR="${HOME:-/home/hiveboard}"

# Ensure Claude CLI config directory exists and is usable
mkdir -p "$HOME_DIR/.claude"

# Restore Claude CLI config if missing (backup may exist from previous runs)
if [ ! -f "$HOME_DIR/.claude.json" ]; then
  BACKUP=$(ls -t "$HOME_DIR/.claude/backups/.claude.json.backup."* 2>/dev/null | head -1)
  if [ -n "$BACKUP" ]; then
    echo "Restoring Claude CLI config from backup: $BACKUP"
    cp "$BACKUP" "$HOME_DIR/.claude.json"
  else
    echo '{}' > "$HOME_DIR/.claude.json"
  fi
fi

exec "$@"
