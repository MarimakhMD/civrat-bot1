#!/usr/bin/env node
"use strict";

/**
 * Vérification du catalogue de slash-commandes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 0 — PÉRIMÈTRE ÉTENDU À L'ARCHITECTURE RÉELLE
 * ─────────────────────────────────────────────────────────────────────────────
 * L'ancienne version de ce script ne lisait QUE `src/commands/*.js` en regex :
 * 2 fichiers (`captcha.js`, `ticketpanel.js`). Les 21 commandes modulaires
 * exposées par la composition runtime n'étaient donc jamais vérifiées — le
 * contrôle passait au vert alors que 91 % du catalogue n'était pas inspecté.
 *
 * Ce script vérifie désormais les 23 commandes réellement livrées :
 *   22 commandes globales  +  1 commande technique guild-scoped (`/admin`).
 *
 * DEUX NIVEAUX DE CONTRÔLE, volontairement conservés tous les deux :
 *
 *   1. STATIQUE  — contrat de fichier des adapters legacy de `src/commands/`.
 *      Ne charge rien : détecte un fichier cassé avant tout `require`.
 *
 *   2. RÉEL      — charge le catalogue via `commandHandler.loadCommands()`,
 *      donc la composition runtime complète (`createGuildSettingsRuntime`),
 *      puis le plan de déploiement via `prepareDeploymentPlan()`.
 *
 * SOURCE DE VÉRITÉ UNIQUE : la liste attendue est importée de `deploy.js`
 * (`EXPECTED_GLOBAL_COMMAND_NAMES`). Ce script ne déclare AUCUNE seconde liste :
 * deux listes finiraient par diverger, et c'est précisément la dérive que la
 * Phase 0 supprime.
 *
 * AUCUN COMPORTEMENT MODIFIÉ : ce script ne fait que LIRE. Il ne déploie rien,
 * n'appelle aucune API Discord, ne touche ni au catalogue ni aux permissions.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const issues = [];

function fail(message) {
  issues.push(message);
}

// Contraintes Discord sur le nom d'une commande (application command).
const COMMAND_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;
// Contraintes Discord sur la description.
const DESCRIPTION_MAX_LENGTH = 100;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Contrôle STATIQUE des adapters legacy (src/commands/*.js)
// ─────────────────────────────────────────────────────────────────────────────
function verifyStaticAdapters() {
  const commandsDirectory = path.join(root, "src", "commands");
  if (!fs.existsSync(commandsDirectory)) {
    fail("src/commands directory is missing");
    return [];
  }

  const commandFiles = fs
    .readdirSync(commandsDirectory)
    .filter((file) => file.endsWith(".js"))
    .sort();

  const names = new Map();

  for (const file of commandFiles) {
    const relative = path.relative(root, path.join(commandsDirectory, file));
    const source = fs.readFileSync(path.join(commandsDirectory, file), "utf8");
    const nameMatch = source.match(/\.setName\(\s*["']([a-z0-9_-]{1,32})["']\s*\)/);
    const hasData = /\bdata\s*:\s*new\s+SlashCommandBuilder\b/.test(source);
    const hasExecute = /\basync\s+execute\s*\(/.test(source) || /\bexecute\s*:\s*async\b/.test(source);

    if (!hasData || !hasExecute || !nameMatch) {
      fail(`Invalid static command contract: ${relative}`);
      continue;
    }
    if (names.has(nameMatch[1])) {
      fail(`Duplicate static command name: /${nameMatch[1]} in ${names.get(nameMatch[1])} and ${relative}`);
      continue;
    }
    names.set(nameMatch[1], relative);
  }

  return [...names.keys()];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Contrôle RÉEL du catalogue chargé + du plan de déploiement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `commandHandler.loadCommands()` journalise chaque commande chargée. Ces lignes
 * sont utiles au démarrage du bot mais noieraient la sortie d'un `npm run check`
 * — et leur présence rendrait le résultat difficile à lire de façon
 * déterministe. Le logger est donc neutralisé le temps du chargement, puis
 * restauré dans un `finally` : aucune modification durable du runtime.
 */
