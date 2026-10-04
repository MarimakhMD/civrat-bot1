"use strict";

/**
 * PHASE 0 — non-régression de la composition runtime.
 *
 * La Phase 0 ne touche qu'à l'outillage de test. Ce fichier verrouille donc
 * l'état de la composition runtime AVANT/APRÈS : mêmes événements Discord,
 * mêmes routes d'interaction, mêmes exigences de permission.
 *
 * Les compteurs ci-dessous sont des INSTANTANÉS volontairement stricts. Une
 * phase fonctionnelle ultérieure qui ajoute une route DOIT les mettre à jour
 * explicitement : c'est le but — rendre visible tout changement de surface
 * d'interaction au lieu de le laisser passer inaperçu.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const { createGuildSettingsRuntime } = require(path.join(ROOT, "src", "runtime", "createGuildSettingsRuntime"));
const { InteractionKind } = require(path.join(ROOT, "src", "core", "interactions"));
const { PermissionName } = require(path.join(ROOT, "src", "core", "permissions"));

const KNOWN_PERMISSIONS = new Set(Object.values(PermissionName));

// ─────────────────────────────────────────────────────────────────────────────
// Instantanés de la composition (mesurés avant la Phase 0)
// ─────────────────────────────────────────────────────────────────────────────
const EXPECTED_EVENT_COUNT = 22;
// Image personnalisée (Premium) : 21 -> 22 avec la commande /welcomeimage.
const EXPECTED_MODULE_COMMAND_COUNT = 22;
// PHASE 2 (UI-2) — BUTTON passe de 131 à 132 : ajout du contrôle
// `civrat:v1:welcome-goodbye:toggle-welcome-image`, qui expose dans le menu
// Welcome le toggle `welcome_image_enabled` déjà géré par le backend. Aucun
// autre type de route n'est modifié (SELECT_MENU et MODAL inchangés).
const EXPECTED_ROUTE_COUNTS = Object.freeze({
  // Image personnalisée (Premium) : 132 -> 136, soit 4 contrôles de la
  // sous-vue « Image Welcome » (entrée, aide d'upload, suppression, retour).
  [InteractionKind.BUTTON]: 136,
  [InteractionKind.SELECT_MENU]: 21,
  [InteractionKind.MODAL]: 27,
});

/**
 * Routes volontairement ouvertes à tout membre du serveur. Toute entrée
 * supplémentaire ici est une régression de sécurité et doit faire échouer
 * ce test.
 */
const EXPECTED_PERMISSION_FREE_ROUTES = Object.freeze([
  "civrat:v1:captcha:verify",
  "civrat:v1:tickets:add-member",
  "civrat:v1:tickets:add-member:submit",
  "civrat:v1:tickets:claim",
  "civrat:v1:tickets:close",
  "civrat:v1:tickets:create",
  "civrat:v1:tickets:create:",
  "civrat:v1:tickets:delete",
  "civrat:v1:tickets:remove-member",
  "civrat:v1:tickets:remove-member:submit",
  "civrat:v1:tickets:rename",
  "civrat:v1:tickets:rename:submit",
  "civrat:v1:tickets:reopen",
  "giveaway_join:",
  "suggestion_down:",
  "suggestion_up:",
].sort());

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

const runtime = silence(() => createGuildSettingsRuntime({
  legacyConfigService: require(path.join(ROOT, "src", "services", "guildConfig")),
  logger: null,
}));

const eventFiles = fs
  .readdirSync(path.join(ROOT, "src", "events"))
  .filter((file) => file.endsWith(".js"))
  .sort();

