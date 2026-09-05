"use strict";

// Phase 2 (P6) — Entitlement WELCOME_IMAGE au niveau RÉEL de la livraison.
//
// Avant le correctif, la carte Welcome Premium était générée pour toute guilde
// ayant un pipeline et des templates : le seul contrôle portait sur le bouton
// d'aperçu (register.js). Une guilde Free recevait donc l'image Premium à
// chaque arrivée de membre. Reproduit à l'exécution avant correctif.
//
// Ce fichier couvre la matrice de décision complète avec le VRAI
// EntitlementService et la VRAIE PremiumMutationPolicy (seuls le dépôt
// d'entitlements et le transport sont des doubles), puis vérifie le câblage de
// la composition de production.

const test = require("node:test");
const assert = require("node:assert/strict");

const { EntitlementService, PremiumMutationPolicy, EntitlementDecision } = require("../../src/core/entitlements");
const { WelcomeDeliveryService } = require("../../src/modules/welcome-goodbye/services/WelcomeDeliveryService");
const { WelcomeTemplateRenderer, defaultPlaceholderProviders } = require("../../src/modules/welcome-goodbye/services/WelcomeTemplateRenderer");
const { WelcomeTemplateRegistry } = require("../../src/modules/welcome-goodbye/rendering/WelcomeTemplateRegistry");

const TECHNICAL_GUILD_ID = "1320817768962064384";
const FREE_GUILD_ID = "900000000000000001";
const PREMIUM_GUILD_ID = "900000000000000002";

const member = (guildId) => ({
  guildId,
  userId: "user-1",
  user: "@nina",
  mention: "@nina",
  username: "nina",
  displayName: "Nina",
  avatarUrl: null,
  server: "Guilde",
  memberCount: 7,
  joinDate: "30/08/2026",
});

const CONFIG = Object.freeze({
  welcome_enabled: true,
  welcome_channel_id: "channel-1",
  welcome_message: "Bienvenue {mention} sur {server}",
  welcome_embed_enabled: false,
});

const activeRecord = (overrides = {}) => ({
  guild_id: PREMIUM_GUILD_ID,
  feature_key: "WELCOME_IMAGE",
  status: "active",
  starts_at: "2026-01-01T00:00:00.000Z",
  ends_at: null,
  ...overrides,
});

/** Vrai EntitlementService + vraie PremiumMutationPolicy ; seul le dépôt est un double. */
function entitlementServiceWith(findFeature) {
  return new EntitlementService({
    repository: { findFeature },
    mutationPolicy: new PremiumMutationPolicy(),
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });
}

/** Service de livraison réel + pipeline compté + journaux séparés par niveau. */
function harness({ entitlementService = null } = {}) {
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  const sent = [];
  const logs = { info: [], warn: [] };
  let pipelineCalls = 0;
  const delivery = new WelcomeDeliveryService({
    renderer: new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() }),
    imagePipeline: { generate: async () => { pipelineCalls += 1; return { buffer: Buffer.from("PNGdata"), contentType: "image/png" }; } },
    templateRegistry: registry,
    entitlementService,
    logService: {
      delivery: (event) => { logs.info.push(event); return event; },
      failure: (event) => { logs.warn.push(event); return event; },
    },
  });
  const transport = { sendChannelMessage: async (...args) => { sent.push(args); return {}; } };
  return { delivery, transport, sent, logs, pipelineCalls: () => pipelineCalls };
}

async function deliver(guildId, options = {}) {
  const h = harness(options);
  await h.delivery.welcome(member(guildId), CONFIG, h.transport);
  const payload = h.sent[0]?.[1];
  return {
    ...h,
    payload,
    hasCard: Boolean(payload?.files?.length),
    skipped: [...h.logs.info, ...h.logs.warn].filter((event) => event.type === "WELCOME_CARD_SKIPPED"),
  };
}

