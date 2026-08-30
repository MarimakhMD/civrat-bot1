"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BackendUnavailableError,
  ErrorCode,
  ErrorResponder,
} = require("../../src/core/errors");
const { dictionaries, I18nService } = require("../../src/core/i18n");
const {
  InteractionContextFactory,
  InteractionKind,
  InteractionRegistry,
  InteractionRouter,
  exact,
  prefix,
} = require("../../src/core/interactions");
const { PermissionService } = require("../../src/core/permissions");

function createContextFactory(options = {}) {
  return new InteractionContextFactory({
    configResolver: options.configResolver || null,
    i18n: new I18nService({ dictionaries }),
    permissions: new PermissionService(),
    errorResponder: new ErrorResponder(options.errorResponderOptions),
  });
}

function createRouter(options = {}) {
  const registry = new InteractionRegistry();
  const contextFactory = options.contextFactory || createContextFactory(options);
  return { registry, contextFactory, router: new InteractionRouter({ registry, contextFactory }) };
}

test("interaction registry routes every supported normalized interaction kind", async () => {
  const { registry, router } = createRouter();
  registry.registerCommand({ name: "config", execute: () => "command" });
  registry.registerAutocomplete({ name: "config", execute: () => "autocomplete" });
  registry.registerButton({ matcher: exact("civrat:v1:welcome:preview"), execute: () => "button" });
  registry.registerSelectMenu({ matcher: prefix("civrat:v1:tickets:"), execute: () => "select" });
  registry.registerModal({ matcher: prefix("civrat:v1:settings:"), execute: () => "modal" });

  assert.equal(await router.handle({ kind: InteractionKind.COMMAND, name: "config", locale: "en" }), "command");
  assert.equal(await router.handle({ kind: InteractionKind.AUTOCOMPLETE, name: "config", locale: "en" }), "autocomplete");
  assert.equal(await router.handle({ kind: InteractionKind.BUTTON, customId: "civrat:v1:welcome:preview", locale: "en" }), "button");
  assert.equal(await router.handle({ kind: InteractionKind.SELECT_MENU, customId: "civrat:v1:tickets:create", locale: "en" }), "select");
  assert.equal(await router.handle({ kind: InteractionKind.MODAL, customId: "civrat:v1:settings:language", locale: "en" }), "modal");
});

test("interaction context exposes identifiers and the observable configuration state", async () => {
  const configResolver = {
    getState: async () => ({
      config: { language: "fr", tickets_enabled: true },
      available: false,
      found: true,
      source: "stale-cache",
      reason: "BACKEND_UNAVAILABLE",
    }),
  };
  const { registry, router } = createRouter({ configResolver });
  let captured = null;
  registry.registerCommand({ name: "admin", execute: (context) => { captured = context; } });

  await router.handle({
    kind: InteractionKind.COMMAND,
    name: "admin",
    guildId: "1320817768962064384",
    channelId: "1542957356382552154",
    locale: "fr",
  });

  assert.equal(captured.guildId, "1320817768962064384");
  assert.equal(captured.channelId, "1542957356382552154");
  assert.equal(captured.config.tickets_enabled, true);
  assert.deepEqual(captured.configuration, {
    config: { language: "fr", tickets_enabled: true },
    available: false,
    found: true,
    source: "stale-cache",
    reason: "BACKEND_UNAVAILABLE",
  });
});

test("registry preserves autocomplete and matcher safety while validating acknowledgement policies", () => {
  const registry = new InteractionRegistry();
  const command = registry.registerCommand({ name: "config", execute: () => {} });
  const autocomplete = registry.registerAutocomplete({ name: "config", execute: () => {} });
  const button = registry.registerButton({
    matcher: prefix("civrat:v1:tickets:"),
    acknowledgement: "deferUpdate",
    execute: () => {},
  });

  assert.equal(command.acknowledgement, "deferReply");
  assert.equal(autocomplete.acknowledgement, "none");
  assert.equal(button.acknowledgement, "deferUpdate");
  assert.throws(() => registry.registerCommand({ name: "config", execute: () => {} }), /Duplicate/);
  assert.throws(
    () => registry.registerButton({ matcher: prefix("civrat:v1:tickets:create"), execute: () => {} }),
    /Ambiguous/
  );
  assert.throws(
    () => registry.registerModal({ customId: "modal", acknowledgement: "later", execute: () => {} }),
    /Unsupported interaction acknowledgement mode/
  );
});

test("router acknowledges a command before configuration resolution and never resolves twice on failure", async () => {
  const sequence = [];
  let reads = 0;
  const configResolver = {
    async getState() {
      reads += 1;
      sequence.push("configuration");
      throw new BackendUnavailableError({ operation: "read", resource: "guild_config" });
    },
  };
  const contextFactory = createContextFactory({ configResolver });
  const { registry, router } = createRouter({ contextFactory });
  registry.registerCommand({ name: "settings", execute: () => { sequence.push("handler"); } });
  let acknowledged = false;
  const errors = [];
  const transport = {
    supports: () => true,
    deferReply: async () => { sequence.push("deferReply"); acknowledged = true; },
    isAcknowledged: () => acknowledged,
    replyError: async (error) => { sequence.push("replyError"); errors.push(error); },
  };

  const result = await router.handle({
    kind: InteractionKind.COMMAND,
    name: "settings",
    guildId: "1320817768962064384",
    userId: "222222222222222222",
    locale: "en",
    transport,
  });

  assert.equal(reads, 1);
  assert.deepEqual(sequence, ["deferReply", "configuration", "replyError"]);
  assert.equal(result.code, ErrorCode.BACKEND_UNAVAILABLE);
  assert.equal(result.delivered, true);
  assert.equal(errors.length, 1);
});

test("router reports a Discord handler that completes without acknowledgement", async () => {
  const { registry, router } = createRouter();
  registry.registerButton({ customId: "no-response", execute: () => "done" });
  const replies = [];
  const transport = {
    isAcknowledged: () => false,
    replyError: async (payload) => replies.push(payload),
  };

  const result = await router.handle({
    kind: InteractionKind.BUTTON,
    customId: "no-response",
    locale: "en",
    transport,
  });

  assert.equal(result.code, ErrorCode.CONFIGURATION_UNAVAILABLE);
  assert.equal(result.delivered, true);
  assert.equal(replies.length, 1);
});

test("router renders unknown routes through the error context without normal configuration I/O", async () => {
  let normalContextCalls = 0;
  const contextFactory = createContextFactory({
    configResolver: {
      getState: async () => { normalContextCalls += 1; return {}; },
    },
  });
  const { router } = createRouter({ contextFactory });
  const replies = [];
  const result = await router.handle({
    kind: InteractionKind.BUTTON,
    customId: "missing",
    locale: "fr",
    transport: { replyError: async (payload) => replies.push(payload) },
  });

  assert.equal(result.code, ErrorCode.ROUTE_NOT_FOUND);
  assert.equal(replies[0].message, "Cette action n’est plus disponible.");
  assert.equal(normalContextCalls, 0);
});
