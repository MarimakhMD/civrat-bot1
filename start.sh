#!/usr/bin/env bash
# Pterodactyl: bash start.sh [start|list|clear|deploy] [explicit targets/options]
set -euo pipefail
MODE="start"
GUILD_ID="" # optional single-guild target; leave empty for --global/--all-guilds
# Used only when no command-line arguments are supplied. No eval/string splitting.
MAINTENANCE_ARGS=() # e.g. (--global --all-guilds); preview unless --apply --confirm HASH
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if ! command -v node >/dev/null 2>&1; then
  echo "[CIVRAT] ERROR: 'node' not found in PATH." >&2
  exit 1
fi
if [[ $# -gt 0 ]]; then
  exec node start.js "$@"
fi
args=("$MODE")
if [[ "$MODE" != "start" ]]; then
  if [[ -n "$GUILD_ID" ]]; then args+=(--guild "$GUILD_ID"); fi
  args+=("${MAINTENANCE_ARGS[@]}")
fi
exec node start.js "${args[@]}"
