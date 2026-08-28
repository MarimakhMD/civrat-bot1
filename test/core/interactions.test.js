"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ErrorResponder } = require("../../src/core/errors");
const { dictionaries, I18nService } = require("../../src/core/i18n");
const { InteractionContextFactory, InteractionKind, InteractionRegistry, InteractionRouter, exact, prefix } = require("../../src/core/interactions");
const { PermissionService } = require("../../src/core/permissions");
const { createFakeErrorTransport } = require("../../src/core/testing/fakeInteraction");

function createRouter() {
  const i18n = new I18nService({ dictionaries });
  const responder = new ErrorResponder();
  const contextFactory = new InteractionContextFactory({ i18n, permissions: new PermissionService(), errorResponder: responder });
  const registry = new InteractionRegistry();
  return { registry, router: new InteractionRouter({ registry, contextFactory }) };
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

test("interaction context exposes normalized guild and channel identifiers", async () => {
  const { registry, router } = createRouter();
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
});

test("registry rejects duplicate and ambiguous route definitions", () => {
  const registry = new InteractionRegistry();
  registry.registerCommand({ name: "config", execute: () => {} });
  assert.throws(() => registry.registerCommand({ name: "config", execute: () => {} }), /Duplicate/);
  registry.registerButton({ matcher: prefix("civrat:v1:tickets:"), execute: () => {} });
  assert.throws(() => registry.registerButton({ matcher: prefix("civrat:v1:tickets:create"), execute: () => {} }), /Ambiguous/);
});

test("router renders unknown routes through the injected error transport", async () => {
  const { router } = createRouter();
  const transport = createFakeErrorTransport();
  const result = await router.handle({ kind: InteractionKind.BUTTON, customId: "missing", locale: "fr", transport });
  assert.equal(result.code, "ROUTE_NOT_FOUND");
  assert.equal(transport.replies[0].message, "Cette action n’est plus disponible.");
});