test("une guilde Free ne reçoit jamais la carte Premium", async () => {
  const result = await deliver(FREE_GUILD_ID, {
    entitlementService: entitlementServiceWith(async () => null),
  });

  assert.equal(result.sent.length, 1, "le message de bienvenue textuel part toujours");
  assert.equal(result.payload.content, "Bienvenue @nina sur Guilde");
  assert.equal(result.hasCard, false, "aucune image Premium pour une guilde Free");
  assert.equal(result.pipelineCalls(), 0, "le pipeline de rendu n'est même pas atteint");
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, EntitlementDecision.PREMIUM_REQUIRED);
  assert.equal(result.skipped[0].guildId, FREE_GUILD_ID);
});

test("une guilde Free est un fonctionnement normal, pas une panne (journalisée en info)", async () => {
  const result = await deliver(FREE_GUILD_ID, {
    entitlementService: entitlementServiceWith(async () => null),
  });
  assert.equal(result.logs.info.length, 2, "WELCOME_CARD_SKIPPED + WELCOME_SENT");
  assert.equal(result.logs.warn.length, 0, "aucun avertissement pour une guilde Free");
});

test("une guilde Premium active reçoit la carte", async () => {
  const result = await deliver(PREMIUM_GUILD_ID, {
    entitlementService: entitlementServiceWith(async () => activeRecord()),
  });
  assert.equal(result.hasCard, true);
  assert.equal(result.payload.files[0].name, "welcome-card.png");
  assert.equal(result.pipelineCalls(), 1);
  assert.equal(result.skipped.length, 0);
});

test("un Premium avec une date de fin future reste actif", async () => {
  const result = await deliver(PREMIUM_GUILD_ID, {
    entitlementService: entitlementServiceWith(async () => activeRecord({ ends_at: "2027-01-01T00:00:00.000Z" })),
  });
  assert.equal(result.hasCard, true);
});

test("un Premium expiré ne reçoit plus la carte", async () => {
  const result = await deliver(PREMIUM_GUILD_ID, {
    entitlementService: entitlementServiceWith(async () => activeRecord({ ends_at: "2026-08-01T00:00:00.000Z" })),
  });
  assert.equal(result.hasCard, false);
  assert.equal(result.skipped[0].reason, EntitlementDecision.PREMIUM_REQUIRED);
});

test("un Premium révoqué ne reçoit plus la carte", async () => {
  const result = await deliver(PREMIUM_GUILD_ID, {
    entitlementService: entitlementServiceWith(async () => activeRecord({ status: "revoked" })),
  });
  assert.equal(result.hasCard, false);
});

test("un backend injoignable coupe la carte et le signale distinctement (warn)", async () => {
  const result = await deliver(PREMIUM_GUILD_ID, {
    entitlementService: entitlementServiceWith(async () => { throw new Error("fetch failed"); }),
  });
  assert.equal(result.sent.length, 1, "le texte part quand même");
  assert.equal(result.hasCard, false, "panne backend ≠ droit accordé");
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, EntitlementDecision.UNAVAILABLE);
  assert.equal(result.logs.warn.length, 1, "une panne est un avertissement");
  assert.equal(result.logs.info.length, 1, "seul WELCOME_SENT en info");
});

test("PREMIUM_REQUIRED et ENTITLEMENT_UNAVAILABLE restent distinguables", async () => {
  const free = await deliver(FREE_GUILD_ID, { entitlementService: entitlementServiceWith(async () => null) });
  const down = await deliver(PREMIUM_GUILD_ID, {
    entitlementService: entitlementServiceWith(async () => { throw new Error("fetch failed"); }),
  });
  assert.notEqual(free.skipped[0].reason, down.skipped[0].reason);
  assert.equal(free.skipped[0].reason, "PREMIUM_REQUIRED");
  assert.equal(down.skipped[0].reason, "ENTITLEMENT_UNAVAILABLE");
});

test("la guilde technique reste Premium permanent même backend éteint", async () => {
  const result = await deliver(TECHNICAL_GUILD_ID, {
    entitlementService: entitlementServiceWith(async () => { throw new Error("backend down"); }),
  });
  assert.equal(result.hasCard, true, "la guilde technique ne dépend d'aucun backend");
  assert.equal(result.skipped.length, 0);
  assert.equal(result.logs.warn.length, 0);
});

