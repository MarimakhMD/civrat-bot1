"use strict";

// CIVRAT slash-command deployment.
//
// Registers the full command list (legacy adapters + modular commands exposed
// by the runtime composition) through the Discord REST API.
//
// Target (see src/config/index.js):
//   - DEPLOY_GUILD_ID set  -> guild-scoped deploy (instant propagation, useful
//                             while testing). Endpoint: applicationGuildCommands.
//   - DEPLOY_GUILD_ID unset -> global deploy (documented Discord propagation
//                             delay). Endpoint: applicationCommands.
//
// Safety: this module NEVER logs the bot token, the client/application id, the
// guild id, or any command payload. It logs only non-secret facts: command
// counts, the HTTP status, the Discord error code, and the endpoint template.
//
// Used in two ways:
//   - standalone: `node deploy.js` / `npm run deploy` (sets a non-zero exit
//     code when the deploy fails);
//   - from index.js when DEPLOY_COMMANDS=1 (best-effort: the bot still starts
//     even if the deploy fails).

try {
  require("dotenv").config();
} catch {
  // dotenv is optional (production hosts inject real environment variables).
}

const { REST, Routes } = require("discord.js");
const { config } = require("./src/config");
const logger = require("./src/utils/logger");
const commandHandler = require("./src/handlers/commandHandler");

// Non-secret labels for the endpoints we call. Never built from URLs: the
// actual ids are intentionally left out of every log line.
const ENDPOINT_LABEL = Object.freeze({
  global: "PUT /applications/{clientId}/commands",
  guild: "PUT /applications/{clientId}/guilds/{guildId}/commands",
  legacyClear: "PUT /applications/{clientId}/guilds/{legacyGuildId}/commands (legacy clear)",
});

// Extracts only safe, non-secret fields from an error.
// `url` and `requestBody` are deliberately ignored (they can contain ids/payload).
// - Discord API errors expose `status` (HTTP) and `code` (numeric Discord code).
// - Network errors expose a string Node code (e.g. ECONNRESET, ENOTFOUND) and no
//   Discord response at all; we surface that distinction honestly.
function describeError(error) {
  return {
    status: typeof error?.status === "number" ? error.status : null,
    code: typeof error?.code === "number" ? error.code : null,
    networkCode: typeof error?.code === "string" ? error.code : null,
    method: typeof error?.method === "string" ? error.method : null,
  };
}

// Maps well-known Discord error codes/status to actionable, non-secret hints.
function logDiscordHint(code, status) {
  const byCode = {
    50001: "Missing Access — cause la plus fréquente : le scope OAuth2 'applications.commands' manque sur l'installation du bot. Ré-inviter le bot avec scope=bot%20applications.commands. Sinon, vérifier que CLIENT_ID est bien l'application ID (et non le bot ID).",
    50035: "Invalid Form Body — le payload d'une commande est invalide (Discord renvoie la liste des erreurs).",
    429: "Rate limit Discord — réessayer plus tard.",
  };
  if (code !== null && byCode[code]) {
    logger.info(`Hint: ${byCode[code]}`);
    return;
  }
  if (status === 401) {
    logger.info("Hint: Authentification refusée — vérifier DISCORD_TOKEN.");
  } else if (status === 404) {
    logger.info("Hint: Application introuvable — vérifier CLIENT_ID (application ID).");
  }
}

// Lightweight offline preflight: catches the obvious payload problems before
// any network call is made. Returns a list of human-readable issues.
function validatePayload(body) {
  const issues = [];
  if (!Array.isArray(body) || body.length === 0) {
    issues.push("payload is empty");
    return issues;
  }
  const names = new Set();
  for (const command of body) {
    if (!command || typeof command.name !== "string") {
      issues.push("a command has no name");
      continue;
    }
    if (names.has(command.name)) issues.push(`duplicate command: /${command.name}`);
    names.add(command.name);
    if (command.name.length > 32) issues.push(`name too long (>32): /${command.name}`);
    if (typeof command.description === "string" && command.description.length > 100) {
      issues.push(`description too long (>100): /${command.name}`);
    }
  }
  return issues;
}

