# Copy to start.local.sh on the host; ignored by Git, never put secrets here.
# This is trusted Bash configuration: only the operator may edit this file.
MODE="start" # normal startup; maintenance is a dedicated process that exits
GUILD_ID=""
MAINTENANCE_ARGS=()
# Explicit target selection, NOT an implicit default. Replace the array above
# (do not define it twice) and set MODE for a preview:
# MODE="clear"
# MAINTENANCE_ARGS=(--all-guilds) # guilds only; add --global to include globals
# After a separately approved preview only: append --apply --confirm HASH.
# Remove application flags immediately afterwards; restore MODE="start".