test("un service d'entitlement qui lève replie en fail-closed", async () => {
  const result = await deliver(PREMIUM_GUILD_ID, {
    entitlementService: { requireFeature: async () => { throw new Error("resolver exploded"); } },
  });
  assert.equal(result.hasCard, false);
  assert.equal(result.skipped[0].reason, EntitlementDecision.UNAVAILABLE);
});

test("une décision sans granted explicite ne suffit pas à accorder la carte", async () => {
  for (const decision of [undefined, null, {}, { granted: "true" }, { ok: true }]) {
    const result = await deliver(PREMIUM_GUILD_ID, {
      entitlementService: { requireFeature: async () => decision },
    });
    assert.equal(result.hasCard, false, `décision ${JSON.stringify(decision)} ne doit pas accorder la carte`);
  }
});

test("aucun détail technique ne fuit dans le message livré", async () => {
  for (const [guildId, findFeature] of [
    [FREE_GUILD_ID, async () => null],
    [PREMIUM_GUILD_ID, async () => { throw new Error("Supabase connection refused"); }],
  ]) {
    const result = await deliver(guildId, { entitlementService: entitlementServiceWith(findFeature) });
    // Le texte livré est la seule surface visible : c'est lui qu'on audite.
    // (Le payload complet contient `"embed":null`, donc « null » n'est pas un
    // marqueur de fuite pertinent au niveau JSON.)
    const visible = String(result.payload.content);
    for (const forbidden of [
      guildId, "WELCOME_IMAGE", "PREMIUM_REQUIRED", "ENTITLEMENT_UNAVAILABLE",
      "entitlement", "Entitlement", "supabase", "Supabase", "guild_entitlements",
      "connection refused", "undefined", "null", "Error",
    ]) {
      assert.equal(visible.includes(forbidden), false, `le message ne doit pas contenir « ${forbidden} »`);
    }
    assert.equal(visible, "Bienvenue @nina sur Guilde");
    assert.deepEqual(Object.keys(result.payload).sort(), ["content", "embed"]);
  }
});

// ── Câblage de la composition de production ────────────────────────────────

function fakeDiscordMember(guildId) {
  const sent = [];
  const channel = { isTextBased: () => true, send: async (options) => { sent.push(options); return {}; } };
  return {
    sent,
    member: {
      guild: {
        id: guildId,
        name: "Guilde",
        memberCount: 7,
        channels: { cache: { get: (id) => (id === "channel-1" ? channel : null) } },
      },
      user: {
        id: "user-1",
        username: "nina",
        toString: () => "@nina",
        displayAvatarURL: () => null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        send: async () => ({}),
      },
      displayName: "Nina",
      joinedAt: new Date("2026-08-30T00:00:00.000Z"),
    },
  };
}

async function throughComposition(guildId, findFeature) {
  const { createWelcomeGoodbyeRuntime } = require("../../src/runtime/createWelcomeGoodbyeRuntime");
  const fake = fakeDiscordMember(guildId);
  const runtime = createWelcomeGoodbyeRuntime({
    guildConfigResolver: { get: async () => ({ ...CONFIG, welcome_dm_enabled: false }) },
    entitlementService: entitlementServiceWith(findFeature),
  });
  await runtime.handleMemberAdded(fake.member);
  return fake.sent;
}

test("la composition de production applique le garde à l'arrivée réelle d'un membre", async () => {
  const free = await throughComposition(FREE_GUILD_ID, async () => null);
  assert.equal(free.length, 1, "le salon reçoit le message");
  assert.equal(free[0].files, undefined, "aucune carte Premium pour la guilde Free");

  const premium = await throughComposition(PREMIUM_GUILD_ID, async () => activeRecord());
  assert.equal(premium.length, 1);
  assert.equal(premium[0].files.length, 1, "la guilde Premium reçoit sa carte");
  assert.equal(premium[0].files[0].name, "welcome-card.png");
});

test("la guilde technique reçoit la carte via la composition, backend éteint", async () => {
  const sent = await throughComposition(TECHNICAL_GUILD_ID, async () => { throw new Error("backend down"); });
  assert.equal(sent[0].files.length, 1);
});