// Clears historically guild-scoped commands registered on LEGACY_GUILD_ID.
// Kept for backward compatibility (see docs/archive/INTEGRATION_SUMMARY.md).
// Failures here are non-fatal and never leak any secret.
async function clearLegacyGuildCommands(rest, clientId) {
  if (!config.legacyGuildId) return false;
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, config.legacyGuildId), { body: [] });
    logger.info(`Legacy guild-scoped commands cleared (legacy guild configured).`);
    return true;
  } catch (error) {
    const detail = describeError(error);
    if (detail.status === null && detail.code === null && detail.networkCode) {
      logger.warn(
        `Legacy guild clear failed — network error (${detail.networkCode}) (${ENDPOINT_LABEL.legacyClear}). Continuing with the main deploy.`
      );
    } else {
      logger.warn(
        `Legacy guild clear failed — HTTP ${detail.status ?? "?"}, Discord code ${detail.code ?? "?"} (${ENDPOINT_LABEL.legacyClear}). Continuing with the main deploy.`
      );
    }
    return false;
  }
}

// Shared deployment routine. Returns { ok, sent, registered, status, code }.
// Never throws for Discord API failures: it reports them and returns ok=false.
async function deployCommands({ commands = null, rest = null } = {}) {
  if (!config.token || config.token.startsWith("replace_with_")) {
    logger.error("DISCORD_TOKEN is missing or still a placeholder. Deployment aborted (no network call made).");
    return { ok: false, sent: 0, registered: null, status: null, code: null };
  }
  if (!config.clientId) {
    logger.error("CLIENT_ID is missing. Deployment aborted (no network call made).");
    return { ok: false, sent: 0, registered: null, status: null, code: null };
  }

  const loaded = commands || commandHandler.loadCommands();
  const body = Array.from(loaded.values()).map((command) => command.data.toJSON());

  for (const issue of validatePayload(body)) {
    logger.warn(`Payload warning: ${issue}`);
  }

  const guildId = config.deployGuildId || null;
  const endpointLabel = guildId ? ENDPOINT_LABEL.guild : ENDPOINT_LABEL.global;

  logger.info("Discord deployment started");
  logger.info(`${body.length} commands prepared (${guildId ? "guild-scoped" : "global"}).`);

  const restClient = rest || new REST({ version: "10" }).setToken(config.token);

  // Historical guild-scoped cleanup only makes sense for a global deploy.
  if (!guildId) {
    await clearLegacyGuildCommands(restClient, config.clientId);
  }

  const route = guildId
    ? Routes.applicationGuildCommands(config.clientId, guildId)
    : Routes.applicationCommands(config.clientId);

  try {
    await restClient.put(route, { body });
  } catch (error) {
    const detail = describeError(error);
    if (detail.status === null && detail.code === null && detail.networkCode) {
      logger.error(
        `Deployment failed — network error (${detail.networkCode}), endpoint ${endpointLabel}. No Discord response received.`
      );
    } else {
      logger.error(
        `Deployment failed — HTTP ${detail.status ?? "?"}, Discord code ${detail.code ?? "?"}, endpoint ${endpointLabel}.`
      );
      logDiscordHint(detail.code, detail.status);
    }
    return { ok: false, sent: body.length, registered: null, ...detail };
  }

  logger.success("Deployment successful");
  logger.info(`${body.length} commands registered (${guildId ? "guild-scoped" : "global"}).`);

  // Post-deploy verification: read back the commands and compare the count.
  try {
    const registered = await restClient.get(route);
    const count = Array.isArray(registered) ? registered.length : null;
    logger.info(`Read-back: ${count ?? "?"} commands currently registered.`);
    if (count !== null && count !== body.length) {
      logger.warn(`Read-back mismatch: sent ${body.length}, Discord reports ${count}.`);
    }
    return { ok: true, sent: body.length, registered: count };
  } catch (error) {
    const detail = describeError(error);
    logger.warn(
      `Read-back failed — HTTP ${detail.status ?? "?"}, Discord code ${detail.code ?? "?"}. The deploy itself succeeded.`
    );
    return { ok: true, sent: body.length, registered: null };
  }
}

async function main() {
  const result = await deployCommands();
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    logger.error("Command deployment failed.", { error: error?.message || String(error) });
    process.exitCode = 1;
  });
}

module.exports = { main, deployCommands, clearLegacyGuildCommands };
