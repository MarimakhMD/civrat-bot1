"use strict";

// CIVRAT slash-command deployment.
//
// Registers the full command list (legacy adapters + modular commands exposed
// by the runtime composition) through the Discord REST API.
//
// Targets (see src/config/index.js):
//   - 22 normal commands -> global applicationCommands endpoint;
//   - /admin only -> applicationGuildCommands for CIVRAT_ADMIN_GUILD_ID.
// No CLI/environment override may move /admin to another guild.
//
// Safety: this module NEVER logs the bot token, the client/application id, the
// guild id, or any command payload. It logs only non-secret facts: command
// counts, the HTTP status, the Discord error code, and the endpoint template.
//
// Used in two ways:
//   - standalone: `node deploy.js` / `npm run deploy` deploys the production
//     22+1 catalog, while `node deploy.js deploy <guildId>` updates one Guild
//     endpoint with a target-safe catalog;
//   - from index.js when DEPLOY_COMMANDS=1 (best-effort: the bot still starts
//     even if the production deploy fails).

try {
  require("dotenv").config();
} catch {
  // dotenv is optional (production hosts inject real environment variables).
}

const { REST, Routes } = require("discord.js");
const { config } = require("./src/config");
const logger = require("./src/utils/logger");
const commandHandler = require("./src/handlers/commandHandler");
const {
  CommandDeploymentScope,
  resolveCommandDeploymentScope,
} = require("./src/core/interactions");

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

function prepareDeploymentPlan(loaded) {
  const plan = {
    [CommandDeploymentScope.GLOBAL]: [],
    [CommandDeploymentScope.CIVRAT_ADMIN_GUILD]: [],
  };
  for (const command of loaded.values()) {
    const scope = resolveCommandDeploymentScope(command.deploymentScope);
    plan[scope].push(command.data.toJSON());
  }
  return Object.freeze({
    global: Object.freeze(plan[CommandDeploymentScope.GLOBAL]),
    technical: Object.freeze(plan[CommandDeploymentScope.CIVRAT_ADMIN_GUILD]),
  });
}

// Placeholder documenté dans .env.example : s'il est encore configuré, il ne
// correspond à aucune vraie guild et ne doit jamais déclencher un clear.
const LEGACY_GUILD_ID_PLACEHOLDER = "1234567890123456789";

function isSnowflake(value) {
  return typeof value === "string" && /^\d{15,21}$/.test(value);
}

