"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  InteractionContextFactory,
  InteractionKind,
  InteractionRegistry,
  InteractionRouter,
} = require("../../../src/core/interactions");
const { ErrorCode, ErrorResponder } = require("../../../src/core/errors");
const { I18nService, dictionaries } = require("../../../src/core/i18n");
const { PermissionService } = require("../../../src/core/permissions");
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

function fake({
  command = false,
  button = false,
  userSelect = false,
  mentionableSelect = false,
  name = "settings",
  customId = "x",
  lifecycle = null,
} = {}) {
  return {
    replied: false,
    deferred: false,
    isChatInputCommand: () => command,
    isAutocomplete: () => false,
    isButton: () => button,
    isAnySelectMenu: () => userSelect || mentionableSelect,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isUserSelectMenu: () => userSelect,
    isMentionableSelectMenu: () => mentionableSelect,
    isModalSubmit: () => false,
    commandName: name,
    customId,
    values: userSelect || mentionableSelect ? ["selected-user"] : [],
    guildId: "1320817768962064384",
    channelId: "1542957356382552154",
    locale: "en",
    user: { id: "222222222222222222" },
    guild: { ownerId: "333333333333333333" },
    member: {
      id: "222222222222222222",
      permissions: { has: () => true },
      roles: { cache: { has: (roleId) => roleId === ROLE_ID } },
    },
    reply: async (payload) => lifecycle?.push(["reply", payload]),
    followUp: async (payload) => lifecycle?.push(["followUp", payload]),
    update: async (payload) => lifecycle?.push(["update", payload]),
    editReply: lifecycle ? async (payload) => lifecycle.push(["editReply", payload]) : undefined,
    deferReply: lifecycle ? async (payload) => lifecycle.push(["deferReply", payload]) : undefined,
  };
}

test("Discord adapter returns false for legacy interactions and handles registered routes", async () => {
  const { registry, adapter } = createAdapter();
  assert.equal(await adapter.tryHandle(fake({ command: true, name: "legacy" })), false);
  registry.registerCommand({
    name: "settings",
    execute: async (context) => context.envelope.transport.reply({
      view: { content: "ok", components: [] },
      ephemeral: true,
    }),
  });
  assert.equal(await adapter.tryHandle(fake({ command: true })), true);
});

test("Discord adapter normalizes technical identifiers, locale, and role capability", () => {
  const { adapter } = createAdapter();
  const envelope = adapter.normalize(fake({ command: true, name: "admin" }));
  assert.equal(envelope.guildId, "1320817768962064384");
  assert.equal(envelope.channelId, "1542957356382552154");
  assert.equal(envelope.locale, "en");
  assert.equal(envelope.member.hasRole(ROLE_ID), true);
  assert.equal(envelope.member.hasRole("999999999999999999"), false);
});

test("Discord adapter supplies the Discord-specific error mapper", () => {
  const { adapter } = createAdapter();
  const envelope = adapter.normalize(fake({ command: true }));
  const mapped = envelope.mapError(Object.assign(new Error("private detail"), { code: 10008, status: 404 }));
  assert.equal(mapped.code, ErrorCode.DISCORD_RESOURCE_NOT_FOUND);
  assert.equal(mapped.metadata.discordCode, 10008);
});

test("Discord adapter recognizes user and mentionable select menus", () => {
  const { adapter } = createAdapter();
  for (const interaction of [
    fake({ userSelect: true, customId: "user-select" }),
    fake({ mentionableSelect: true, customId: "mentionable-select" }),
  ]) {
    const envelope = adapter.normalize(interaction);
    assert.equal(envelope.kind, InteractionKind.SELECT_MENU);
    assert.deepEqual(envelope.values, ["selected-user"]);
  }
});

test("registered Discord commands defer before execution and complete the original response", async () => {
  const calls = [];
  const { registry, adapter } = createAdapter();
  registry.registerCommand({
    name: "settings",
    execute: async (context) => context.envelope.transport.reply({
      view: { content: "ready", components: [] },
      ephemeral: true,
    }),
  });

  assert.equal(await adapter.tryHandle(fake({ command: true, lifecycle: calls })), true);
  assert.deepEqual(calls.map(([method]) => method), ["deferReply", "editReply"]);
  assert.equal(calls[1][1].content, "ready");
  assert.equal(Object.hasOwn(calls[1][1], "ephemeral"), false);
});
