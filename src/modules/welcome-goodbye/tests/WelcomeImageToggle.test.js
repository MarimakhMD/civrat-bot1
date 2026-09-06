"use strict";

// ───────────────────────────────────────────────────────────────
// 4E/E2 — `welcome_image_enabled` : toggle ET entitlement.
//
// La règle validée : l'image Welcome n'est autorisée que si
//   1. `welcome_image_enabled === true`  (toggle admin)
//   ET
//   2. l'entitlement `WELCOME_IMAGE` est présent et valide.
// Aucune des deux conditions ne suffit seule.
//
// La matrice est testée sur les DEUX chemins qui peuvent produire une image :
//   • la LIVRAISON à chaque arrivée de membre (WelcomeDeliveryService) ;
//   • l'APERÇU demandé par un admin (register.js).
// Les tester séparément est indispensable : deux gardes écrites à deux
// endroits finissent toujours par diverger.
//
// Aucun de ces tests ne parle à une vraie base ni à Discord : pipeline,
// transport et entitlement sont des doubles. Ce qui est prouvé, c'est la
// décision prise par le code.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const { WelcomeDeliveryService } = require("../services/WelcomeDeliveryService");
const { WelcomeTemplateRenderer, defaultPlaceholderProviders } = require("../services/WelcomeTemplateRenderer");
const { WelcomeTemplateRegistry } = require("../rendering/WelcomeTemplateRegistry");
const { registerWelcomeGoodbye } = require("../register");
const {
  WelcomeGoodbyeComponentId: Id,
  WelcomeGoodbyeLogType: LogType,
  WelcomeCardSkipReason: SkipReason,
} = require("../configuration/welcomeGoodbyeConstants");
const { WelcomeGoodbyeConfigSchema } = require("../configuration/welcomeGoodbyeConfigSchema");
const { WelcomeGoodbyeDefaults } = require("../configuration/welcomeGoodbyeDefaults");
const { validateWelcomeGoodbyeUpdates } = require("../configuration/welcomeGoodbyeValidation");
const { isGuildConfigKey } = require("../../../services/guildConfigKeys");
const { InteractionRegistry } = require("../../../core/interactions");
const { EntitlementDecision, EntitlementFeature } = require("../../../core/entitlements");
const { dictionaries: coreDictionaries, I18nService } = require("../../../core/i18n");
const welcomeFr = require("../translations/fr.json");
const welcomeEn = require("../translations/en.json");

// core/i18n n'expose que `errors` ; les clés `welcomeGoodbye.*` vivent dans le
// JSON du module et sont fusionnées par createGuildSettingsRuntime:99. On
// reproduit exactement cette fusion pour parler le même dictionnaire que la prod.
const dictionaries = {
  fr: { ...coreDictionaries.fr, ...welcomeFr },
  en: { ...coreDictionaries.en, ...welcomeEn },
};

const member = {
  guildId: "guild", userId: "user-1", user: "@nina", mention: "@nina",
  username: "nina", displayName: "Nina", server: "CIVRAT", memberCount: 42,
  joinDate: "11/08/2026",
};

/** Service de livraison instrumenté : compte les images réellement produites. */
function createDelivery({ toggle, granted = true, entitlementPresent = true }) {
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  let imagesGenerated = 0;
  let entitlementCalls = 0;
  const logs = [];
  const delivery = new WelcomeDeliveryService({
    renderer: new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() }),
    imagePipeline: { generate: async () => { imagesGenerated += 1; return { buffer: Buffer.from("png") }; } },
    templateRegistry: { get: () => registry.get("template-1") },
    entitlementService: entitlementPresent ? {
      requireFeature: async () => {
        entitlementCalls += 1;
        return { ok: true, granted, code: granted ? EntitlementDecision.GRANTED : EntitlementDecision.PREMIUM_REQUIRED };
      },
    } : null,
    logService: { delivery: (e) => logs.push(e), failure: (e) => logs.push(e) },
  });
  const config = {
    welcome_enabled: true,
    welcome_channel_id: "channel-1",
    welcome_message: "Bienvenue {mention}",
    welcome_embed_enabled: false,
    welcome_template_id: "template-1",
  };
  if (toggle !== undefined) config.welcome_image_enabled = toggle;
  return { delivery, config, logs, stats: () => ({ imagesGenerated, entitlementCalls }) };
}

