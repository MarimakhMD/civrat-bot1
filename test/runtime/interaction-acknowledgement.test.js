"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BackendUnavailableError,
  ErrorCode,
  ErrorResponder,
} = require("../../src/core/errors");
const { I18nService, dictionaries } = require("../../src/core/i18n");
const {
  InteractionContextFactory,
  InteractionRegistry,
  InteractionRouter,
} = require("../../src/core/interactions");
const { PermissionService } = require("../../src/core/permissions");
const { DiscordInteractionAdapter } = require("../../src/adapters/discord/DiscordInteractionAdapter");

function createRuntime({ configResolver, logger = null, execute }) {
  const registry = new InteractionRegistry();
  registry.registerCommand({ name: "settings", execute });
  const contextFactory = new InteractionContextFactory({
    configResolver,
    i18n: new I18nService({ dictionaries }),
    permissions: new PermissionService(),
    errorResponder: new ErrorResponder({ logger }),
  });
  const router = new InteractionRouter({ registry, contextFactory });
  return new DiscordInteractionAdapter({ registry, router });
}

function interaction(calls, overrides = {}) {
  return {
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isButton: () => false,
    isAnySelectMenu: () => false,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isMentionableSelectMenu: () => false,
    isModalSubmit: () => false,
    commandName: "settings",
    guildId: "1320817768962064384",
    channelId: "1542957356382552154",
    locale: "en",
    user: { id: "222222222222222222" },
    guild: { ownerId: "333333333333333333" },
    member: { id: "222222222222222222", permissions: { has: () => true } },
    deferReply: async (payload) => calls.push(["deferReply", payload]),
    reply: async (payload) => calls.push(["reply", payload]),
    editReply: async (payload) => calls.push(["editReply", payload]),
    followUp: async (payload) => calls.push(["followUp", payload]),
    ...overrides,
  };
}

test("command acknowledgement happens before a pending configuration read", async () => {
  const calls = [];
  let releaseRead;
  let markReadStarted;
  const readStarted = new Promise((resolve) => { markReadStarted = resolve; });
  const gate = new Promise((resolve) => { releaseRead = resolve; });
  const configResolver = {
    async getState() {
      calls.push(["configuration"]);
      markReadStarted();
      await gate;
      return { config: {}, available: true, found: false, source: "database", reason: null };
    },
  };
  const runtime = createRuntime({
    configResolver,
    execute: (context) => context.envelope.transport.reply({
      view: { content: "ready", components: [] },
      ephemeral: true,
    }),
  });

  const pending = runtime.tryHandle(interaction(calls));
  await readStarted;
  assert.deepEqual(calls.map(([method]) => method), ["deferReply", "configuration"]);
  releaseRead();
  assert.equal(await pending, true);
  assert.deepEqual(calls.map(([method]) => method), ["deferReply", "configuration", "editReply"]);
});

test("backend failure after defer edits the original response exactly once", async () => {
  const calls = [];
  let handlerCalls = 0;
  const logs = [];
  const runtime = createRuntime({
    configResolver: {
      getState: async () => {
        throw new BackendUnavailableError({ operation: "read", resource: "guild_config" });
      },
    },
    logger: { warn: (message, payload) => logs.push({ message, payload }) },
    execute: () => { handlerCalls += 1; },
  });

  assert.equal(await runtime.tryHandle(interaction(calls)), true);
  assert.equal(handlerCalls, 0);
  assert.deepEqual(calls.map(([method]) => method), ["deferReply", "editReply"]);
  assert.match(calls[1][1].content, /No change was saved/);
  assert.equal(logs[0].payload.code, ErrorCode.BACKEND_UNAVAILABLE);
});

test("automatic and handler-level deferReply share one acknowledgement", async () => {
  const calls = [];
  const runtime = createRuntime({
    configResolver: {
      getState: async () => ({ config: {}, available: true, found: false, source: "database", reason: null }),
    },
    execute: async (context) => {
      await context.envelope.transport.deferReply({ ephemeral: true });
      return context.envelope.transport.reply({ view: { content: "done", components: [] }, ephemeral: true });
    },
  });

  assert.equal(await runtime.tryHandle(interaction(calls)), true);
  assert.deepEqual(calls.map(([method]) => method), ["deferReply", "editReply"]);
});

test("expired acknowledgement stops before backend and does not retry a response", async () => {
  const calls = [];
  let reads = 0;
  let handlerCalls = 0;
  const logs = [];
  const expired = Object.assign(new Error("private Discord detail"), { code: 10062, status: 404 });
  const runtime = createRuntime({
    configResolver: {
      getState: async () => {
        reads += 1;
        return { config: {}, available: true, found: false, source: "database", reason: null };
      },
    },
    logger: { warn: (message, payload) => logs.push({ message, payload }) },
    execute: () => { handlerCalls += 1; },
  });
  const raw = interaction(calls, {
    deferReply: async () => {
      calls.push(["deferReply"]);
      throw expired;
    },
  });

  assert.equal(await runtime.tryHandle(raw), true);
  assert.equal(reads, 0);
  assert.equal(handlerCalls, 0);
  assert.deepEqual(calls.map(([method]) => method), ["deferReply"]);
  assert.equal(logs[0].payload.code, ErrorCode.INTERACTION_EXPIRED);
  assert.equal(JSON.stringify(logs).includes("private Discord detail"), false);
});
