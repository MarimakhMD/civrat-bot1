"use strict";

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const { ErrorResponder } = require("../core/errors");
const { I18nService, dictionaries } = require("../core/i18n");
const { DiscordResponseTransport } = require("../adapters/discord/DiscordResponseTransport");
const { toCivratError } = require("../adapters/discord/discordErrorClassifier");

const commands = new Map();
const errorResponder = new ErrorResponder({ logger });
const i18n = new I18nService({ dictionaries });

// These files still exist while their modular equivalents are authoritative.
// Loading both implementations would create duplicate slash commands.
const MIGRATED_LEGACY_FILES = Object.freeze(["warn.js", "mute.js", "unmute.js"]);

function safeErrorDetails(error, extra = {}) {
  return {
    ...extra,
    errorType: error?.name || typeof error,
    errorCode: typeof error?.code === "string" || typeof error?.code === "number" ? error.code : null,
  };
}

function loadCommands() {
  const commandsPath = path.join(__dirname, "..", "commands");
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js") && !MIGRATED_LEGACY_FILES.includes(file))
    .sort();

  commands.clear();
  logger.info("Scanning legacy command adapters", {
    directory: "src/commands",
    commandCount: commandFiles.length,
  });

  for (const file of commandFiles) {
    try {
      const command = require(path.join(commandsPath, file));
      if (!command?.data?.name || typeof command.execute !== "function") {
        logger.warn("Invalid command ignored", { file });
        continue;
      }
      commands.set(command.data.name, command);
      logger.info("Legacy command adapter loaded", { command: command.data.name });
    } catch (error) {
      logger.error("Failed to load legacy command adapter", safeErrorDetails(error, { file }));
    }
  }

  try {
    const { getDiscordModuleCommands } = require("../runtime/registerModuleCommands");
    for (const command of getDiscordModuleCommands()) {
      if (commands.has(command.data.name)) throw new Error(`Duplicate module command: /${command.data.name}`);
      commands.set(command.data.name, command);
      logger.info("Module command loaded", { command: command.data.name });
    }
  } catch (error) {
    logger.error("Failed to load modular commands", safeErrorDetails(error));
  }

  logger.success("Commands loaded", {
    commandCount: commands.size,
    legacyAdapterCount: commandFiles.length,
  });
  return commands;
}

async function handleCommand(interaction) {
  if (commands.size === 0) loadCommands();
  const command = commands.get(interaction.commandName);
  if (!command) return false;

  try {
    await command.execute(interaction);
    return true;
  } catch (error) {
    const mapped = toCivratError(error, { operation: "legacy_command", resource: "discord_command" });
    const locale = interaction.locale || interaction.guildLocale || interaction.guild?.preferredLocale || "fr";
    await errorResponder.respond({
      error: mapped,
      context: {
        guildId: interaction.guildId || null,
        channelId: interaction.channelId || interaction.channel?.id || null,
        userId: interaction.user?.id || null,
        t: i18n.forLocale(locale),
      },
      transport: new DiscordResponseTransport(interaction),
    });
    return true;
  }
}

module.exports = { loadCommands, handleCommand };