async function deliver(options) {
  const harness = createDelivery(options);
  const sent = [];
  await harness.delivery.welcome(member, harness.config, {
    sendChannelMessage: async (...args) => { sent.push(args); return {}; },
  });
  return { ...harness.stats(), logs: harness.logs, sent };
}

// ═══════════════════════════════════════════════════════════════
// 1 · LIVRAISON — matrice 2×2
// ═══════════════════════════════════════════════════════════════

test("4E/E2: toggle true + entitlement accordé ⇒ l'image est livrée", async () => {
  const result = await deliver({ toggle: true, granted: true });
  assert.equal(result.imagesGenerated, 1, "la carte est produite");
  assert.ok(result.sent[0][1].files, "le fichier est attaché au message");
});

test("4E/E2: toggle FALSE + entitlement accordé ⇒ AUCUNE image", async () => {
  const result = await deliver({ toggle: false, granted: true });
  assert.equal(result.imagesGenerated, 0, "Premium actif ne suffit pas : le toggle décide");
  assert.equal(result.sent[0][1].files, undefined, "aucun fichier attaché");
});

test("4E/E2: toggle true + entitlement ABSENT ⇒ AUCUNE image", async () => {
  const result = await deliver({ toggle: true, granted: false });
  assert.equal(result.imagesGenerated, 0, "le toggle ne suffit pas : l'entitlement décide");
});

test("4E/E2: toggle false + entitlement absent ⇒ AUCUNE image", async () => {
  const result = await deliver({ toggle: false, granted: false });
  assert.equal(result.imagesGenerated, 0);
});

// ═══════════════════════════════════════════════════════════════
// 2 · LIVRAISON — fail-closed sur les valeurs douteuses
// ═══════════════════════════════════════════════════════════════

for (const [label, value] of [
  ["absent (undefined)", undefined],
  ["null", null],
  ["la chaîne \"true\"", "true"],
  ["le nombre 1", 1],
  ["un objet truthy", {}],
]) {
  test(`4E/E2: toggle ${label} + entitlement accordé ⇒ AUCUNE image (strict === true)`, async () => {
    const result = await deliver({ toggle: value, granted: true });
    assert.equal(result.imagesGenerated, 0, "seul le booléen true accorde l'image");
  });
}

// ═══════════════════════════════════════════════════════════════
// 3 · LIVRAISON — ordre des vérifications et journalisation
// ═══════════════════════════════════════════════════════════════

test("4E/E2: toggle éteint ⇒ le backend Premium n'est PAS consulté", async () => {
  const result = await deliver({ toggle: false, granted: true });
  assert.equal(result.entitlementCalls, 0, "aucun appel au backend pour une image éteinte");
});

test("4E/E2: toggle allumé ⇒ le backend Premium EST consulté", async () => {
  const result = await deliver({ toggle: true, granted: true });
  assert.equal(result.entitlementCalls, 1);
});

test("4E/E2: le motif journalisé distingue « désactivée » de « Premium requis »", async () => {
  const disabled = await deliver({ toggle: false, granted: true });
  const skipDisabled = disabled.logs.find((e) => e.type === LogType.WELCOME_CARD_SKIPPED);
  assert.equal(skipDisabled.reason, SkipReason.IMAGE_DISABLED);

  const free = await deliver({ toggle: true, granted: false });
  const skipPremium = free.logs.find((e) => e.type === LogType.WELCOME_CARD_SKIPPED);
  assert.equal(skipPremium.reason, EntitlementDecision.PREMIUM_REQUIRED);

  assert.notEqual(skipDisabled.reason, skipPremium.reason, "les deux motifs restent distinguables");
});

test("4E/E2: backend Premium injoignable + toggle allumé ⇒ aucune image (fail-closed conservé)", async () => {
  const result = await deliver({ toggle: true, entitlementPresent: false });
  assert.equal(result.imagesGenerated, 0);
  const skip = result.logs.find((e) => e.type === LogType.WELCOME_CARD_SKIPPED);
  assert.equal(skip.reason, EntitlementDecision.UNAVAILABLE);
});

