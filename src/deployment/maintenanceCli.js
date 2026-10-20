"use strict";
const { maintainCommands } = require("./commandMaintenance");
function parseMaintenanceArgs(argv) {
  const args = [...argv];
  const action = args.shift() || "deploy";
  const targets = { global: false, allGuilds: false, guildIds: [] };
  let apply = false, confirm = null;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--global") targets.global = true;
    else if (flag === "--all-guilds") targets.allGuilds = true;
    else if (flag === "--guild") targets.guildIds.push(args.shift());
    else if (flag === "--apply") apply = true;
    else if (flag === "--confirm") { confirm = args.shift(); if (!confirm) throw new Error("Missing confirmation"); }
    else throw new Error("Use explicit --global, --all-guilds or --guild ID targets");
  }
  const invalid = message => {
    const error = new Error(message);
    error.code = "MAINTENANCE_ARGUMENTS";
    throw error;
  };
  if (!["list", "clear", "deploy"].includes(action)) invalid("Unknown maintenance mode");
  if (!targets.global && !targets.allGuilds && !targets.guildIds.length) {
    invalid("Explicit targets required: configure MAINTENANCE_ARGS=(--all-guilds) in start.local.sh, or pass --global / --all-guilds / --guild ID. No Discord request made.");
  }
  if (targets.guildIds.some(id => typeof id !== "string" || !/^\d{15,21}$/.test(id))) invalid("--guild requires a valid guild ID. No Discord request made.");
  return { action, targets, apply, confirm };
}
async function maintenanceCli(argv, { rest, config, catalog }) {
  return maintainCommands({ rest, clientId: config.clientId, adminGuildId: config.civratAdminGuildId, catalog, ...parseMaintenanceArgs(argv) });
}
module.exports = { maintenanceCli, parseMaintenanceArgs };
