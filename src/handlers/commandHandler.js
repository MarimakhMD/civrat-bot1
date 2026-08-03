// ═══════════════════════════════════════════════════
// COMMAND HANDLER - Loads and dispatches slash commands
// ═══════════════════════════════════════════════════

const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");
const { config } = require("../config");
const logger = require("../utils/logger");

const commands = new Map();

function loadCommands() {
  const commandsPath = path.join(__dirname, "..", "commands");
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"))
    .sort();

  // Makes a repeated in-process load deterministic and exposes the exact
  // directory/count being executed in hosting logs.
  commands.clear();
  logger.info(`Scanning ${commandFiles.length} command files in ${commandsPath}`);

  for (const file of commandFiles) {
    try {
      const command = require(path.join(commandsPath, file));
      if (command.data && command.execute) {
        commands.set(command.data.name, command);
        logger.info(`Loaded command: /${command.data.name}`);
      } else {
        logger.warn(`Invalid command file: ${file} (missing data or execute)`);
      }
    } catch (err) {
      logger.error(`Failed to load command ${file}:`, err.message);
    }
  }

  logger.success(`${commands.size} commands loaded (${commandFiles.length} files found)`);
  return commands;
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const commandData = Array.from(commands.values()).map((c) => c.data.toJSON());

  try {
    logger.info(`Registering ${commandData.length} slash commands globally...`);
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commandData,
    });
    logger.success(`${commandData.length} commands registered`);
  } catch (err) {
    logger.error("Failed to register commands:", err.message);
  }
}

async function handleCommand(interaction) {
  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    logger.error(`Command /${interaction.commandName} failed:`, err.message);
    const reply = {
      content: "❌ Une erreur est survenue lors de l'exécution de cette commande.",
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}

function getCommands() {
  return commands;
}

module.exports = { loadCommands, registerCommands, handleCommand, getCommands };