// Clears historically guild-scoped commands registered on LEGACY_GUILD_ID.
// Kept for backward compatibility (see docs/archive/INTEGRATION_SUMMARY.md).
// Failures here are non-fatal and never leak any secret.
async function clearLegacyGuildCommands(rest, clientId) {
  if (!config.legacyGuildId) return false;
  if (config.legacyGuildId === LEGACY_GUILD_ID_PLACEHOLDER) {
    logger.info("LEGACY_GUILD_ID is still the documented placeholder — skipping legacy guild clear.");
    return false;
  }
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

const EXPECTED_GLOBAL_COMMAND_NAMES = Object.freeze([
  "analytics",
  "analytics_invites",
  "analytics_xp",
  "automod",
  "bannir",
  "captcha",
  "debannir",
  "deverrouiller",
  "expulser",
  "giveaway",
  "invites",
  "mute",
  "pseudo",
  "settings",
  "slowmode",
  "suggest",
  "supprimer",
  "ticketpanel",
  "unmute",
  "uploadsticker",
  "verrouiller",
  "warn",
]);

function validateDeploymentPlan(plan) {
  const issues = [];
  const globalNames = plan.global.map(({ name }) => name).sort();
  const expected = [...EXPECTED_GLOBAL_COMMAND_NAMES].sort();
  if (JSON.stringify(globalNames) !== JSON.stringify(expected)) {
    issues.push(`global command catalog mismatch (expected ${expected.length}, received ${globalNames.length})`);
  }
  const technicalNames = plan.technical.map(({ name }) => name);
  if (technicalNames.length !== 1 || technicalNames[0] !== "admin") {
    issues.push("technical command catalog must contain only /admin");
  }
  return issues;
}

async function putScope({ restClient, route, body, endpointLabel }) {
  try {
    await restClient.put(route, { body });
  } catch (error) {
    const detail = describeError(error);
    if (detail.status === null && detail.code === null && detail.networkCode) {
      logger.error(`Deployment failed — network error (${detail.networkCode}), endpoint ${endpointLabel}. No Discord response received.`);
    } else {
      logger.error(`Deployment failed — HTTP ${detail.status ?? "?"}, Discord code ${detail.code ?? "?"}, endpoint ${endpointLabel}.`);
      logDiscordHint(detail.code, detail.status);
    }
    return { ok: false, registered: null, ...detail };
  }

  try {
    const registered = await restClient.get(route);
    const count = Array.isArray(registered) ? registered.length : null;
    if (count !== null && count !== body.length) {
      logger.warn(`Read-back mismatch on ${endpointLabel}: sent ${body.length}, Discord reports ${count}.`);
    }
    return { ok: true, registered: count };
  } catch (error) {
    const detail = describeError(error);
    logger.warn(`Read-back failed on ${endpointLabel} — HTTP ${detail.status ?? "?"}, Discord code ${detail.code ?? "?"}. The PUT succeeded.`);
    return { ok: true, registered: null };
  }
}

// Without a target, deploys the production catalog through two explicit
// scopes: 22 normal commands globally and /admin only in the configured
// technical guild. A targeted deployment performs exactly one Guild PUT:
// normal guilds receive the 22 normal commands, while the technical guild
// receives /admin only. This keeps /admin impossible to redirect while
// preserving an instant, reversible preview workflow for normal commands.
async function deployCommands({ commands = null, rest = null, guildId = undefined } = {}) {
  const targeted = guildId !== undefined;
  if (targeted && !isSnowflake(String(guildId || ""))) {
    logger.error("The explicit deployment target is invalid. Deployment aborted (no network call made).");
    return { ok: false, sent: 0, registered: null, status: null, code: null };
  }
  if (!config.token || config.token.startsWith("replace_with_")) {
    logger.error("DISCORD_TOKEN is missing or still a placeholder. Deployment aborted (no network call made).");
    return { ok: false, sent: 0, registered: null, status: null, code: null };
  }
  if (!config.clientId) {
    logger.error("CLIENT_ID is missing. Deployment aborted (no network call made).");
    return { ok: false, sent: 0, registered: null, status: null, code: null };
  }
  if (!isSnowflake(config.civratAdminGuildId)) {
    logger.error("CIVRAT_ADMIN_GUILD_ID is invalid. Deployment aborted (no network call made).");
    return { ok: false, sent: 0, registered: null, status: null, code: null };
  }

  const loaded = commands || commandHandler.loadCommands();
  let plan;
  try {
    plan = prepareDeploymentPlan(loaded);
  } catch (error) {
    logger.error("Command deployment scope validation failed.", { error: error?.message || String(error) });
    return { ok: false, sent: 0, registered: null, status: null, code: null };
  }

  const issues = [
    ...validatePayload(plan.global).map((issue) => `global: ${issue}`),
    ...validatePayload(plan.technical).map((issue) => `technical: ${issue}`),
    ...validateDeploymentPlan(plan),
  ];
  if (issues.length > 0) {
    for (const issue of issues) logger.error(`Payload error: ${issue}`);
    logger.error("Deployment aborted before any network call.");
    return { ok: false, sent: 0, registered: null, status: null, code: null };
  }

  const restClient = rest || new REST({ version: "10" }).setToken(config.token);

  if (targeted) {
    const targetsTechnicalGuild = guildId === config.civratAdminGuildId;
    const body = targetsTechnicalGuild ? plan.technical : plan.global;
    const route = Routes.applicationGuildCommands(config.clientId, guildId);
    const scopeLabel = targetsTechnicalGuild ? "technical /admin" : "normal-command preview";

    logger.info(`Discord guild-scoped deployment started (${body.length} ${scopeLabel} command(s)).`);
    const guildResult = await putScope({
      restClient,
      route,
      body,
      endpointLabel: ENDPOINT_LABEL.guild,
    });
    if (guildResult.ok) logger.success("Guild-scoped deployment successful.");
    return {
      ok: guildResult.ok,
      mode: "guild",
      scope: targetsTechnicalGuild ? "technical" : "normal",
      sent: body.length,
      registered: guildResult.registered,
      global: null,
      technical: targetsTechnicalGuild ? { sent: body.length, ...guildResult } : null,
      guild: { sent: body.length, ...guildResult },
    };
  }

  const globalRoute = Routes.applicationCommands(config.clientId);
  const technicalRoute = Routes.applicationGuildCommands(config.clientId, config.civratAdminGuildId);

  logger.info("Discord deployment started (22 global commands + 1 technical command).");
  await clearLegacyGuildCommands(restClient, config.clientId);

  const globalResult = await putScope({
    restClient,
    route: globalRoute,
    body: plan.global,
    endpointLabel: ENDPOINT_LABEL.global,
  });
  if (!globalResult.ok) {
    return {
      ok: false,
      mode: "production",
      sent: plan.global.length,
      registered: globalResult.registered,
      global: globalResult,
      technical: null,
    };
  }

  const technicalResult = await putScope({
    restClient,
    route: technicalRoute,
    body: plan.technical,
    endpointLabel: ENDPOINT_LABEL.guild,
  });
  const ok = technicalResult.ok;
  if (ok) logger.success("Deployment successful: global and technical catalogs updated.");
  return {
    ok,
    mode: "production",
    sent: plan.global.length + plan.technical.length,
    registered: globalResult.registered !== null && technicalResult.registered !== null
      ? globalResult.registered + technicalResult.registered
      : null,
    global: { sent: plan.global.length, ...globalResult },
    technical: { sent: plan.technical.length, ...technicalResult },
  };
}

// Read-only listing of registered commands (global or guild-scoped). Useful to
// SEE exactly which commands are registered where before clearing anything.
async function listCommands({ rest = null, guildId = null } = {}) {
  if (guildId !== null && guildId !== undefined && !isSnowflake(String(guildId))) {
    logger.error("The explicit list target is invalid. Listing aborted (no network call made).");
    return { ok: false, commands: [] };
  }
  if (!config.token || config.token.startsWith("replace_with_")) {
    logger.error("DISCORD_TOKEN is missing or still a placeholder. Listing aborted (no network call made).");
    return { ok: false, commands: [] };
  }
  if (!config.clientId) {
    logger.error("CLIENT_ID is missing. Listing aborted (no network call made).");
    return { ok: false, commands: [] };
  }
  const restClient = rest || new REST({ version: "10" }).setToken(config.token);
  const route = guildId
    ? Routes.applicationGuildCommands(config.clientId, guildId)
    : Routes.applicationCommands(config.clientId);
  const scope = guildId ? "guild" : "global";
  try {
    const data = await restClient.get(route);
    const commands = Array.isArray(data) ? data : [];
    logger.info(`List ${scope} commands: ${commands.length} registered.`);
    for (const command of commands) {
      logger.info(`  /${command.name} (id=${command.id}) — "${command.description}"`);
    }
    return { ok: true, commands };
  } catch (error) {
    const detail = describeError(error);
    if (detail.status === null && detail.code === null && detail.networkCode) {
      logger.error(`List failed — network error (${detail.networkCode}). No Discord response received.`);
    } else {
      logger.error(`List failed — HTTP ${detail.status ?? "?"}, Discord code ${detail.code ?? "?"}.`);
      logDiscordHint(detail.code, detail.status);
    }
    return { ok: false, commands: [] };
  }
}

// Explicit, targeted clear of GUILD-SCOPED commands on one guild. This only
// affects `PUT /applications/{clientId}/guilds/{guildId}/commands` — the
// GLOBAL commands (the 22) are NEVER touched. Requires a valid guild id.
async function clearGuildCommands({ rest = null, guildId = null } = {}) {
  if (!isSnowflake(String(guildId || ""))) {
    logger.error("clear requires a valid guild id (Discord snowflake). Nothing was cleared.");
    return { ok: false, cleared: 0 };
  }
  if (!config.token || config.token.startsWith("replace_with_")) {
    logger.error("DISCORD_TOKEN is missing or still a placeholder. Clear aborted (no network call made).");
    return { ok: false, cleared: 0 };
  }
  if (!config.clientId) {
    logger.error("CLIENT_ID is missing. Clear aborted (no network call made).");
    return { ok: false, cleared: 0 };
  }
  const restClient = rest || new REST({ version: "10" }).setToken(config.token);
  const route = Routes.applicationGuildCommands(config.clientId, guildId);

  let before = 0;
  try {
    const data = await restClient.get(route);
    before = Array.isArray(data) ? data.length : 0;
    logger.info(`Guild has ${before} guild-scoped command(s) before clearing.`);
  } catch (error) {
    const detail = describeError(error);
    logger.warn(`Could not read guild commands before clearing (HTTP ${detail.status ?? "?"}, code ${detail.code ?? "?"}) — continuing.`);
  }

  try {
    await restClient.put(route, { body: [] });
    logger.success(`Guild-scoped commands cleared on the target guild (${before} removed). Global commands are untouched.`);
    return { ok: true, cleared: before };
  } catch (error) {
    const detail = describeError(error);
    if (detail.status === null && detail.code === null && detail.networkCode) {
      logger.error(`Clear failed — network error (${detail.networkCode}). No Discord response received.`);
    } else {
      logger.error(`Clear failed — HTTP ${detail.status ?? "?"}, Discord code ${detail.code ?? "?"}.`);
      logDiscordHint(detail.code, detail.status);
    }
    return { ok: false, cleared: 0 };
  }
}

// CLI: node deploy.js [deploy [guildId]] | [clear <guildId>] | [list [guildId]]
// Parsing preserves whether a target was explicitly supplied. An invalid
// explicit target must never collapse to the no-target production deploy.
function parseCliArgs(argv) {
  const [mode, arg, ...extra] = argv;
  if (extra.length > 0) return { mode: "invalid", guildId: null, targetProvided: true };

  if (mode === undefined) {
    return { mode: "deploy", guildId: null, targetProvided: false };
  }
  if (mode === "deploy") {
    if (arg === undefined) return { mode: "deploy", guildId: null, targetProvided: false };
    return {
      mode: "deploy",
      guildId: isSnowflake(arg) ? arg : null,
      targetProvided: true,
      invalidGuildId: !isSnowflake(arg),
    };
  }
  if (mode === "list") {
    if (arg === undefined) return { mode: "list", guildId: null, targetProvided: false };
    return {
      mode: "list",
      guildId: isSnowflake(arg) ? arg : null,
      targetProvided: true,
      invalidGuildId: !isSnowflake(arg),
    };
  }
  if (mode === "clear") {
    return {
      mode: "clear",
      guildId: isSnowflake(arg || "") ? arg : null,
      targetProvided: arg !== undefined,
      invalidGuildId: !isSnowflake(arg || ""),
    };
  }
  // Backward compatibility: `node deploy.js <guildId>` is a targeted deploy.
  if (isSnowflake(mode) && arg === undefined) {
    return { mode: "deploy", guildId: mode, targetProvided: true, invalidGuildId: false };
  }
  return { mode: "invalid", guildId: null, targetProvided: true, invalidGuildId: true };
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  const { mode, guildId } = parsed;
  if (mode === "invalid" || parsed.invalidGuildId) {
    logger.error("Invalid command or explicit guild id. No Discord request was made.");
    process.exitCode = 1;
    return { ok: false, sent: 0, registered: null, status: null, code: null };
  }
  if (mode === "clear") {
    const result = await clearGuildCommands({ guildId });
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  if (mode === "list") {
    const result = await listCommands({ guildId });
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  const result = parsed.targetProvided
    ? await deployCommands({ guildId })
    : await deployCommands();
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    logger.error("Command deployment failed.", { error: error?.message || String(error) });
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  deployCommands,
  prepareDeploymentPlan,
  validateDeploymentPlan,
  EXPECTED_GLOBAL_COMMAND_NAMES,
  clearLegacyGuildCommands,
  clearGuildCommands,
  listCommands,
  isSnowflake,
  parseCliArgs,
};
