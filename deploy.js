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
// Maintenance prints a per-target JSON report (IDs and command schemas, never
// credentials). Both start.js and this CLI use the same explicit target /
// preview / confirmation workflow. See docs/operations/command-maintenance.md.

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

function isSnowflake(value) {
  return typeof value === "string" && /^\d{15,21}$/.test(value);
}

// Deprecated: implicit historical cleanup must never write.
async function clearLegacyGuildCommands() {
  throw new Error("Implicit legacy clear disabled; use explicit maintenance targets");
}

const EXPECTED_GLOBAL_COMMAND_NAMES = Object.freeze([
  "analytics",
  "analytics_invites",
  "analytics_xp",
  "automod",
  "bannir",
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
  // Image Welcome personnalisée (Premium) : téléversement par pièce jointe.
  // Une modale Discord ne peut pas porter de sélecteur de fichier.
  "welcomeimage",
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

// Compatibility API: preview by default, confirmed application only. Normal
// guild targets are reconciled to an empty local catalog, not duplicate globals.
async function deployCommands({ commands = null, rest = null, guildId = undefined, apply = false, confirm = null } = {}) {
  if (guildId !== undefined && !isSnowflake(guildId)) return { ok: false, blocked: "Invalid guild target" };
  const catalog = prepareDeploymentPlan(commands || commandHandler.loadCommands());
  if (validateDeploymentPlan(catalog).length || validatePayload(catalog.global).length || validatePayload(catalog.technical).length) return { ok: false, blocked: "Invalid catalog" };
  return require("./src/deployment/commandMaintenance").maintainCommands({
    rest: rest || new REST({ version: "10" }).setToken(config.token),
    clientId: config.clientId, adminGuildId: config.civratAdminGuildId,
    action: "deploy", targets: guildId === undefined ? { global: true, guildIds: [config.civratAdminGuildId] } : { guildIds: [guildId] },
    catalog, apply, confirm,
  });
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
async function clearGuildCommands({ rest = null, guildId = null, apply = false, confirm = null } = {}) {
  if (!isSnowflake(guildId)) return { ok: false, blocked: "Invalid guild target" };
  return require("./src/deployment/commandMaintenance").maintainCommands({
    rest: rest || new REST({ version: "10" }).setToken(config.token),
    clientId: config.clientId, adminGuildId: config.civratAdminGuildId,
    action: "clear", targets: { guildIds: [guildId] }, apply, confirm,
  });
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

async function main(argv = process.argv.slice(2)) {
  const { maintenanceCli, parseMaintenanceArgs } = require("./src/deployment/maintenanceCli");
  parseMaintenanceArgs(argv);
  if (!config.token || config.token.startsWith("replace_with_")) throw new Error("DISCORD_TOKEN missing");
  const catalog = prepareDeploymentPlan(commandHandler.loadCommands());
  const issues = [...validateDeploymentPlan(catalog), ...validatePayload(catalog.global), ...validatePayload(catalog.technical)];
  if (issues.length) throw new Error("Invalid deployment catalog");
  const result = await maintenanceCli(argv, {
    rest: new REST({ version: "10" }).setToken(config.token), config, catalog,
  });
  console.log(JSON.stringify(result, null, 2));
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
