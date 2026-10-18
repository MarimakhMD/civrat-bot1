"use strict";
const { maintainCommands } = require("./commandMaintenance");
async function maintenanceCli(argv, { rest, config, catalog }) {
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
  return maintainCommands({ rest, clientId: config.clientId, adminGuildId: config.civratAdminGuildId, action, targets, catalog, apply, confirm });
}
module.exports = { maintenanceCli };
