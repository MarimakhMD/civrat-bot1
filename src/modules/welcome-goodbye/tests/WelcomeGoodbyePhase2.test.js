"use strict";

/**
 * PHASE 2 — Welcome / Goodbye : correctifs B1 à B10.
 *
 * Chaque test correspond à un bug confirmé lors de l'audit, et échouait avant le
 * correctif. Les doubles sont volontairement fidèles au contrat réel
 * (identifiants présents, `channels.fetch`, `permissionsFor`) : c'est précisément
 * leur simplification excessive qui avait laissé passer ces bugs.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const {
  WelcomeGoodbyeDefaultMessages,
  resolveConfiguredMessage,
  resolveWelcomeDmMessage,
} = require("../configuration/welcomeGoodbyeDefaults");
const { WelcomeTemplateRenderer, defaultPlaceholderProviders } = require("../services/WelcomeTemplateRenderer");
const { WelcomeDeliveryService } = require("../services/WelcomeDeliveryService");
const { normalizeWelcomeDeliveryError } = require("../services/WelcomeDeliveryError");
const { createWelcomeRenderer } = require("../services/welcomePayload");
const {
  buildPreviewContext,
  previewWelcomePayload,
  previewGoodbyePayload,
  previewWelcomeDmContent,
  previewWelcomeEmbedPayload,
  previewGoodbyeEmbedPayload,
} = require("../services/welcomePreview");
const { handleMemberAdded } = require("../events/handleMemberAdded");
const { handleMemberRemoved } = require("../events/handleMemberRemoved");
const { adaptGuildMember } = require("../../../adapters/discord/DiscordGuildMemberAdapter");
const {
  DiscordWelcomeGoodbyeTransport,
  WelcomeTransportReason,
} = require("../../../adapters/discord/DiscordWelcomeGoodbyeTransport");
const { selectWelcomeGoodbyeChannel } = require("../interactions/selectWelcomeGoodbyeChannel");
const { testWelcome } = require("../interactions/testWelcome");
const { testWelcomeDm } = require("../interactions/testWelcomeDm");
const { previewWelcomeEmbed } = require("../interactions/configureWelcomeEmbed");
const { previewGoodbyeEmbed } = require("../interactions/configureGoodbyeEmbed");
const { previewGoodbye } = require("../interactions/previewGoodbye");
const { WelcomeGoodbyeComponentId: ComponentId } = require("../configuration/welcomeGoodbyeConstants");

// ─────────────────────────────────────────────────────────────
// Doubles
// ─────────────────────────────────────────────────────────────

const MEMBER_ID = "111111111111111111";

function discordMember({ bot = false, guildId = "G1", guildName = "Serveur", memberCount = 42 } = {}) {
  const user = {
    id: MEMBER_ID,
    bot,
    username: "alice",
    tag: "alice#0001",
    toString: () => `<@${MEMBER_ID}>`,
    displayAvatarURL: () => "https://cdn.example/avatar.png",
    createdAt: new Date("2020-03-04T00:00:00.000Z"),
  };
  return {
    id: MEMBER_ID,
    user,
    displayName: "Alice",
    joinedAt: new Date("2024-05-01T00:00:00.000Z"),
    guild: { id: guildId, name: guildName, memberCount },
  };
}

function adapted(options) {
  return adaptGuildMember(discordMember(options), { language: options && options.language });
}

function config(overrides = {}) {
  return {
    language: "fr",
    [Key.WELCOME_ENABLED]: true,
    [Key.WELCOME_CHANNEL]: "C1",
    [Key.WELCOME_MESSAGE]: "Bienvenue {mention} sur {server} ({memberCount} membres)",
    [Key.WELCOME_EMBED]: false,
    [Key.WELCOME_COLOR]: "#00e85c",
    [Key.WELCOME_DM]: true,
    [Key.WELCOME_DM_MESSAGE]: "DM pour {username}",
    [Key.WELCOME_TEMPLATE]: "template-1",
    [Key.WELCOME_IMAGE_ENABLED]: false,
    [Key.GOODBYE_ENABLED]: true,
    [Key.GOODBYE_CHANNEL]: "C2",
    [Key.GOODBYE_MESSAGE]: "Au revoir {username}",
    [Key.GOODBYE_EMBED]: false,
    [Key.GOODBYE_COLOR]: "#ff4444",
    ...overrides,
  };
}

function delivery({ logService = null } = {}) {
  return new WelcomeDeliveryService({ renderer: createWelcomeRenderer(), logService });
}

function transport({ channelFails = false, dmFails = false } = {}) {
  const state = { channel: [], dm: [], events: [] };
  return {
    state,
    async sendChannelMessage(channelId, payload) {
      if (channelFails) {
        const error = new Error("channel_unavailable");
        error.reason = WelcomeTransportReason.CHANNEL_NOT_FOUND;
        throw error;
      }
      state.channel.push({ channelId, payload });
      return { ok: true };
    },
    async sendDirectMessage(userId, payload) {
      if (dmFails) throw new Error("Cannot send messages to this user");
      state.dm.push({ userId, payload });
      return { ok: true };
    },
  };
}

function logService(sink) {
  return {
    delivery: (event) => { sink.push({ level: "info", ...event }); return event; },
    failure: (event) => { sink.push({ level: "warn", ...event }); return event; },
  };
}

// ─────────────────────────────────────────────────────────────
// B1 — isolation Welcome salon / DM
// ─────────────────────────────────────────────────────────────

test("B1: un échec du Welcome en salon n'empêche PAS le DM", async () => {
  const sink = [];
  const t = transport({ channelFails: true });

  await assert.rejects(
    () => handleMemberAdded({
      member: adapted(),
      config: config(),
      service: { get: async () => config() },
      delivery: delivery({ logService: logService(sink) }),
      transport: t,
    }),
  );

  assert.equal(t.state.channel.length, 0);
  assert.equal(t.state.dm.length, 1, "le DM doit partir même quand le salon échoue");
  assert.equal(t.state.dm[0].payload.content, "DM pour alice");
  assert.ok(sink.some((e) => e.type === "DELIVERY_UNAVAILABLE"), "l'échec du salon reste journalisé");
  assert.ok(sink.some((e) => e.type === "WELCOME_DM_SENT"), "le DM est journalisé");
});

test("B1: Welcome activé sans salon choisi → le DM part quand même", async () => {
  const t = transport({ channelFails: true });
  const sink = [];

  await assert.rejects(
    () => handleMemberAdded({
      member: adapted(),
      config: config({ [Key.WELCOME_CHANNEL]: null }),
      service: { get: async () => config() },
      delivery: delivery({ logService: logService(sink) }),
      transport: t,
    }),
  );

  assert.equal(t.state.dm.length, 1, "l'absence de salon configuré ne doit pas supprimer le DM");
});

test("B1: un échec du DM n'empêche PAS le Welcome en salon", async () => {
  const t = transport({ dmFails: true });
  const sink = [];

  await assert.rejects(
    () => handleMemberAdded({
      member: adapted(),
      config: config(),
      service: { get: async () => config() },
      delivery: delivery({ logService: logService(sink) }),
      transport: t,
    }),
  );

  assert.equal(t.state.channel.length, 1, "le message en salon doit partir");
  assert.equal(t.state.dm.length, 0);
  assert.ok(sink.some((e) => e.type === "WELCOME_SENT"));
});

test("B1: les deux en échec → les DEUX erreurs remontent, aucune n'est masquée", async () => {
  const t = transport({ channelFails: true, dmFails: true });
  const sink = [];

  const error = await handleMemberAdded({
    member: adapted(),
    config: config(),
    service: { get: async () => config() },
    delivery: delivery({ logService: logService(sink) }),
    transport: t,
  }).then(() => null, (e) => e);

  assert.ok(error, "une erreur doit remonter");
  assert.ok(error instanceof AggregateError, "les deux échecs sont agrégés");
  assert.equal(error.errors.length, 2);
  assert.equal(sink.filter((e) => e.type === "DELIVERY_UNAVAILABLE").length, 2);
});

test("B1: chemin nominal → salon puis DM, aucune erreur", async () => {
  const t = transport();
  const sink = [];

  const result = await handleMemberAdded({
    member: adapted(),
    config: config(),
    service: { get: async () => config() },
    delivery: delivery({ logService: logService(sink) }),
    transport: t,
  });

  assert.equal(result, null);
  assert.equal(t.state.channel.length, 1);
  assert.equal(t.state.dm.length, 1);
  assert.deepEqual(sink.map((e) => e.type), ["WELCOME_SENT", "WELCOME_DM_SENT"]);
});

// ─────────────────────────────────────────────────────────────
// B2 / B3 — placeholders, tolérance aux deux casses
// ─────────────────────────────────────────────────────────────

test("B2: {memberCount} et {membercount} résolvent tous les deux", () => {
  const renderer = new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() });
  const context = adapted();

  assert.equal(renderer.render("{memberCount}", context), "42");
  assert.equal(renderer.render("{membercount}", context), "42");
});

test("B2: les quatre placeholders camelCase historiques sont résolus", () => {
  const renderer = new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() });
  const context = adapted();

  for (const [camel, lower] of [["{memberCount}", "{membercount}"], ["{userId}", "{userid}"], ["{displayName}", "{displayname}"], ["{joinDate}", "{joindate}"]]) {
    const camelValue = renderer.render(camel, context);
    const lowerValue = renderer.render(lower, context);
    assert.ok(camelValue.length > 0 && !camelValue.includes("{"), `${camel} doit être résolu, obtenu : ${camelValue}`);
    assert.equal(camelValue, lowerValue, `${camel} et ${lower} doivent donner la même valeur`);
  }
});

test("B3: accountAge, date et time sont résolus", () => {
  const renderer = new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() });
  const context = adapted({ language: "fr" });

  for (const token of ["{accountAge}", "{accountage}", "{date}", "{time}"]) {
    const value = renderer.render(token, context);
    assert.ok(value.length > 0 && !value.includes("{"), `${token} doit être résolu, obtenu : ${value}`);
  }
});

test("B2: un placeholder inconnu est laissé tel quel, jamais inventé", () => {
  const renderer = new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() });
  assert.equal(renderer.render("{inconnu}", adapted()), "{inconnu}");
});

test("B2: une valeur absente rend une chaîne vide, pas « null »", () => {
  const renderer = new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() });
  const context = adapted();
  context.username = null;
  assert.equal(renderer.render("[{username}]", context), "[]");
});

test("B2: le message livré contient le compte de membres résolu", async () => {
  const t = transport();
  await handleMemberAdded({
    member: adapted(),
    config: config(),
    service: { get: async () => config() },
    delivery: delivery(),
    transport: t,
  });

  assert.equal(
    t.state.channel[0].payload.content,
    `Bienvenue <@${MEMBER_ID}> sur Serveur (42 membres)`,
  );
});

// ─────────────────────────────────────────────────────────────
// B6 — défauts FR/EN appliqués uniquement si absent/vide
// ─────────────────────────────────────────────────────────────

test("B6: message absent → défaut FRANÇAIS", () => {
  assert.equal(
    resolveConfiguredMessage(config({ [Key.WELCOME_MESSAGE]: null }), Key.WELCOME_MESSAGE, "welcome"),
    WelcomeGoodbyeDefaultMessages.fr.welcome,
  );
  assert.equal(
    resolveConfiguredMessage(config({ [Key.GOODBYE_MESSAGE]: null }), Key.GOODBYE_MESSAGE, "goodbye"),
    WelcomeGoodbyeDefaultMessages.fr.goodbye,
  );
});

test("B6: message absent + language « en » → défaut ANGLAIS", () => {
  const cfg = config({ language: "en", [Key.WELCOME_MESSAGE]: null, [Key.GOODBYE_MESSAGE]: null });
  assert.equal(resolveConfiguredMessage(cfg, Key.WELCOME_MESSAGE, "welcome"), WelcomeGoodbyeDefaultMessages.en.welcome);
  assert.equal(resolveConfiguredMessage(cfg, Key.GOODBYE_MESSAGE, "goodbye"), WelcomeGoodbyeDefaultMessages.en.goodbye);
});

test("B6: un contenu configuré n'est JAMAIS remplacé", () => {
  const cfg = config({ [Key.WELCOME_MESSAGE]: "Mon message {mention}" });
  assert.equal(resolveConfiguredMessage(cfg, Key.WELCOME_MESSAGE, "welcome"), "Mon message {mention}");
});

test("B6: un contenu vide ou blanc retombe sur le défaut", () => {
  for (const empty of ["", "   ", "\n\t "]) {
    assert.equal(
      resolveConfiguredMessage(config({ [Key.WELCOME_MESSAGE]: empty }), Key.WELCOME_MESSAGE, "welcome"),
      WelcomeGoodbyeDefaultMessages.fr.welcome,
      `le contenu ${JSON.stringify(empty)} doit retomber sur le défaut`,
    );
  }
});

test("B6: le Welcome est livré avec le défaut localisé quand rien n'est configuré", async () => {
  const t = transport();
  const cfg = config({ [Key.WELCOME_MESSAGE]: null });
  await handleMemberAdded({
    member: adapted(),
    config: cfg,
    service: { get: async () => cfg },
    delivery: delivery(),
    transport: t,
  });

  assert.equal(t.state.channel[0].payload.content, `Bienvenue <@${MEMBER_ID}> sur Serveur !`);
});

test("B6: le DM n'est JAMAIS vide — repli message DM → Welcome → défaut", () => {
  const withDm = config({ [Key.WELCOME_DM_MESSAGE]: "Salut {username}" });
  assert.equal(resolveWelcomeDmMessage(withDm), "Salut {username}");

  const withoutDm = config({ [Key.WELCOME_DM_MESSAGE]: null, [Key.WELCOME_MESSAGE]: "Welcome configuré" });
  assert.equal(resolveWelcomeDmMessage(withoutDm), "Welcome configuré");

  const nothing = config({ [Key.WELCOME_DM_MESSAGE]: null, [Key.WELCOME_MESSAGE]: null });
  assert.equal(resolveWelcomeDmMessage(nothing), WelcomeGoodbyeDefaultMessages.fr.welcome);
});

test("B6: un contenu de DM absent n'empêche pas la tentative de DM", async () => {
  const t = transport();
  const cfg = config({ [Key.WELCOME_DM_MESSAGE]: null, [Key.WELCOME_MESSAGE]: null });

  await handleMemberAdded({
    member: adapted(),
    config: cfg,
    service: { get: async () => cfg },
    delivery: delivery(),
    transport: t,
  });

  assert.equal(t.state.dm.length, 1);
  assert.equal(t.state.dm[0].payload.content, `Bienvenue <@${MEMBER_ID}> sur Serveur !`);
});

// ─────────────────────────────────────────────────────────────
// B7 — dates localisées
// ─────────────────────────────────────────────────────────────

test("B7: une guilde FR reçoit des dates au format français", () => {
  const context = adapted({ language: "fr" });
  assert.equal(context.joinDate, new Date("2024-05-01T00:00:00.000Z").toLocaleDateString("fr-FR"));
  assert.equal(context.accountAge, new Date("2020-03-04T00:00:00.000Z").toLocaleDateString("fr-FR"));
});

test("B7: une guilde EN reçoit des dates au format anglais", () => {
  const context = adapted({ language: "en" });
  assert.equal(context.joinDate, new Date("2024-05-01T00:00:00.000Z").toLocaleDateString("en-GB"));
});

// Note : `fr-FR` et `en-GB` produisent le même rendu numérique (jour/mois/année).
// Le bug corrigé n'était pas une divergence FR/EN mais l'usage de la locale du
// CONTENEUR (en-US), qui donnait `5/1/2024`. L'assertion porte donc sur ce point.
test("B7: aucune langue ne produit le format US du conteneur", () => {
  const usStyle = new Date("2024-05-01T00:00:00.000Z").toLocaleDateString("en-US");
  const fr = adapted({ language: "fr" }).joinDate;
  const en = adapted({ language: "en" }).joinDate;

  assert.match(fr, /^\d{2}\/\d{2}\/\d{4}$/, "format jour/mois/année attendu");
  assert.equal(fr, "01/05/2024");
  assert.equal(en, "01/05/2024");
  assert.notEqual(fr, usStyle, "le format US du conteneur ne doit plus apparaître");
});

test("B7: sans langue fournie, le comportement historique est conservé", () => {
  const context = adapted();
  assert.equal(context.joinDate, new Date("2024-05-01T00:00:00.000Z").toLocaleDateString());
});

// ─────────────────────────────────────────────────────────────
// B10 — bots ignorés
// ─────────────────────────────────────────────────────────────

test("B10: un bot qui arrive ne reçoit ni Welcome ni DM", async () => {
  const t = transport();
  const sink = [];

  const result = await handleMemberAdded({
    member: adapted({ bot: true }),
    config: config(),
    service: { get: async () => config() },
    delivery: delivery({ logService: logService(sink) }),
    transport: t,
  });

  assert.equal(result, null);
  assert.equal(t.state.channel.length, 0);
  assert.equal(t.state.dm.length, 0);
  assert.equal(sink.length, 0);
});

test("B10: un bot qui part ne reçoit pas de Goodbye", async () => {
  const t = transport();
  const result = await handleMemberRemoved({
    member: adapted({ bot: true }),
    config: config(),
    service: { get: async () => config() },
    delivery: delivery(),
    transport: t,
  });

  assert.equal(result, null);
  assert.equal(t.state.channel.length, 0);
});

test("B10: un humain reçoit bien Welcome, DM et Goodbye", async () => {
  const t = transport();
  await handleMemberAdded({ member: adapted({ bot: false }), config: config(), service: { get: async () => config() }, delivery: delivery(), transport: t });
  await handleMemberRemoved({ member: adapted({ bot: false }), config: config(), service: { get: async () => config() }, delivery: delivery(), transport: t });

  assert.equal(t.state.channel.length, 2, "1 welcome + 1 goodbye");
  assert.equal(t.state.dm.length, 1);
});

// ─────────────────────────────────────────────────────────────
// B8 — résolution du salon, permissions, motifs distincts
// ─────────────────────────────────────────────────────────────

function textChannelStub({ canSend = true } = {}) {
  return {
    isTextBased: () => true,
    permissionsFor: () => ({ has: (permission) => (permission === "SendMessages" ? canSend : true) }),
    send: async (message) => message,
  };
}

function transportMember({ cached = null, fetchable = null } = {}) {
  return {
    id: MEMBER_ID,
    user: { id: MEMBER_ID },
    guild: {
      members: { me: { id: "bot" } },
      channels: {
        cache: { get: (id) => (cached && id === "C1" ? cached : null) },
        fetch: async (id) => (fetchable && id === "C1" ? fetchable : null),
      },
    },
  };
}

test("B8: un salon absent du cache est retrouvé par fetch()", async () => {
  const transportInstance = new DiscordWelcomeGoodbyeTransport(transportMember({ cached: null, fetchable: textChannelStub() }));
  const message = await transportInstance.sendChannelMessage("C1", { content: "Bonjour", embed: null });
  assert.deepEqual(message, { content: "Bonjour" });
});

test("B8: aucun salon configuré → CHANNEL_MISSING", async () => {
  const instance = new DiscordWelcomeGoodbyeTransport(transportMember());
  const error = await instance.sendChannelMessage(null, { content: "x", embed: null }).then(() => null, (e) => e);
  assert.equal(error.reason, WelcomeTransportReason.CHANNEL_MISSING);
});

test("B8: salon introuvable → CHANNEL_NOT_FOUND", async () => {
  const instance = new DiscordWelcomeGoodbyeTransport(transportMember({ cached: null, fetchable: null }));
  const error = await instance.sendChannelMessage("C1", { content: "x", embed: null }).then(() => null, (e) => e);
  assert.equal(error.reason, WelcomeTransportReason.CHANNEL_NOT_FOUND);
});

test("B8: salon sans permission SendMessages → MISSING_PERMISSIONS", async () => {
  const instance = new DiscordWelcomeGoodbyeTransport(transportMember({ cached: textChannelStub({ canSend: false }) }));
  const error = await instance.sendChannelMessage("C1", { content: "x", embed: null }).then(() => null, (e) => e);
  assert.equal(error.reason, WelcomeTransportReason.MISSING_PERMISSIONS);
});

test("B8: normalizeWelcomeDeliveryError conserve le motif précis du transport", () => {
  const error = new Error("missing_permissions");
  error.reason = WelcomeTransportReason.MISSING_PERMISSIONS;
  assert.equal(normalizeWelcomeDeliveryError(error, { guildId: "G1" }).metadata.reason, "MISSING_PERMISSIONS");
});

test("B8: le repli historique reste channel_unavailable pour un appelant sans motif", () => {
  assert.equal(normalizeWelcomeDeliveryError(new Error("Missing Permissions"), { guildId: "G1" }).metadata.reason, "channel_unavailable");
  assert.equal(normalizeWelcomeDeliveryError(new Error("boom"), { guildId: "G1" }).metadata.reason, "delivery_failed");
});

test("B8: le motif précis remonte dans les journaux de livraison", async () => {
  const sink = [];
  const t = {
    async sendChannelMessage() {
      const error = new Error("missing_permissions");
      error.reason = WelcomeTransportReason.MISSING_PERMISSIONS;
      throw error;
    },
    async sendDirectMessage() { return { ok: true }; },
  };

  await assert.rejects(() => handleMemberAdded({
    member: adapted(),
    config: config(),
    service: { get: async () => config() },
    delivery: delivery({ logService: logService(sink) }),
    transport: t,
  }));

  const failure = sink.find((e) => e.type === "DELIVERY_UNAVAILABLE");
  assert.equal(failure.reason, "MISSING_PERMISSIONS");
});

// ─────────────────────────────────────────────────────────────
// B9 — DM vers le bon utilisateur
// ─────────────────────────────────────────────────────────────

test("B9: utilisateur inconnu du client → USER_UNAVAILABLE, jamais de mauvais destinataire", async () => {
  const instance = new DiscordWelcomeGoodbyeTransport({
    id: MEMBER_ID,
    user: { id: MEMBER_ID, send: async () => { throw new Error("ne doit pas être appelé"); } },
    guild: { client: { users: { cache: new Map(), fetch: async () => null } } },
  });

  const error = await instance.sendDirectMessage("inconnu", { content: "x" }).then(() => null, (e) => e);
  assert.equal(error.reason, WelcomeTransportReason.USER_UNAVAILABLE);
});

test("B9: le DM de livraison vise bien le membre concerné", async () => {
  const t = transport();
  await handleMemberAdded({ member: adapted(), config: config(), service: { get: async () => config() }, delivery: delivery(), transport: t });
  assert.equal(t.state.dm[0].userId, MEMBER_ID);
});

// ─────────────────────────────────────────────────────────────
// B4 — select Goodbye acquitté et rafraîchi
// ─────────────────────────────────────────────────────────────

test("B4: la sélection du salon Goodbye écrit, acquitte et rafraîchit le panneau", async () => {
  const updates = [];
  const calls = [];

  await selectWelcomeGoodbyeChannel({
    guildId: "G1",
    t: (key) => key,
    envelope: { customId: ComponentId.GOODBYE_CHANNEL, values: ["123456789012345"], transport: { update: async (value) => updates.push(value) } },
    settings: {
      get: async () => ({ [Key.GOODBYE_ENABLED]: true }),
      update: async (...args) => { calls.push(args); return { [Key.GOODBYE_ENABLED]: true, [Key.GOODBYE_CHANNEL]: "123456789012345" }; },
    },
  });

  assert.deepEqual(calls, [["G1", { [Key.GOODBYE_CHANNEL]: "123456789012345" }]]);
  assert.equal(updates.length, 1, "l'interaction doit être acquittée et le panneau rafraîchi");
});

// ─────────────────────────────────────────────────────────────
// B5 — aperçu, test et livraison : même rendu
// ─────────────────────────────────────────────────────────────

const TEMPLATE = "Bienvenue {mention} sur {server} ({memberCount} membres)";

function interactionContext(overrides = {}) {
  const replies = [];
  const sent = [];
  const member = discordMember();
  return {
    replies,
    sent,
    context: {
      guildId: "G1",
      userId: MEMBER_ID,
      member,
      config: config({ [Key.WELCOME_MESSAGE]: TEMPLATE }),
      t: (key) => key,
      settings: { get: async () => config({ [Key.WELCOME_MESSAGE]: TEMPLATE }) },
      envelope: {
        transport: {
          reply: async (value) => { replies.push(value); return value; },
          update: async (value) => value,
          sendTestWelcome: async (payload) => { sent.push(payload); return payload; },
          sendTestWelcomeDm: async (payload) => { sent.push(payload); return payload; },
        },
      },
      adminLogService: { record: () => {} },
      ...overrides,
    },
  };
}

test("B5: le test Welcome envoie un contenu RENDU, pas le modèle brut", async () => {
  const { context: ctx, sent } = interactionContext();
  await testWelcome(ctx);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, `Bienvenue <@${MEMBER_ID}> sur Serveur (42 membres)`);
  assert.ok(!String(sent[0].content).includes("{"), "aucun placeholder brut ne doit subsister");
});

test("B5: le test DM envoie un contenu RENDU", async () => {
  const { context: ctx, sent } = interactionContext();
  await testWelcomeDm(ctx);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, "DM pour alice");
});

test("B5: le test DM applique le repli et n'envoie jamais un message vide", async () => {
  const cfg = config({ [Key.WELCOME_DM_MESSAGE]: null, [Key.WELCOME_MESSAGE]: null });
  const { context: ctx, sent } = interactionContext({
    config: cfg,
    settings: { get: async () => cfg },
  });
  await testWelcomeDm(ctx);

  assert.equal(sent[0].content, `Bienvenue <@${MEMBER_ID}> sur Serveur !`);
});

test("B5: les aperçus embed sont rendus", async () => {
  const welcomeCtx = interactionContext();
  await previewWelcomeEmbed(welcomeCtx.context);
  assert.equal(welcomeCtx.replies[0].view.content, `Bienvenue <@${MEMBER_ID}> sur Serveur (42 membres)`);
  assert.equal(welcomeCtx.replies[0].view.embed.color, "#00e85c");

  const goodbyeCtx = interactionContext();
  await previewGoodbyeEmbed(goodbyeCtx.context);
  assert.equal(goodbyeCtx.replies[0].view.content, "Au revoir alice");
  assert.equal(goodbyeCtx.replies[0].view.embed.color, "#ff4444");
});

test("B5: l'aperçu Goodbye utilise le contexte RÉEL, pas un contexte vide", async () => {
  const { context: ctx, replies } = interactionContext();
  await previewGoodbye(ctx);

  assert.equal(replies[0].view.content, "Au revoir alice");
  assert.ok(!String(replies[0].view.content).includes("{"));
});

test("B5: le payload d'aperçu est IDENTIQUE au payload livré", async () => {
  const { context: ctx } = interactionContext();
  const cfg = config({ [Key.WELCOME_MESSAGE]: TEMPLATE });

  const previewed = await previewWelcomePayload({ ...ctx, config: cfg });
  const t = transport();
  await handleMemberAdded({
    member: buildPreviewContext({ ...ctx, config: cfg }),
    config: cfg,
    service: { get: async () => cfg },
    delivery: delivery(),
    transport: t,
  });

  assert.deepEqual(previewed, t.state.channel[0].payload);
});

test("B5: l'aperçu Welcome et l'aperçu Goodbye sont cohérents avec le même contexte", async () => {
  const { context: ctx } = interactionContext();
  const ctxWithConfig = { ...ctx, config: config({ [Key.WELCOME_MESSAGE]: TEMPLATE }) };

  const welcomePreview = await previewWelcomePayload(ctxWithConfig);
  const goodbyePreview = await previewGoodbyePayload(ctxWithConfig);

  assert.ok(welcomePreview.content.includes(String(MEMBER_ID)));
  assert.equal(goodbyePreview.content, "Au revoir alice");
  assert.equal(previewWelcomeDmContent(ctxWithConfig), "DM pour alice");
  assert.ok(previewWelcomeEmbedPayload(ctxWithConfig).embed);
  assert.ok(previewGoodbyeEmbedPayload(ctxWithConfig).embed);
});

// ─────────────────────────────────────────────────────────────
// Indépendance totale par guildId
// ─────────────────────────────────────────────────────────────

test("indépendance: deux guildes configurées différemment ne se mélangent pas", async () => {
  const configs = {
    G1: config({ [Key.WELCOME_MESSAGE]: "Guilde UN {server}", [Key.WELCOME_DM]: false, [Key.GOODBYE_ENABLED]: false }),
    G2: config({ [Key.WELCOME_MESSAGE]: "Guilde DEUX {server}", [Key.WELCOME_DM]: true, [Key.GOODBYE_ENABLED]: true, language: "en" }),
  };
  const service = { get: async (guildId) => configs[guildId] };

  const t1 = transport();
  await handleMemberAdded({ member: adapted({ guildId: "G1", guildName: "Un" }), config: null, service, delivery: delivery(), transport: t1 });
  assert.equal(t1.state.channel[0].payload.content, "Guilde UN Un");
  assert.equal(t1.state.dm.length, 0, "le DM est désactivé pour G1");

  const t2 = transport();
  await handleMemberAdded({ member: adapted({ guildId: "G2", guildName: "Deux" }), config: null, service, delivery: delivery(), transport: t2 });
  assert.equal(t2.state.channel[0].payload.content, "Guilde DEUX Deux");
  assert.equal(t2.state.dm.length, 1, "le DM reste activé pour G2");
});

test("indépendance: la langue d'une guilde n'affecte pas l'autre", () => {
  // Adaptations successives : aucune locale ne doit « fuiter » d'un appel à
  // l'autre (pas d'état partagé dans l'adaptateur).
  const fr = adaptGuildMember(discordMember({ guildId: "G1" }), { language: "fr" });
  const en = adaptGuildMember(discordMember({ guildId: "G2" }), { language: "en" });
  const frAgain = adaptGuildMember(discordMember({ guildId: "G1" }), { language: "fr" });

  assert.equal(fr.joinDate, new Date("2024-05-01T00:00:00.000Z").toLocaleDateString("fr-FR"));
  assert.equal(en.joinDate, new Date("2024-05-01T00:00:00.000Z").toLocaleDateString("en-GB"));
  assert.equal(frAgain.joinDate, fr.joinDate);
  assert.equal(fr.guildId, "G1");
  assert.equal(en.guildId, "G2");
});

// ─────────────────────────────────────────────────────────────
// Toggles indépendants
// ─────────────────────────────────────────────────────────────

test("toggles: Welcome salon désactivé mais DM activé → seul le DM part", async () => {
  const t = transport();
  await handleMemberAdded({
    member: adapted(),
    config: config({ [Key.WELCOME_ENABLED]: false, [Key.WELCOME_DM]: true }),
    service: { get: async () => config() },
    delivery: delivery(),
    transport: t,
  });

  assert.equal(t.state.channel.length, 0);
  assert.equal(t.state.dm.length, 1);
});

test("toggles: Goodbye désactivé → rien n'est envoyé", async () => {
  const t = transport();
  const result = await handleMemberRemoved({
    member: adapted(),
    config: config({ [Key.GOODBYE_ENABLED]: false }),
    service: { get: async () => config() },
    delivery: delivery(),
    transport: t,
  });

  assert.equal(result, null);
  assert.equal(t.state.channel.length, 0);
});

test("toggles: embed activé → le texte est porté par l'embed", async () => {
  const t = transport();
  await handleMemberAdded({
    member: adapted(),
    config: config({ [Key.WELCOME_EMBED]: true, [Key.WELCOME_COLOR]: "#123456" }),
    service: { get: async () => config() },
    delivery: delivery(),
    transport: t,
  });

  const payload = t.state.channel[0].payload;
  assert.equal(payload.embed.color, "#123456");
  assert.equal(payload.embed.description, payload.content);
});

// ─────────────────────────────────────────────────────────────
// Membre partiel (Goodbye)
// ─────────────────────────────────────────────────────────────

test("membre partiel (user null) → aucun TypeError, rien d'inventé", () => {
  const context = adaptGuildMember({ id: MEMBER_ID, user: null, guild: { id: "G1", name: "Serveur", memberCount: 7 } });
  assert.equal(context.userId, MEMBER_ID);
  assert.equal(context.username, null);
  assert.equal(context.user, null);
  assert.equal(context.isBot, false, "un membre partiel n'est pas supposé bot");

  const rendered = createWelcomeRenderer().render("Au revoir {username} ({server})", context);
  assert.equal(rendered, "Au revoir  (Serveur)");
});

// ─────────────────────────────────────────────────────────────
// WELCOME_IMAGE — non-régression (logique Premium inchangée)
// ─────────────────────────────────────────────────────────────

const { WelcomeTemplateRegistry } = require("../rendering/WelcomeTemplateRegistry");
const { EntitlementDecision } = require("../../../core/entitlements");

function premiumDelivery({ granted = true, failPipeline = false, captured = null } = {}) {
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  const pipeline = failPipeline
    ? { generate: async () => { throw new Error("render exploded"); } }
    : { generate: async (request) => { if (captured) captured.push(request); return { buffer: Buffer.from("fake-png") }; } };
  return new WelcomeDeliveryService({
    renderer: createWelcomeRenderer(),
    imagePipeline: pipeline,
    templateRegistry: registry,
    entitlementService: {
      requireFeature: async () => (granted
        ? { ok: true, granted: true, code: EntitlementDecision.GRANTED }
        : { ok: true, granted: false, code: EntitlementDecision.PREMIUM_REQUIRED }),
    },
  });
}

function cardSubtitle(request) {
  const subtitle = request.textElements.find((element) => element.id === "subtitle");
  return subtitle ? subtitle.content : null;
}

test("NON-RÉGRESSION Premium: une guilde Free ne reçoit pas la carte, mais reçoit le texte", async () => {
  const t = transport();
  const cfg = config({ [Key.WELCOME_IMAGE_ENABLED]: true });

  await handleMemberAdded({
    member: adapted(),
    config: cfg,
    service: { get: async () => cfg },
    delivery: premiumDelivery({ granted: false }),
    transport: t,
  });

  assert.equal(t.state.channel.length, 1, "le texte reste livré");
  assert.equal(t.state.channel[0].payload.files, undefined, "aucune carte pour une guilde Free");
});

test("NON-RÉGRESSION Premium: le sous-titre de la carte suit le contenu livré, défaut localisé compris (B6)", async () => {
  const captured = [];
  const t = transport();
  const cfg = config({ [Key.WELCOME_IMAGE_ENABLED]: true, [Key.WELCOME_MESSAGE]: null });

  await handleMemberAdded({
    member: adapted(),
    config: cfg,
    service: { get: async () => cfg },
    delivery: premiumDelivery({ captured }),
    transport: t,
  });

  assert.equal(captured.length, 1, "la carte est générée (toggle + entitlement)");
  // B6 ne doit pas casser le sous-titre : il reste le contenu réellement envoyé.
  assert.equal(cardSubtitle(captured[0]), t.state.channel[0].payload.content);
  assert.equal(cardSubtitle(captured[0]), `Bienvenue <@${MEMBER_ID}> sur Serveur !`);
});

test("NON-RÉGRESSION Premium: un échec de génération de carte ne bloque ni le salon ni le DM (B1)", async () => {
  const t = transport();
  const cfg = config({ [Key.WELCOME_IMAGE_ENABLED]: true });

  await handleMemberAdded({
    member: adapted(),
    config: cfg,
    service: { get: async () => cfg },
    delivery: premiumDelivery({ failPipeline: true }),
    transport: t,
  });

  assert.equal(t.state.channel.length, 1, "le texte part malgré l'échec de la carte");
  assert.equal(t.state.channel[0].payload.files, undefined);
  assert.equal(t.state.dm.length, 1, "le DM part aussi");
});

test("NON-RÉGRESSION Premium: le toggle éteint ne consulte pas le backend d'entitlement", async () => {
  let entitlementCalls = 0;
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  const t = transport();
  const cfg = config({ [Key.WELCOME_IMAGE_ENABLED]: false });

  await handleMemberAdded({
    member: adapted(),
    config: cfg,
    service: { get: async () => cfg },
    delivery: new WelcomeDeliveryService({
      renderer: createWelcomeRenderer(),
      imagePipeline: { generate: async () => ({ buffer: Buffer.from("x") }) },
      templateRegistry: registry,
      entitlementService: { requireFeature: async () => { entitlementCalls += 1; return { ok: true, granted: true, code: EntitlementDecision.GRANTED }; } },
    }),
    transport: t,
  });

  assert.equal(entitlementCalls, 0, "image désactivée ⇒ aucun appel Premium");
  assert.equal(t.state.channel[0].payload.files, undefined);
});

test("NON-RÉGRESSION Premium: le Goodbye n'attache jamais de carte", async () => {
  const captured = [];
  const t = transport();
  const cfg = config({ [Key.WELCOME_IMAGE_ENABLED]: true });

  await handleMemberRemoved({
    member: adapted(),
    config: cfg,
    service: { get: async () => cfg },
    delivery: premiumDelivery({ captured }),
    transport: t,
  });

  assert.equal(t.state.channel.length, 1);
  assert.equal(t.state.channel[0].payload.files, undefined, "jamais de carte au départ");
  assert.equal(captured.length, 0);
});
