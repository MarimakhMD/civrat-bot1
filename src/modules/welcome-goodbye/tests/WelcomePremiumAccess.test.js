"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EntitlementDecision } = require("../../../core/entitlements");
const { dictionaries, I18nService } = require("../../../core/i18n");
const { InteractionRegistry } = require("../../../core/interactions");
const { registerWelcomeGoodbye } = require("../register");
const { WelcomeGoodbyeComponentId: Id } = require("../configuration/welcomeGoodbyeConstants");

async function denial({ decision, locale, dependencyPresent = true }) {
  const registry = new InteractionRegistry();
  let imageReads = 0;
  registerWelcomeGoodbye({
    registry,
    service: { get: async () => { imageReads += 1; return {}; } },
    settingsHome: async () => {},
    entitlementService: dependencyPresent ? {
      requireFeature: async () => ({
        ok: decision !== EntitlementDecision.UNAVAILABLE,
        granted: false,
        code: decision,
      }),
    } : null,
  });
  const route = registry.find({ kind: "button", customId: Id.PREVIEW_WELCOME_IMAGE });
  let reply = null;
  const i18n = new I18nService({ dictionaries });
  await route.execute({
    guildId: "guild",
    userId: "user",
    t: i18n.forLocale(locale),
    envelope: { transport: { reply: async (payload) => { reply = payload; } } },
  });
  return { reply, imageReads };
}

test("Welcome image Premium denial is professional in FR and EN", async () => {
  for (const locale of ["fr", "en"]) {
    const { reply, imageReads } = await denial({
      decision: EntitlementDecision.PREMIUM_REQUIRED,
      locale,
    });
    assert.equal(reply.ephemeral, true);
    assert.match(reply.view.content, /https:\/\/discord\.gg\/BA3aDFqtXr/);
    assert.match(reply.view.content.toLowerCase(), /ticket/);
    assert.equal(imageReads, 0);
  }
});

test("Welcome image distinguishes unavailable backend and fails closed without a dependency", async () => {
  const unavailable = await denial({ decision: EntitlementDecision.UNAVAILABLE, locale: "en" });
  assert.equal(unavailable.reply.view.content, dictionaries.en.errors.entitlementUnavailable);
  assert.equal(unavailable.imageReads, 0);

  const missing = await denial({ locale: "en", dependencyPresent: false });
  assert.equal(missing.reply.view.content, dictionaries.en.errors.entitlementUnavailable);
  assert.equal(missing.imageReads, 0);
});
