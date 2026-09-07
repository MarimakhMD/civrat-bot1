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
  // 4E/E2 — `service.get` est désormais appelé AVANT la décision d'entitlement
  // (le toggle `welcome_image_enabled` y est lu) : il ne peut plus servir de
  // proxy à « l'image a été produite ». L'intention du test est préservée en
  // comptant les VRAIES générations d'image via un pipeline instrumenté.
  let imageGenerations = 0;
  registerWelcomeGoodbye({
    registry,
    // 4E/E2 — le toggle est activé pour que ce soit l'ENTITLEMENT qui refuse,
    // pas le toggle : c'est le refus Premium que ces tests vérifient.
    service: { get: async () => ({ welcome_image_enabled: true }) },
    settingsHome: async () => {},
    imagePipeline: { generate: async () => { imageGenerations += 1; return { buffer: Buffer.from("png") }; } },
    templateRegistry: { get: () => ({ design: {} }) },
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
  return { reply, imageGenerations };
}

test("Welcome image Premium denial is professional in FR and EN", async () => {
  for (const locale of ["fr", "en"]) {
    const { reply, imageGenerations } = await denial({
      decision: EntitlementDecision.PREMIUM_REQUIRED,
      locale,
    });
    assert.equal(reply.ephemeral, true);
    assert.match(reply.view.content, /https:\/\/discord\.gg\/BA3aDFqtXr/);
    assert.match(reply.view.content.toLowerCase(), /ticket/);
    assert.equal(imageGenerations, 0, "aucune image générée quand le Premium est requis");
  }
});

test("Welcome image distinguishes unavailable backend and fails closed without a dependency", async () => {
  const unavailable = await denial({ decision: EntitlementDecision.UNAVAILABLE, locale: "en" });
  assert.equal(unavailable.reply.view.content, dictionaries.en.errors.entitlementUnavailable);
  assert.equal(unavailable.imageGenerations, 0, "backend injoignable : aucune image");

  const missing = await denial({ locale: "en", dependencyPresent: false });
  assert.equal(missing.reply.view.content, dictionaries.en.errors.entitlementUnavailable);
  assert.equal(missing.imageGenerations, 0, "dépendance absente : aucune image");
});