function loadCatalogQuietly(commandHandler) {
  const logger = require(path.join(root, "src", "utils", "logger"));
  const original = {};
  for (const key of Object.keys(logger)) {
    if (typeof logger[key] === "function") {
      original[key] = logger[key];
      logger[key] = () => {};
    }
  }
  try {
    return commandHandler.loadCommands();
  } finally {
    for (const [key, value] of Object.entries(original)) logger[key] = value;
  }
}

function verifyLoadedCatalog() {
  const commandHandler = require(path.join(root, "src", "handlers", "commandHandler"));
  const {
    prepareDeploymentPlan,
    validateDeploymentPlan,
    EXPECTED_GLOBAL_COMMAND_NAMES,
  } = require(path.join(root, "deploy"));

  let loaded;
  try {
    loaded = loadCatalogQuietly(commandHandler);
  } catch (error) {
    fail(`Unable to load the command catalog: ${error && error.message ? error.message : String(error)}`);
    return null;
  }

  if (!(loaded instanceof Map) || loaded.size === 0) {
    fail("Command catalog is empty — the runtime composition did not produce any command");
    return null;
  }

  // ── Validité de chaque commande chargée ──
  const names = new Set();
  for (const [name, command] of loaded) {
    if (!command || !command.data || typeof command.data.toJSON !== "function") {
      fail(`/${name}: missing SlashCommandBuilder data`);
      continue;
    }
    if (typeof command.execute !== "function") {
      fail(`/${name}: missing execute()`);
    }
    if (!COMMAND_NAME_PATTERN.test(name)) {
      fail(`/${name}: name does not match Discord constraints ${COMMAND_NAME_PATTERN}`);
    }
    if (names.has(name)) fail(`/${name}: duplicate command name`);
    names.add(name);
  }

  // ── Plan de déploiement : scopes global / technique ──
  let plan;
  try {
    plan = prepareDeploymentPlan(loaded);
  } catch (error) {
    fail(`Unable to prepare the deployment plan: ${error && error.message ? error.message : String(error)}`);
    return null;
  }

  const globalNames = plan.global.map((command) => command.name).sort();
  const technicalNames = plan.technical.map((command) => command.name);
  const expected = [...EXPECTED_GLOBAL_COMMAND_NAMES].sort();

  // Le préflight hors-ligne de deploy.js (payload vide, noms dupliqués, nom >32,
  // description >100) est réutilisé tel quel : un seul validateur, pas deux.
  for (const issue of validateDeploymentPlan(plan)) fail(`deployment plan: ${issue}`);

  if (JSON.stringify(globalNames) !== JSON.stringify(expected)) {
    const missing = expected.filter((name) => !globalNames.includes(name));
    const extra = globalNames.filter((name) => !expected.includes(name));
    fail(
      `global catalog mismatch — expected ${expected.length}, received ${globalNames.length}`
      + (missing.length ? `; missing: ${missing.join(", ")}` : "")
      + (extra.length ? `; unexpected: ${extra.join(", ")}` : "")
    );
  }

  if (technicalNames.length !== 1 || technicalNames[0] !== "admin") {
    fail(`technical catalog must contain only /admin — received: ${technicalNames.join(", ") || "(none)"}`);
  }

  const total = plan.global.length + plan.technical.length;

  // ── Descriptions : Discord refuse une description absente ou > 100 ──
  for (const command of [...plan.global, ...plan.technical]) {
    if (typeof command.description !== "string" || command.description.length === 0) {
      fail(`/${command.name}: empty description`);
    } else if (command.description.length > DESCRIPTION_MAX_LENGTH) {
      fail(`/${command.name}: description longer than ${DESCRIPTION_MAX_LENGTH} characters`);
    }
  }

  return {
    total,
    globalCount: plan.global.length,
    technicalCount: plan.technical.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exécution
// ─────────────────────────────────────────────────────────────────────────────
const staticNames = verifyStaticAdapters();
const loaded = verifyLoadedCatalog();

if (issues.length > 0) {
  for (const issue of issues) console.error(`Command verification failed: ${issue}`);
  console.error(`Command verification failed: ${issues.length} issue(s).`);
  process.exit(1);
}

const summary = loaded
  ? `${loaded.total} command(s) verified — ${loaded.globalCount} global + ${loaded.technicalCount} technical (/admin), including ${staticNames.length} static adapter(s)`
  : `${staticNames.length} static adapter(s) verified`;

console.log(`Command verification passed: ${summary}.`);
