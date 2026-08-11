"use strict";

// Centralized runtime configuration loaded from environment variables.
// Consumed notably by src/handlers/commandHandler.js (token, clientId) and the
// root bootstrap (index.js / deploy.js). No secret value may be hardcoded here.

try {
  require("dotenv").config();
} catch {
  // dotenv is optional (production hosts inject real environment variables).
}

const config = Object.freeze({
  token: process.env.DISCORD_TOKEN || null,
  clientId: process.env.CLIENT_ID || null,
  legacyGuildId: process.env.LEGACY_GUILD_ID || null,
  mongoUri: process.env.MONGO_URI || null,
  mongoDbName: process.env.MONGO_DB_NAME || "civrat",
});

module.exports = { config };
