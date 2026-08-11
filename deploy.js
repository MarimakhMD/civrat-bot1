"use strict";

// CIVRAT slash-command deployment.
// Registers the full command list (legacy adapters + modular commands exposed
// by the runtime composition) globally through the Discord REST API.
// Global propagation can take time (documented Discord behavior).
// When LEGACY_GUILD_ID is set, guild-scoped commands registered historically on
// that guild are cleared first, so duplicated legacy guild commands disappear
// (see docs/archive/INTEGRATION_SUMMARY.md).

try {
  require("dotenv").config();
} catch {
  // dotenv is optional (production hosts inject real environment variables).
}

const { REST, Routes } = require("discord.js");
const { config } = require("./src/config");
const logger = require("./src/utils/logger");
const commandHandler = require("./src/handlers/commandHandler");

async function clearLegacyGuildCommands(rest) {
  if (!config.legacyGuildId) return false;
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.legacyGuildId), { body: [] });
  logger.info(`Legacy guild-scoped commands cleared on guild ${config.legacyGuildId}.`);
  return true;
}

async function main() {
  if (!config.token || config.token.startsWith("replace_with_")) {
    logger.error("DISCORD_TOKEN is missing or still a placeholder. Deployment aborted (no network call made).");
    process.exitCode = 1;
    return false;
  }
  if (!config.clientId) {
    logger.error("CLIENT_ID is missing. Deployment aborted (no network call made).");
    process.exitCode = 1;
    return false;
  }

  const commands = commandHandler.loadCommands();
  const rest = new REST({ version: "10" }).setToken(config.token);

  await clearLegacyGuildCommands(rest);

  const body = Array.from(commands.values()).map((command) => command.data.toJSON());
  logger.info(`Registering ${body.length} global slash commands...`);
  await rest.put(Routes.applicationCommands(config.clientId), { body });
  logger.success(`${body.length} global slash commands registered.`);
  return true;
}

if (require.main === module) {
  main().catch((error) => {
    logger.error("Command deployment failed.", { error: error?.message || String(error) });
    process.exitCode = 1;
  });
}

module.exports = { main, clearLegacyGuildCommands };
