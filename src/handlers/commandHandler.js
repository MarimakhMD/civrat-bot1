// ═══════════════════════════════════════════════════
// COMMAND HANDLER - Loads and dispatches slash commands
// ═══════════════════════════════════════════════════
// P17 — audit : seuls loadCommands (bootstrap index.js + deploy.js) et
// handleCommand (dispatcher interactionCreate) sont consommés. L'ancien
// registerCommands (doublon mort de deploy.js, zéro appelant) et getCommands
// (zéro appelant) ont été retirés, avec leurs imports REST/Routes/config.

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const commands = new Map();

// Garde anti-doublon : ces trois fichiers legacy existent ENCORE sur disque
// pendant que registerModeration expose leurs équivalents modulaires
// (référence V1). Sans exclusion, loadCommands chargerait warn/mute/unmute en
// double et l'enregistrement modulaire lèverait « Duplicate module command »,
// privant le bot de TOUTES les commandes modulaires. Les anciennes gardes
// bannir/debannir/expulser/supprimer/slowmode/verrouiller/deverrouiller/
// pseudo visaient des fichiers supprimés dans les phases précédentes : entrées
// mortes retirées (P17), comportement inchangé tant que les fichiers absents.
const MIGRATED_LEGACY_FILES = Object.freeze(["warn.js", "mute.js", "unmute.js"]);

function loadCommands() {
  const commandsPath = path.join(__dirname, "..", "commands");
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js") && !MIGRATED_LEGACY_FILES.includes(file))
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

  // New modular commands are declared by the runtime composition layer. Legacy
  // command files above remain unchanged during the progressive migration.
  try {
    const { getDiscordModuleCommands } = require("../runtime/registerModuleCommands");
    for (const command of getDiscordModuleCommands()) {
      if (commands.has(command.data.name)) throw new Error(`Duplicate module command: /${command.data.name}`);
      commands.set(command.data.name, command);
      logger.info(`Loaded module command: /${command.data.name}`);
    }
  } catch (err) {
    logger.error("Failed to load modular commands:", err.message);
  }

  logger.success(`${commands.size} commands loaded (${commandFiles.length} legacy files found)`);
  return commands;
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

module.exports = { loadCommands, handleCommand };
