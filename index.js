"use strict";

// CIVRAT runtime bootstrap.
// Creates the Discord client, loads the event listeners from src/events
// (each delegating to the modular runtimes), loads slash commands, connects
// optional MongoDB persistence, and logs in. Requiring this file does NOT
// start the bot: startup only happens via `node index.js` (see bottom guard),
// so the bootstrap can be verified offline without a token.

try {
  require("dotenv").config();
} catch {
  // dotenv is optional (production hosts inject real environment variables).
}

const fs = require("node:fs");
const path = require("node:path");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { config } = require("./src/config");
const logger = require("./src/utils/logger");
const commandHandler = require("./src/handlers/commandHandler");
const { deployCommands } = require("./deploy");

// Intents required by the event listeners actually present in src/events:
// - Guilds: base guild data, channel/role/thread events, interactions
// - GuildMembers (privileged): guildMemberAdd/Remove/Update
// - GuildModeration: guildBanAdd/guildBanRemove
// - GuildMessages: messageCreate/Update/Delete/DeleteBulk
// - MessageContent (privileged): message content read by AutoMod and XP
// - GuildVoiceStates: voiceStateUpdate (Temp Voice)
// - GuildInvites: inviteCreate/inviteDelete (invite tracking + logs)
const INTENTS = Object.freeze([
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildInvites,
]);

// Allow logs and member events to fire for entities not present in cache
// (deleted/uncached messages, departing members).
const PARTIALS = Object.freeze([Partials.Message, Partials.Channel, Partials.GuildMember]);

function buildClient() {
  return new Client({ intents: [...INTENTS], partials: [...PARTIALS] });
}

function loadEvents(client, eventsDirectory = path.join(__dirname, "src", "events")) {
  const files = fs
    .readdirSync(eventsDirectory)
    .filter((file) => file.endsWith(".js"))
    .sort();
  const loaded = [];
  for (const file of files) {
    const event = require(path.join(eventsDirectory, file));
    if (!event || typeof event.name !== "string" || typeof event.execute !== "function") {
      logger.warn(`Invalid event file skipped: ${file}`);
      continue;
    }
    // A failing listener must never crash the process or break other listeners.
    const listener = (...args) =>
      Promise.resolve()
        .then(() => event.execute(...args))
        .catch((error) => logger.error(`Event ${event.name} failed`, { error: error?.message || String(error) }));
    if (event.once) client.once(event.name, listener);
    else client.on(event.name, listener);
    loaded.push(event.name);
  }
  logger.info(`Events loaded: ${loaded.length} (${loaded.join(", ")})`);
  return loaded;
}

// MongoDB is optional: without MONGO_URI the bot still starts, but dynamic
// features (XP, invite statistics) may be unavailable (documented behavior).
async function connectMongo({ mongooseModule } = {}) {
  if (!config.mongoUri) {
    logger.info("MONGO_URI not set — MongoDB-dependent features are disabled.");
    return false;
  }
  try {
    const mongoose = mongooseModule || require("mongoose");
    await mongoose.connect(config.mongoUri, { dbName: config.mongoDbName });
    logger.success("MongoDB connected.");
    return true;
  } catch (error) {
    logger.error("MongoDB connection failed — continuing without it.", { error: error?.message || String(error) });
    return false;
  }
}

async function main() {
  if (!config.token || config.token.startsWith("replace_with_")) {
    logger.error("DISCORD_TOKEN is missing or still a placeholder. Set it in the environment or .env.");
    process.exitCode = 1;
    return null;
  }
  if (!config.clientId) {
    logger.error("CLIENT_ID is missing. Set it in the environment or .env.");
    process.exitCode = 1;
    return null;
  }

  const client = buildClient();
  loadEvents(client);
  const commands = commandHandler.loadCommands();
  logger.info(`${commands.size} slash commands available.`);

  // Optional one-shot deploy at startup, controlled by DEPLOY_COMMANDS.
  // DEPLOY_COMMANDS=1  -> load (already done) + deploy + verify + log, then
  //                       continue with the normal bot startup.
  // any other value   -> normal startup, no deploy (no PUT on every restart).
  if (config.deployCommands) {
    logger.info("DEPLOY_COMMANDS=1 — deploying slash commands before login.");
    try {
      await deployCommands({ commands });
    } catch (error) {
      // A failing deploy must never prevent the bot from coming online.
      logger.error("Startup deployment failed — bot startup continues.", {
        error: error?.message || String(error),
      });
    }
  } else {
    logger.info("DEPLOY_COMMANDS is not '1' — deploy skipped (normal startup).");
  }

  await connectMongo();

  client.once("ready", () => {
    logger.success(`CIVRAT is online as ${client.user.tag}.`);
  });

  await client.login(config.token);
  return client;
}

if (require.main === module) {
  main().catch((error) => {
    logger.error("Fatal startup failure.", { error: error?.message || String(error) });
    process.exitCode = 1;
  });
}

module.exports = { buildClient, loadEvents, connectMongo, main, INTENTS, PARTIALS };
