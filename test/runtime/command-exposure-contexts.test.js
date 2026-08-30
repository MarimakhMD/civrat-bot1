"use strict";

// Exposition Discord finale : 22 commandes normales Guild-only et /admin
// Guild-only déployée uniquement dans la guilde technique. /ownerpanel et
// /recovery ne sont plus des commandes concurrentes. Offline intégral.

const test = require("node:test");
const assert = require("node:assert/strict");

// Les 22 commandes qui doivent rester strictement serveur.
const GUILD_ONLY_COMMANDS = [
  "settings", "captcha", "ticketpanel", "automod", "analytics",
  "analytics_xp", "analytics_invites", "invites", "suggest", "giveaway",
  "uploadsticker", "warn", "mute", "unmute", "bannir", "debannir",
  "expulser", "supprimer", "slowmode", "verrouiller", "deverrouiller", "pseudo",
];

const MODERATION_COMMANDS = [
  "warn", "mute", "unmute", "bannir", "debannir", "expulser",
  "supprimer", "slowmode", "verrouiller", "deverrouiller", "pseudo",
];

function makeRuntime() {
  const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");
  return createGuildSettingsRuntime({
    legacyConfigService: { getGuildConfig: async () => ({}), updateGuildConfig: async () => ({}), invalidateCache: async () => {} },
  });
}

function allCommands() {
  const runtime = makeRuntime();
  const modularDefinitions = runtime.getDiscordCommands();
  const modular = modularDefinitions.map((command) => command.data.toJSON());
  // Commandes legacy chargées hors composition (captcha, ticketpanel).
  const legacy = [
    require("../../src/commands/captcha").data.toJSON(),
    require("../../src/commands/ticketpanel").data.toJSON(),
  ];
  return { modularDefinitions, modular, legacy, all: [...modular, ...legacy] };
}

test("the full command set is exactly 22 normal commands plus /admin", () => {
  const { all } = allCommands();
  assert.equal(all.length, 23, "23 commands expected");
  assert.equal(new Set(all.map((command) => command.name)).size, 23, "no duplicate");
  assert.equal(all.some(({ name }) => name === "ownerpanel" || name === "recovery"), false);
});

test("the 22 normal commands are guild-only (contexts = [0])", () => {
  const { all } = allCommands();
  const byName = new Map(all.map((c) => [c.name, c]));
  for (const name of GUILD_ONLY_COMMANDS) {
    const command = byName.get(name);
    assert.ok(command, `${name} must still exist`);
    assert.deepEqual(command.contexts, [0], `/${name} must be Guild-only`);
    assert.ok(!(command.contexts || []).includes(1), `/${name} must not be available in DM`);
  }
});

test("/admin is Guild Install-only and carries the technical deployment scope", () => {
  const { all, modularDefinitions } = allCommands();
  const command = all.find(({ name }) => name === "admin");
  assert.ok(command, "/admin must exist");
  assert.deepEqual(command.contexts, [0]);
  assert.deepEqual(command.integration_types, [0]);
  assert.ok(!(command.contexts || []).includes(1), "/admin must not be available in DM");
  const definition = modularDefinitions.find(({ data }) => data.name === "admin");
  assert.equal(definition.deploymentScope, "civrat-admin-guild");
});

test("/settings is strictly guild-only", () => {
  const { all } = allCommands();
  const settings = all.find((c) => c.name === "settings");
  assert.ok(settings);
  assert.deepEqual(settings.contexts, [0]);
});

test("/captcha and /ticketpanel are explicitly guild-only", () => {
  const { all } = allCommands();
  for (const name of ["captcha", "ticketpanel"]) {
    const command = all.find((c) => c.name === name);
    assert.ok(command, `/${name} must exist`);
    assert.deepEqual(command.contexts, [0], `/${name} must be Guild-only`);
  }
});

test("/uploadsticker is guild-only and carries a required Attachment option", () => {
  const { all } = allCommands();
  const command = all.find((c) => c.name === "uploadsticker");
  assert.ok(command);
  assert.deepEqual(command.contexts, [0], "/uploadsticker must be Guild-only");
  const file = (command.options || []).find((o) => o.name === "file");
  assert.ok(file, "file option must be present");
  assert.equal(file.type, 11, "file must be a Discord Attachment");
  assert.equal(file.required, true, "file must be required");
});

test("all 11 moderation commands are still present", () => {
  const { all } = allCommands();
  const names = new Set(all.map((c) => c.name));
  for (const name of MODERATION_COMMANDS) {
    assert.ok(names.has(name), `/${name} must still be present`);
  }
});

test("the 21 modular commands are unique (plus two legacy commands)", () => {
  const { modular } = allCommands();
  assert.equal(modular.length, 21, "21 modular commands expected");
  assert.equal(new Set(modular.map((command) => command.name)).size, 21, "no duplicate modular command");
});