const loadedEvents = eventFiles.map((file) => ({
  file,
  module: require(path.join(ROOT, "src", "events", file)),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Événements Discord
// ─────────────────────────────────────────────────────────────────────────────

test("PHASE0 — 22 fichiers d'événements Discord, aucun ajouté ni retiré", () => {
  assert.equal(eventFiles.length, EXPECTED_EVENT_COUNT, `attendu ${EXPECTED_EVENT_COUNT}, obtenu ${eventFiles.length}`);
});

test("PHASE0 — chaque événement expose un contrat name/execute valide", () => {
  for (const { file, module: event } of loadedEvents) {
    assert.equal(typeof event.name, "string", `${file}: name absent`);
    assert.ok(event.name.length > 0, `${file}: name vide`);
    assert.equal(typeof event.execute, "function", `${file}: execute() absent`);
  }
});

test("PHASE0 — aucun événement Discord n'est enregistré deux fois", () => {
  const names = loadedEvents.map(({ module: event }) => event.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual([...new Set(duplicates)], [], "événements dupliqués — un même événement se déclencherait plusieurs fois");
});

test("PHASE0 — `ready` reste un événement à exécution unique", () => {
  const ready = loadedEvents.find(({ module: event }) => event.name === "ready");
  assert.ok(ready, "l'événement ready est absent");
  assert.equal(ready.module.once, true, "ready doit être once:true — la réconciliation TempVoice ne doit pas tourner deux fois");
});

// ─────────────────────────────────────────────────────────────────────────────
// Composition runtime et routes d'interaction
// ─────────────────────────────────────────────────────────────────────────────

test("PHASE0 — la composition runtime aboutit sans lever", () => {
  assert.ok(runtime, "createGuildSettingsRuntime a renvoyé une valeur vide");
  assert.equal(typeof runtime.tryHandle, "function");
  assert.equal(typeof runtime.getDiscordCommands, "function");
  assert.ok(runtime.registry, "le registre d'interactions est absent");
});

test("PHASE0 — le registre expose 22 commandes modulaires", () => {
  assert.equal(runtime.registry.commandRoutes.size, EXPECTED_MODULE_COMMAND_COUNT);
  assert.equal(silence(() => runtime.getDiscordCommands()).length, EXPECTED_MODULE_COMMAND_COUNT);
});

test("PHASE0 — le nombre de routes d'interaction par type est inchangé", () => {
  for (const [kind, expected] of Object.entries(EXPECTED_ROUTE_COUNTS)) {
    const routes = runtime.registry.componentRoutes.get(kind) || [];
    assert.equal(
      routes.length,
      expected,
      `${kind}: attendu ${expected} routes, obtenu ${routes.length} — la surface d'interaction a changé`
    );
  }
});

test("PHASE0 — chaque route d'interaction est exécutable", () => {
  for (const [kind, routes] of runtime.registry.componentRoutes) {
    for (const route of routes) {
      assert.equal(typeof route.execute, "function", `${kind} ${route.matcher.value}: execute() absent`);
      assert.ok(route.matcher && typeof route.matcher.value === "string" && route.matcher.value.length > 0,
        `${kind}: matcher invalide`);
      assert.ok(["exact", "prefix"].includes(route.matcher.type), `${kind} ${route.matcher.value}: type de matcher inconnu`);
    }
  }
});

test("PHASE0 — aucune route d'interaction n'est ambiguë avec une autre du même type", () => {
  const { overlaps } = require(path.join(ROOT, "src", "core", "interactions", "routeMatchers"));
  for (const [kind, routes] of runtime.registry.componentRoutes) {
    for (let i = 0; i < routes.length; i += 1) {
      for (let j = i + 1; j < routes.length; j += 1) {
        assert.ok(
          !overlaps(routes[i].matcher, routes[j].matcher),
          `${kind}: ${routes[i].matcher.value} et ${routes[j].matcher.value} se chevauchent — le premier enregistré gagnerait silencieusement`
        );
      }
    }
  }
});

test("PHASE0 — chaque permission exigée appartient au vocabulaire connu", () => {
  for (const [kind, routes] of runtime.registry.componentRoutes) {
    for (const route of routes) {
      const required = route.permissions?.allOf;
      if (!Array.isArray(required)) continue;
      for (const permission of required) {
        assert.ok(
          KNOWN_PERMISSIONS.has(permission),
          `${kind} ${route.matcher.value}: permission inconnue « ${permission} »`
        );
      }
    }
  }
});

test("PHASE0 — l'ensemble des routes sans exigence de permission est inchangé", () => {
  const permissionFree = [];
  for (const routes of runtime.registry.componentRoutes.values()) {
    for (const route of routes) {
      const required = route.permissions?.allOf;
      if (!Array.isArray(required) || required.length === 0) permissionFree.push(route.matcher.value);
    }
  }
  assert.deepEqual(
    permissionFree.sort(),
    [...EXPECTED_PERMISSION_FREE_ROUTES],
    "la liste des routes ouvertes à tout membre a changé — à justifier explicitement"
  );
});
