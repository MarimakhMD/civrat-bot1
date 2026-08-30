"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EntitlementUnavailableError,
  ErrorCode,
  ErrorResponder,
  PremiumRequiredError,
} = require("../../src/core/errors");
const { GuildConfigResolver } = require("../../src/core/guild-config/GuildConfigResolver");
const { InteractionContextFactory } = require("../../src/core/interactions/InteractionContext");
const { InteractionRegistry } = require("../../src/core/interactions/InteractionRegistry");
const { InteractionRouter } = require("../../src/core/interactions/InteractionRouter");
const { InteractionKind } = require("../../src/core/interactions/interactionKinds");
const { I18nService, dictionaries } = require("../../src/core/i18n");
const { PermissionService } = require("../../src/core/permissions");
const {
  SupabaseErrorCategory,
  classifySupabaseError,
  toPersistenceError,
} = require("../../src/adapters/supabase/supabaseErrorClassifier");
const { mergeConfigDefaults } = require("../../src/utils/mergeConfigDefaults");

function runtimeWithState(state) {
  let reads = 0;
  let handlerCalls = 0;
  let capturedContext = null;
  const repository = {
    async getByGuildId() {
      return state.config;
    },
    async getStateByGuildId() {
      reads += 1;
      return state;
    },
    async updateByGuildId() { throw new Error("not used"); },
    async invalidate() {},
  };
  const resolver = new GuildConfigResolver({ repository });
  const registry = new InteractionRegistry();
  registry.registerCommand({
    name: "settings",
    execute: (context) => {
      handlerCalls += 1;
      capturedContext = context;
      return context.envelope.transport.reply({ view: { content: "settings", components: [] }, ephemeral: true });
    },
  });
  const contextFactory = new InteractionContextFactory({
    configResolver: resolver,
    i18n: new I18nService({ dictionaries }),
    permissions: new PermissionService(),
    errorResponder: new ErrorResponder(),
  });
  return {
    router: new InteractionRouter({ registry, contextFactory }),
    observations: () => ({ reads, handlerCalls, capturedContext }),
  };
}

function envelope(replies) {
  return {
    kind: InteractionKind.COMMAND,
    name: "settings",
    guildId: "1320817768962064384",
    userId: "222222222222222222",
    locale: "en",
    transport: {
      supports: () => false,
      reply: async (payload) => replies.push({ kind: "reply", payload }),
      replyError: async (payload) => replies.push({ kind: "error", payload }),
    },
  };
}

test("backend unavailable without persisted data fails closed and never reaches the handler", async () => {
  const replies = [];
  const runtime = runtimeWithState({
    config: {},
    available: false,
    found: false,
    source: "unavailable",
    reason: ErrorCode.BACKEND_UNAVAILABLE,
  });

  const result = await runtime.router.handle(envelope(replies));
  const observations = runtime.observations();
  assert.equal(observations.reads, 1);
  assert.equal(observations.handlerCalls, 0);
  assert.equal(result.code, ErrorCode.BACKEND_UNAVAILABLE);
  assert.notEqual(result.code, ErrorCode.PREMIUM_REQUIRED);
  assert.match(replies[0].payload.message, /No change was saved/);
});

test("known stale configuration remains usable but keeps available false", async () => {
  const replies = [];
  const runtime = runtimeWithState({
    config: { tickets_enabled: false, xp_per_message: 0 },
    available: false,
    found: true,
    source: "stale-cache",
    reason: ErrorCode.BACKEND_UNAVAILABLE,
  });

  await runtime.router.handle(envelope(replies));
  const observations = runtime.observations();
  assert.equal(observations.handlerCalls, 1);
  assert.equal(observations.capturedContext.config.tickets_enabled, false);
  assert.equal(observations.capturedContext.config.xp_per_message, 0);
  assert.equal(observations.capturedContext.configuration.available, false);
  assert.equal(replies[0].kind, "reply");
});

test("Supabase errors distinguish backend, schema, permission, conflict and missing row", () => {
  const cases = [
    [{ code: "ECONNRESET" }, SupabaseErrorCategory.BACKEND_UNAVAILABLE, ErrorCode.BACKEND_UNAVAILABLE],
    [{ code: "42703" }, SupabaseErrorCategory.SCHEMA_MISMATCH, ErrorCode.PERSISTENCE_SCHEMA_MISMATCH],
    [{ code: "42501", status: 403 }, SupabaseErrorCategory.PERMISSION_DENIED, ErrorCode.PERSISTENCE_PERMISSION_DENIED],
    [{ code: "23505", status: 409 }, SupabaseErrorCategory.CONFLICT, ErrorCode.PERSISTENCE_CONFLICT],
    [{ code: "PGRST116" }, SupabaseErrorCategory.NOT_FOUND, ErrorCode.PERSISTENCE_FAILED],
  ];

  for (const [backendError, category, civratCode] of cases) {
    assert.equal(classifySupabaseError(backendError).category, category);
    assert.equal(toPersistenceError(backendError).code, civratCode);
  }
});

test("Supabase classification and mapped metadata never copy backend text", () => {
  const privateDetail = "private backend credential must never be copied";
  const backendError = Object.assign(new Error(privateDetail), {
    code: "42P01",
    details: privateDetail,
    hint: privateDetail,
  });
  const classification = classifySupabaseError(backendError);
  const mapped = toPersistenceError(backendError, { operation: "write", resource: "guild_config" });
  assert.equal(JSON.stringify(classification).includes(privateDetail), false);
  assert.equal(JSON.stringify(mapped.metadata).includes(privateDetail), false);
  assert.equal(mapped.code, ErrorCode.PERSISTENCE_SCHEMA_MISMATCH);
});

test("mergeConfigDefaults preserves persisted false, zero, empty string and null", () => {
  const defaults = {
    enabled: true,
    rate: 10,
    label: "default",
    channelId: "default-channel",
    nested: { enabled: true, threshold: 5 },
    rewards: [{ level: 1 }],
  };
  const persisted = {
    enabled: false,
    rate: 0,
    label: "",
    channelId: null,
    nested: { enabled: false, threshold: undefined },
    rewards: [],
    extra: "kept",
    undefinedOnly: undefined,
  };

  const merged = mergeConfigDefaults(defaults, persisted);
  assert.deepEqual(merged, {
    enabled: false,
    rate: 0,
    label: "",
    channelId: null,
    nested: { enabled: false, threshold: 5 },
    rewards: [],
    extra: "kept",
  });
  assert.notEqual(merged.nested, defaults.nested);
  assert.notEqual(merged.rewards, persisted.rewards);
  assert.equal(defaults.nested.enabled, true);
});

test("backend and entitlement tri-state errors remain distinct from Premium required", () => {
  assert.equal(new EntitlementUnavailableError().code, ErrorCode.ENTITLEMENT_UNAVAILABLE);
  assert.equal(new PremiumRequiredError().code, ErrorCode.PREMIUM_REQUIRED);
  assert.notEqual(ErrorCode.BACKEND_UNAVAILABLE, ErrorCode.ENTITLEMENT_UNAVAILABLE);
  assert.notEqual(ErrorCode.ENTITLEMENT_UNAVAILABLE, ErrorCode.PREMIUM_REQUIRED);
});