// ═══════════════════════════════════════════════════════════════
// 4 · Le reste du Welcome est préservé
// ═══════════════════════════════════════════════════════════════

test("4E/E2: image éteinte ⇒ message, salon et embed sont livrés normalement", async () => {
  const result = await deliver({ toggle: false, granted: true });
  assert.equal(result.sent.length, 1, "le Welcome texte part quand même");
  assert.equal(result.sent[0][0], "channel-1", "dans le bon salon");
  assert.equal(result.sent[0][1].content, "Bienvenue @nina", "message rendu");
  assert.equal(result.sent[0][1].files, undefined, "mais sans image");
});

test("4E/E2: welcome_enabled false ⇒ rien n'est livré, image ou non", async () => {
  const harness = createDelivery({ toggle: true, granted: true });
  harness.config.welcome_enabled = false;
  const sent = [];
  await harness.delivery.welcome(member, harness.config, { sendChannelMessage: async (...a) => { sent.push(a); return {}; } });
  assert.equal(sent.length, 0);
  assert.equal(harness.stats().imagesGenerated, 0);
});

// ═══════════════════════════════════════════════════════════════
// 5 · APERÇU — matrice 2×2 sur le second chemin
// ═══════════════════════════════════════════════════════════════

async function preview({ toggle, granted = true, entitlementPresent = true, locale = "fr" }) {
  const registry = new InteractionRegistry();
  let imagesGenerated = 0;
  let entitlementCalls = 0;
  const config = { welcome_message: "Bonjour {mention}", welcome_template_id: "template-1" };
  if (toggle !== undefined) config.welcome_image_enabled = toggle;
  registerWelcomeGoodbye({
    registry,
    service: { get: async () => ({ ...config }) },
    settingsHome: async () => {},
    imagePipeline: { generate: async () => { imagesGenerated += 1; return { buffer: Buffer.from("png") }; } },
    templateRegistry: { get: () => ({ design: {} }) },
    entitlementService: entitlementPresent ? {
      requireFeature: async () => {
        entitlementCalls += 1;
        return { ok: true, granted, code: granted ? EntitlementDecision.GRANTED : EntitlementDecision.PREMIUM_REQUIRED };
      },
    } : null,
  });
  const route = registry.find({ kind: "button", customId: Id.PREVIEW_WELCOME_IMAGE });
  let reply = null;
  let imageReplied = false;
  const i18n = new I18nService({ dictionaries });
  await route.execute({
    guildId: "guild",
    userId: "user",
    locale,
    t: i18n.forLocale(locale),
    envelope: {
      transport: {
        reply: async (payload) => { reply = payload; },
        replyImagePreview: async () => { imageReplied = true; },
      },
    },
  });
  return { reply, imagesGenerated, entitlementCalls, imageReplied };
}

test("4E/E2: aperçu — toggle true + entitlement accordé ⇒ image produite", async () => {
  const result = await preview({ toggle: true, granted: true });
  assert.equal(result.imagesGenerated, 1);
  assert.equal(result.imageReplied, true);
});

test("4E/E2: aperçu — toggle FALSE + entitlement accordé ⇒ refus, aucune image", async () => {
  const result = await preview({ toggle: false, granted: true });
  assert.equal(result.imagesGenerated, 0);
  assert.equal(result.reply.view.content, dictionaries.fr.welcomeGoodbye.welcomeImageDisabled);
  assert.equal(result.entitlementCalls, 0, "le backend Premium n'est pas consulté");
});

test("4E/E2: aperçu — toggle true + entitlement ABSENT ⇒ vue Premium requise", async () => {
  const result = await preview({ toggle: true, granted: false });
  assert.equal(result.imagesGenerated, 0);
  assert.equal(result.entitlementCalls, 1);
  assert.match(result.reply.view.content, /discord\.gg/i, "le refus Premium reste professionnel");
  assert.notEqual(result.reply.view.content, dictionaries.fr.welcomeGoodbye.welcomeImageDisabled,
    "le motif affiché est le bon : Premium, pas « désactivée »");
});

