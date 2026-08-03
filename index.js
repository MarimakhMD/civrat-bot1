// ═══════════════════════════════════════════════════
// CIVRAT BOT v2.0 - Main Entry Point
// ═══════════════════════════════════════════════════
// Architecture: Modular, Supabase-Integrated, Production-Grade
//
// Supabase = single source of truth for guild configuration
// MongoDB = analytics, XP, runtime state, caches
// Express + Socket.IO = dashboard API
// ═══════════════════════════════════════════════════

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { config, validateConfig } = require("./src/config");
const { connectMongo } = require("./src/config/database");
const { loadCommands } = require("./src/handlers/commandHandler");
const { loadEvents } = require("./src/handlers/eventHandler");
const guildConfigService = require("./src/services/guildConfig");
const logger = require("./src/utils/logger");
const giveawayService = require("./src/services/giveawayService");

// ═══════════════════════════════════════════════════
// VALIDATE CONFIG
// ═══════════════════════════════════════════════════
validateConfig();

// ═══════════════════════════════════════════════════
// CREATE DISCORD CLIENT
// FIX: Added Partials to handle partial messages/events
// FIX: Added GuildModeration intent for ban/unban events
// ═══════════════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// ═══════════════════════════════════════════════════
// STARTUP SEQUENCE
// ═══════════════════════════════════════════════════
async function start() {
  // 1. Connect to MongoDB (for analytics/XP/runtime)
  await connectMongo();

  // 2. Load commands & events
  loadCommands();
  loadEvents(client);

  // 3. Start API server (Express). Slash commands are deployed explicitly
  // with `node deploy.js` / `npm run deploy`, never on normal bot startup.

  // 4. Start API server (Express)
  try {
    const { createServer } = require("./src/api/server");
    createServer(client);
  } catch (err) {
    logger.warn("API server not started:", err.message);
  }

  // 5. Login to Discord
  await client.login(config.token);

  // 6. Start module schedulers after the Discord client is available
  startCountingInterval();
  startGiveawayInterval();
}

// ═══════════════════════════════════════════════════
// COUNTING AUTO-CONTINUE
// ═══════════════════════════════════════════════════
function startCountingInterval() {
  const mongoose = require("mongoose");
  const CountingGame = mongoose.models.CountingGame;

  if (!CountingGame) return;

  setInterval(async () => {
    try {
      const games = await CountingGame.find({
        lastMessageTime: { $lt: new Date(Date.now() - 86400000) },
      });

      for (const game of games) {
        const channel = client.channels.cache.get("1490014117745004637");
        if (!channel) continue;

        const nextNumber = (game.lastNumber || 0) + 1;
        await channel.send(`${nextNumber}`).catch(() => {});

        game.lastNumber = nextNumber;
        game.lastUserId = null;
        game.lastMessageTime = new Date();
        await game.save();

        logger.info(`Auto-count: sent ${nextNumber}`);
      }
    } catch (err) {
      logger.error("Counting interval error:", err.message);
    }
  }, 60000);
}

function startGiveawayInterval() {
  // The query is persisted in Supabase, so active giveaways are resumed after a restart.
  giveawayService.endDueGiveaways(client);
  setInterval(() => giveawayService.endDueGiveaways(client), 60_000);
}

// ═══════════════════════════════════════════════════
// GLOBAL ERROR HANDLERS
// ═══════════════════════════════════════════════════
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection:", reason);
});

process.on("SIGINT", async () => {
  logger.warn("Shutting down...");
  guildConfigService.clearAllCache();
  client.destroy();
  process.exit(0);
});

// ═══════════════════════════════════════════════════
// START THE BOT
// ═══════════════════════════════════════════════════
start().catch((err) => {
  logger.error("Fatal startup error:", err);
  process.exit(1);
});
