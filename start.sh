#!/usr/bin/env bash
# CIVRAT launcher for Bot-Hosting / Pterodactyl "Start bash file".
#
# The hosting daemon runs:  bash ${START_BASH_FILE}
# so the "Start bash file" field MUST point to this real Bash script (e.g.
# "start.sh"), never to a .js file and never to a "node ..." command line.
#
# Switch the launch mode in one of two ways (both safe — no secret involved):
#   1. Edit MODE and GUILD_ID below, keep the field as just "start.sh".
#   2. OR add arguments after the filename in the field (the daemon's unquoted
#      expansion makes them $1/$2):   start.sh deploy 123456789012345678
#
# Modes:
#   start            -> normal start (no deploy)
#   deploy           -> one-shot GLOBAL deploy + read-back, then start the bot
#   deploy <guildId> -> one-shot GUILD-SCOPED deploy (instant), then start the bot
#
# The bot ALWAYS comes online even when the deploy fails. Deploy logging is
# handled by deploy.js and never prints the token or any secret.

set -euo pipefail

# ---- EDIT HERE (only these two values) -------------------------------------
MODE="start"   # "start" or "deploy"
GUILD_ID=""    # guild id for a guild-scoped deploy; empty = global deploy
# ----------------------------------------------------------------------------

# Arguments (when the field contains "start.sh deploy <guildId>") override the
# variables above.
if [[ $# -ge 1 ]]; then MODE="$1"; fi
if [[ $# -ge 2 ]]; then GUILD_ID="$2"; fi

# Run from the bot directory (this script lives at the repository root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[CIVRAT] ERROR: 'node' not found in PATH." >&2
  exit 1
fi

case "$MODE" in
  deploy)
    if [[ -n "$GUILD_ID" ]]; then
      echo "[CIVRAT] Launch mode: deploy (guild-scoped)."
      node start.js deploy "$GUILD_ID"
    else
      echo "[CIVRAT] Launch mode: deploy (global)."
      node start.js deploy
    fi
    ;;
  start|"")
    echo "[CIVRAT] Launch mode: start (no deploy)."
    node start.js
    ;;
  *)
    echo "[CIVRAT] Unknown MODE '$MODE' — falling back to normal start." >&2
    node start.js
    ;;
esac
