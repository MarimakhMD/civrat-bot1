"use strict";

// Phase 1 (C11) — Couverture des clés de configuration des journaux.
//
// Garde structurelle contre la réapparition du défaut corrigé : une colonne
// de guild_configs réellement LUE par un handler de logs mais absente de
// LogsCategoryChannelKey. Dans ce cas `service.resolveDestination()` renvoie
// toujours null, le log est jeté en silence et AUCUN écran de /settings ne
// permet d'activer la destination — la fonctionnalité est morte sans erreur.
//
// Sources de vérité utilisées (toutes réelles, aucune inventée) :
//   • LogsConfigKey            src/modules/logs/configuration/logsConstants.js
//   • LogsCategoryChannelKey   src/modules/logs/configuration/logsCategories.js
//   • les handlers             src/modules/logs/events/*.js (lus depuis le disque)
//   • les dictionnaires        src/modules/logs/translations/{fr,en}.json
//
// NB : le catalogue Settings (SETTINGS_CATALOG) n'expose pas ses clés de
// configuration de façon énumérable — elles sont capturées dans des closures
// enabledBy()/isConfigured(). Il est donc vérifié ici par lecture de source,
// comme le font déjà les tests de câblage du dépôt.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { LogsCategory, LogsCategoryChannelKey } = require("../../src/modules/logs/configuration/logsCategories");
const { LogsConfigKey } = require("../../src/modules/logs/configuration/logsConstants");

const EVENTS_DIR = path.join(__dirname, "../../src/modules/logs/events");
const fr = require("../../src/modules/logs/translations/fr.json");
const en = require("../../src/modules/logs/translations/en.json");

const CHANNEL_KEY_PATTERN = /\b(?:log_[a-z_]+_channel_id|invitations_log_channel_id)\b/g;

/** Toutes les colonnes de destination lues par le code réel des handlers. */
function readHandlerChannelKeys() {
  const keys = new Set();
  for (const file of fs.readdirSync(EVENTS_DIR).filter((name) => name.endsWith(".js")).sort()) {
    const source = fs.readFileSync(path.join(EVENTS_DIR, file), "utf8");
    for (const match of source.match(CHANNEL_KEY_PATTERN) || []) keys.add(match);
  }
  return keys;
}

const configuredKeys = () => new Set(Object.values(LogsCategoryChannelKey));

test("chaque colonne de logs déclarée est configurable depuis /settings", () => {
  const declared = Object.entries(LogsConfigKey)
    .filter(([, key]) => key !== "logs_enabled")
    .map(([, key]) => key);

  assert.equal(declared.length, 8, "LogsConfigKey déclare 8 colonnes de destination");
  for (const key of declared) {
    assert.ok(configuredKeys().has(key), `${key} est déclarée mais aucune catégorie ne la rend configurable`);
  }
});

test("chaque colonne lue par un handler de logs est configurable (garde C11)", () => {
  const read = readHandlerChannelKeys();
  assert.ok(read.size >= 8, `les handlers doivent lire au moins 8 colonnes (lu : ${read.size})`);
  for (const key of [...read].sort()) {
    assert.ok(configuredKeys().has(key),
      `${key} est lue par un handler mais n'a aucune LogsCategory : ses logs sont jetés sans moyen de les activer`);
  }
});

test("aucune catégorie de logs ne pointe vers une colonne inexistante", () => {
  const declared = new Set(Object.values(LogsConfigKey));
  for (const [category, key] of Object.entries(LogsCategoryChannelKey)) {
    assert.ok(declared.has(key), `la catégorie ${category} pointe vers ${key}, absente de LogsConfigKey`);
  }
});

test("chaque catégorie de logs possède son libellé en français et en anglais", () => {
  // logsView appelle t(`logs.${categorie}`) ; I18nService lève sur clé absente,
  // donc une catégorie sans libellé casse l'ouverture de /settings → Logs.
  for (const category of Object.values(LogsCategory)) {
    assert.equal(typeof fr.logs[category], "string", `logs.${category} manque dans fr.json`);
    assert.ok(fr.logs[category].length > 0, `logs.${category} est vide dans fr.json`);
    assert.equal(typeof en.logs[category], "string", `logs.${category} manque dans en.json`);
    assert.ok(en.logs[category].length > 0, `logs.${category} est vide dans en.json`);
  }
});

test("les deux destinations ajoutées en Phase 1 sont configurables et traduites", () => {
  for (const [category, key] of [
    [LogsCategory.MESSAGES_EDIT, "log_message_edit_channel_id"],
    [LogsCategory.MEMBERS_LEAVE, "log_member_leave_channel_id"],
  ]) {
    assert.equal(LogsCategoryChannelKey[category], key);
    assert.ok(Object.values(LogsConfigKey).includes(key), `${key} doit être une colonne déclarée`);
    assert.ok(readHandlerChannelKeys().has(key), `${key} doit bien être lue par un handler`);
    assert.ok(fr.logs[category] && en.logs[category], `${category} doit être traduit en fr et en`);
  }
});

test("le catalogue Settings référence des colonnes réellement configurables", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/modules/guild-settings/configuration/settingsCatalog.js"), "utf8");
  const logsBlock = source.slice(source.indexOf("id: SettingsCategoryId.LOGS"));
  const referenced = new Set(logsBlock.match(CHANNEL_KEY_PATTERN) || []);

  assert.ok(referenced.size >= 7, `la section Logs du catalogue doit référencer ses colonnes (${referenced.size})`);
  for (const key of referenced) {
    assert.ok(configuredKeys().has(key),
      `${key} est annoncée par /settings → Logs mais n'est configurable nulle part`);
  }
});
