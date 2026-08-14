"use strict";

// V1 — exposition Discord des commandes (P1→P4).
// 22 commandes « normales » = Guild uniquement ; /ownerpanel et /recovery =
// Guild + BotDM (avec Administrator par défaut en serveur). Aucune commande
// supprimée : 24 commandes au total. Offline intégral : composition runtime
// simulée (mêmes fixtures que ownerpanel/recovery-command-runtime) + lecture
// des deux commandes legacy (/captcha, /ticketpanel).

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
  const modular = runtime.getDiscordCommands().map((c) => c.data.toJSON());
  // Commandes legacy chargées hors composition (captcha, ticketpanel).
  const legacy = [
    require("../../src/commands/captcha").data.toJSON(),
    require("../../src/commands/ticketpanel").data.toJSON(),
  ];
  return { modular, legacy, all: [...modular, ...legacy] };
}

test("the full command set is exactly 24 commands (no command removed)", () => {
  const { all } = allCommands();
  assert.equal(all.length, 24, "24 commands expected");
  assert.equal(new Set(all.map((c) => c.name)).size, 24, "no duplicate");
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

test("/ownerpanel and /recovery are guild + bot DM with Administrator default", () => {
  const { all } = allCommands();
  for (const name of ["ownerpanel", "recovery"]) {
    const command = all.find((c) => c.name === name);
    assert.ok(command, `/${name} must exist`);
    assert.deepEqual(command.contexts, [0, 1], `/${name} must be Guild + BotDM`);
    assert.deepEqual(command.integration_types, [0, 1], `/${name} must allow user install (DM)`);
    assert.equal(command.default_member_permissions, "8", `/${name} requires Administrator by default on servers`);
  }
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

test("the 22 modular commands are unique and unchanged in count", () => {
  const { modular } = allCommands();
  assert.equal(modular.length, 22, "22 modular commands expected");
  assert.equal(new Set(modular.map((c) => c.name)).size, 22, "no duplicate modular command");
});
