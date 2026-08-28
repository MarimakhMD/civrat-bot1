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
  // Deploy opt-in at startup (see deploy.js). "1" (or "true") runs a one-shot
  // deploy before login; any other value means normal startup, no deploy.
  deployCommands: ["1", "true"].includes(String(process.env.DEPLOY_COMMANDS || "").toLowerCase()),
  // Optional guild-scoped deploy target. When set, deploy.js registers to this
  // guild (instant propagation) instead of globally. Public id, never logged.
  deployGuildId: process.env.DEPLOY_GUILD_ID || null,
  mongoUri: process.env.MONGO_URI || null,
  mongoDbName: process.env.MONGO_DB_NAME || "civrat",
  // P20 Recovery — NOMS documentés uniquement. Les valeurs réelles vivent
  // exclusivement dans les variables du hosting ; le service Recovery les
  // relit à la demande dans process.env (jamais copiées, jamais loggées).
  // Ces propriétés figées servent de référence de nommage (null par défaut).
  recoveryMasterCode: process.env.RECOVERY_MASTER_CODE || null,
  recoveryEmail: process.env.RECOVERY_EMAIL || null,
  smtpHost: process.env.SMTP_HOST || null,
  smtpPort: process.env.SMTP_PORT || null,
  smtpUser: process.env.SMTP_USER || null,
  smtpPassword: process.env.SMTP_PASSWORD || null,
  // P20 Owner Panel — même discipline : NOMS documentés, valeurs jamais
  // ici. CIVRAT_OWNER_ID = Owner initial (un ID Discord, non un secret) ;
  // les deux codes sont des secrets env-only relus à la demande.
  civratOwnerId: process.env.CIVRAT_OWNER_ID || null,
  ownerPanelMasterCode: process.env.OWNER_PANEL_MASTER_CODE || null,
  ownerTransferCode: process.env.OWNER_TRANSFER_CODE || null,
});

module.exports = { config };
