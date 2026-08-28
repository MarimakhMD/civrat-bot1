"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  InteractionRegistry,
  InteractionRouter,
  InteractionContextFactory,
} = require("../../../src/core/interactions");
const { I18nService, dictionaries } = require("../../../src/core/i18n");
const { PermissionService } = require("../../../src/core/permissions");
const { ErrorResponder } = require("../../../src/core/errors");
const { DiscordInteractionAdapter } = require("../../../src/adapters/discord");

const ROLE_ID = "1542958959907053688";

function createAdapter() {
  const registry = new InteractionRegistry();
  const factory = new InteractionContextFactory({
    i18n: new I18nService({ dictionaries }),
    permissions: new PermissionService(),
    errorResponder: new ErrorResponder(),
  });
  return {
    registry,
    adapter: new DiscordInteractionAdapter({
      registry,
      router: new InteractionRouter({ registry, contextFactory: factory }),
    }),
  };
}

function fake({ command = false, button = false, name = "settings", customId = "x" } = {}) {
  return {
    isChatInputCommand: () => command,
    isAutocomplete: () => false,
    isButton: () => button,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    commandName: name,
    customId,
    guildId: "1320817768962064384",
    channelId: "1542957356382552154",
    locale: "en",
    user: { id: "user" },
    guild: { ownerId: "owner" },
    member: {
      id: "user",
      permissions: { has: () => true },
      roles: { cache: { has: (roleId) => roleId === ROLE_ID } },
    },
    reply: async () => {},
    followUp: async () => {},
    update: async () => {},
  };
}

test("Discord adapter returns false for legacy interactions and handles registered routes", async () => {
  const { registry, adapter } = createAdapter();
  assert.equal(await adapter.tryHandle(fake({ command: true, name: "legacy" })), false);
  registry.registerCommand({
    name: "settings",
    execute: async (context) => context.envelope.transport.reply({ view: { content: "ok", components: [] }, ephemeral: true }),
  });
  assert.equal(await adapter.tryHandle(fake({ command: true })), true);
});

test("Discord adapter normalizes the technical channel, locale, and role capability", () => {
  const { adapter } = createAdapter();
  const envelope = adapter.normalize(fake({ command: true, name: "admin" }));
  assert.equal(envelope.guildId, "1320817768962064384");
  assert.equal(envelope.channelId, "1542957356382552154");
  assert.equal(envelope.locale, "en");
  assert.equal(envelope.member.hasRole(ROLE_ID), true);
  assert.equal(envelope.member.hasRole("999999999999999999"), false);
});