test("4E/E2: aperçu — toggle absent ⇒ refus (fail-closed)", async () => {
  const result = await preview({ toggle: undefined, granted: true });
  assert.equal(result.imagesGenerated, 0);
  assert.equal(result.reply.view.content, dictionaries.fr.welcomeGoodbye.welcomeImageDisabled);
});

// La garde de l'aperçu est écrite à un AUTRE endroit que celle de la livraison :
// sa rigueur doit être prouvée ici aussi, sinon les deux finissent par diverger.
for (const [label, value] of [
  ["null", null],
  ["la chaîne \"true\"", "true"],
  ["le nombre 1", 1],
  ["un objet truthy", {}],
]) {
  test(`4E/E2: aperçu — toggle ${label} ⇒ refus (strict === true)`, async () => {
    const result = await preview({ toggle: value, granted: true });
    assert.equal(result.imagesGenerated, 0, "seul le booléen true accorde l'aperçu");
    assert.equal(result.entitlementCalls, 0, "le backend Premium n'est pas consulté");
  });
}

test("4E/E2: aperçu — le message « image désactivée » existe en FR et EN", async () => {
  for (const locale of ["fr", "en"]) {
    const result = await preview({ toggle: false, granted: true, locale });
    assert.equal(result.reply.view.content, dictionaries[locale].welcomeGoodbye.welcomeImageDisabled);
    assert.equal(result.reply.ephemeral, true, "réponse éphémère");
  }
});

// ═══════════════════════════════════════════════════════════════
// 6 · Couche configuration
// ═══════════════════════════════════════════════════════════════

test("4E/E2: welcome_image_enabled est whitelistée (sinon A1 rejette l'écriture)", async () => {
  assert.equal(isGuildConfigKey("welcome_image_enabled"), true);
  assert.equal(isGuildConfigKey("welcome_enabled"), true, "contre-vérification sur une clé connue");
  assert.equal(isGuildConfigKey("xp_rate"), false, "contre-vérification sur une clé exclue");
});

test("4E/E2: le schéma impose un booléen strict", async () => {
  assert.deepEqual(WelcomeGoodbyeConfigSchema.welcome_image_enabled, { type: "boolean" });
  assert.equal(validateWelcomeGoodbyeUpdates({ welcome_image_enabled: true }), true);
  assert.equal(validateWelcomeGoodbyeUpdates({ welcome_image_enabled: false }), true);
  for (const bad of ["true", 1, null, {}, []]) {
    assert.throws(() => validateWelcomeGoodbyeUpdates({ welcome_image_enabled: bad }),
      `la valeur ${JSON.stringify(bad)} doit être refusée`);
  }
});

test("4E/E2: le défaut est false, comme les autres toggles et comme la base", async () => {
  assert.equal(WelcomeGoodbyeDefaults.welcome_image_enabled, false);
  assert.equal(WelcomeGoodbyeDefaults.welcome_enabled, false, "cohérent avec welcome_enabled");
  assert.equal(WelcomeGoodbyeDefaults.welcome_embed_enabled, false, "cohérent avec l'embed");
});

test("4E/E2: aucune autre clé de config n'a été créée", async () => {
  const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
  const keys = Object.values(Key);
  assert.equal(keys.length, 14, "13 clés historiques + welcome_image_enabled, rien d'autre");
  assert.ok(keys.includes("welcome_image_enabled"));
  // Aucune clé inventée du type « enabled » en trop.
  const enabledKeys = keys.filter((k) => k.endsWith("_enabled"));
  assert.deepEqual(enabledKeys.sort(), [
    "goodbye_embed_enabled", "goodbye_enabled", "welcome_dm_enabled",
    "welcome_embed_enabled", "welcome_enabled", "welcome_image_enabled",
  ]);
});

test("4E/E2: l'entitlement vérifié reste WELCOME_IMAGE", async () => {
  let seen = null;
  const harness = createDelivery({ toggle: true, granted: true });
  harness.delivery.entitlementService = {
    requireFeature: async ({ feature }) => {
      seen = feature;
      return { ok: true, granted: true, code: EntitlementDecision.GRANTED };
    },
  };
  await harness.delivery.welcome(member, harness.config, { sendChannelMessage: async () => ({}) });
  assert.equal(seen, EntitlementFeature.WELCOME_IMAGE);
});
