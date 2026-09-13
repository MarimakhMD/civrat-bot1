"use strict";

/**
 * PHASE 0 — non-régression du catalogue de slash-commandes.
 *
 * Verrouille l'état réel du catalogue APRÈS la Phase 0 : 23 commandes livrées
 * (22 globales + `/admin` technique guild-scoped). La Phase 0 est une phase
 * purement technique : elle ne doit ajouter, retirer ni renommer AUCUNE
 * commande. Toute divergence ici signifie que l'outillage a touché au
 * fonctionnel.
 *
 * SOURCE DE VÉRITÉ : `EXPECTED_GLOBAL_COMMAND_NAMES` importé de deploy.js —
 * aucune seconde liste n'est déclarée dans ce test.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const commandHandler = require(path.join(ROOT, "src", "handlers", "commandHandler"));
const {
  prepareDeploymentPlan,
  validateDeploymentPlan,
  EXPECTED_GLOBAL_COMMAND_NAMES,
} = require(path.join(ROOT, "deploy"));

const COMMAND_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;

/** Nombre total attendu : 22 globales + 1 technique. */
const EXPECTED_TOTAL_COMMAND_COUNT = EXPECTED_GLOBAL_COMMAND_NAMES.length + 1;

function silence(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

// Chargé une seule fois : la composition runtime complète coûte plusieurs
// centaines de millisecondes et n'a pas à être répétée par assertion.
const loaded = silence(() => commandHandler.loadCommands());
const plan = prepareDeploymentPlan(loaded);
const globalNames = plan.global.map((command) => command.name).sort();
const technicalNames = plan.technical.map((command) => command.name);

test("PHASE0 — le catalogue contient exactement 23 commandes", () => {
  assert.equal(loaded.size, EXPECTED_TOTAL_COMMAND_COUNT, `attendu ${EXPECTED_TOTAL_COMMAND_COUNT}, obtenu ${loaded.size}`);
  assert.equal(plan.global.length + plan.technical.length, EXPECTED_TOTAL_COMMAND_COUNT);
});

test("PHASE0 — 22 commandes globales, noms identiques à deploy.js", () => {
  assert.deepEqual(globalNames, [...EXPECTED_GLOBAL_COMMAND_NAMES].sort());
});

test("PHASE0 — une seule commande technique : /admin", () => {
  assert.deepEqual(technicalNames, ["admin"]);
});

test("PHASE0 — le plan de déploiement passe le préflight hors-ligne de deploy.js", () => {
  assert.deepEqual(validateDeploymentPlan(plan), []);
});

test("PHASE0 — 21 commandes modulaires + 2 adapters statiques", () => {
  const moduleCommands = silence(() => {
    const { getDiscordModuleCommands } = require(path.join(ROOT, "src", "runtime", "registerModuleCommands"));
    return getDiscordModuleCommands().map((command) => command.data.name);
  });
  assert.equal(moduleCommands.length, 21, `attendu 21 commandes modulaires, obtenu ${moduleCommands.length}`);
  // Les deux adapters legacy de src/commands/ complètent le catalogue.
  for (const legacy of ["captcha", "ticketpanel"]) {
    assert.ok(loaded.has(legacy), `l'adapter legacy /${legacy} est absent du catalogue`);
    assert.ok(!moduleCommands.includes(legacy), `/${legacy} ne doit pas être exposé deux fois`);
  }
});

test("PHASE0 — chaque commande est exécutable et conforme aux contraintes Discord", () => {
  for (const [name, command] of loaded) {
    assert.ok(command, `/${name}: entrée vide`);
    assert.ok(command.data && typeof command.data.toJSON === "function", `/${name}: data SlashCommandBuilder absent`);
    assert.equal(typeof command.execute, "function", `/${name}: execute() absent`);
    assert.match(name, COMMAND_NAME_PATTERN, `/${name}: nom hors contraintes Discord`);
  }
});

test("PHASE0 — chaque payload porte un nom et une description valides", () => {
  for (const command of [...plan.global, ...plan.technical]) {
    assert.match(command.name, COMMAND_NAME_PATTERN, `/${command.name}: nom invalide dans le payload`);
    assert.equal(typeof command.description, "string", `/${command.name}: description absente`);
    assert.ok(command.description.length > 0, `/${command.name}: description vide`);
    assert.ok(command.description.length <= 100, `/${command.name}: description > 100 caractères`);
  }
});

test("PHASE0 — aucun doublon de nom dans le catalogue chargé", () => {
  const names = [...loaded.keys()];
  assert.equal(new Set(names).size, names.length, "des noms de commande sont dupliqués");
});
