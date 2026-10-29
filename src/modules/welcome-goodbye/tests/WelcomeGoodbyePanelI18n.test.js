"use strict";

// PHASE 2 (UI) — localisation du panneau Welcome/Goodbye et contrôle UI du
// toggle Welcome Image.
//
// Deux familles de tests :
//   1. le panneau rendu par le VRAI runtime (`createGuildSettingsRuntime`),
//      car le bug de localisation venait de la composition du runtime et non
//      des vues : tester les vues seules n'aurait rien détecté ;
//   2. `toggleWelcomeImage` en unitaire, avec un entitlement factice, pour
//      couvrir précisément l'activation, la désactivation et les refus Premium.
//
// Hors ligne : aucun accès Discord, Supabase ni backend Premium réel.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGuildSettingsRuntime } = require("../../../runtime/createGuildSettingsRuntime");
const { I18nService } = require("../../../core/i18n");
const { EntitlementDecision } = require("../../../core/entitlements");
const { toggleWelcomeImage } = require("../interactions/configureWelcomeImage");
const { welcomeView } = require("../interactions/welcomeGoodbyeViews");
const { WelcomeGoodbyeComponentId: Id, WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { toActionRows, MAX_ACTION_ROWS, MAX_BUTTONS_PER_ROW } = require("../../../adapters/discord/DiscordResponseTransport");
const { WelcomeDeliveryService } = require("../services/WelcomeDeliveryService");
const { createWelcomeRenderer } = require("../services/welcomePayload");

// Les vues produisent des styles nommés ("secondary"/"success") que le transport
// traduit ensuite en ButtonStyle numériques : on normalise pour comparer.
const STYLE_BY_NAME = Object.freeze({ primary: 1, secondary: 2, success: 3, danger: 4, link: 5 });

const welcomeFr = require("../translations/fr.json").welcomeGoodbye;
const welcomeEn = require("../translations/en.json").welcomeGoodbye;
const coreFr = require("../../../core/i18n/locales/fr.json");
const coreEn = require("../../../core/i18n/locales/en.json");

const dictionaries = { en: { ...coreEn, ...require("../translations/en.json") }, fr: { ...coreFr, ...require("../translations/fr.json") } };
const i18n = new I18nService({ dictionaries });
const tFr = i18n.forLocale("fr");
const tEn = i18n.forLocale("en");

// ─── doubles ────────────────────────────────────────────────────────────────

function legacyConfigService(config) {
  const writes = [];
  return {
    writes,
    getGuildConfig: async () => ({ ...config }),
    getGuildConfigState: async () => ({ config: { ...config }, available: true, found: true, source: "database" }),
    updateGuildConfig: async (_guildId, update) => { writes.push(update); Object.assign(config, update); return { ...config }; },
    invalidateCache: async () => {},
  };
}

function runtimeFor(config) {
  return createGuildSettingsRuntime({ legacyConfigService: legacyConfigService(config) });
}

function baseInteraction(interaction, captured) {
  return Object.assign(interaction, {
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    guildId: "g1",
    channelId: "channel",
    locale: "fr",
    user: { id: "u1" },
    member: { id: "u1", permissions: { has: () => true }, roles: { cache: { has: () => false } } },
    reply: async (payload) => { captured.reply = payload; },
    followUp: async () => {},
    update: async (payload) => { captured.update = payload; },
  });
}

function buttonInteraction(customId, captured, overrides = {}) {
  // NB : baseInteraction fait Object.assign(interaction, {...}) et écraserait un
  // isButton passé en premier argument — on le pose donc APRÈS.
  const interaction = baseInteraction({}, captured);
  interaction.isButton = () => true;
  interaction.customId = customId;
  return Object.assign(interaction, overrides);
}

/** Rend le panneau Welcome via le vrai runtime et renvoie le payload Discord. */
async function renderWelcomePanel(config, customId = Id.OPEN_WELCOME) {
  const captured = {};
  const handled = await runtimeFor(config).tryHandle(buttonInteraction(customId, captured));
  assert.equal(handled, true, "le bouton n'a pas été routé");
  const payload = captured.update || captured.reply;
  assert.ok(payload, "aucun payload rendu");
  return payload;
}

/** Tout le texte visible d'un payload : contenu de l'embed + libellés + placeholders. */
function visibleText(payload) {
  const parts = [];
  if (typeof payload.content === "string") parts.push(payload.content);
  for (const embed of payload.embeds || []) parts.push(embed.description || "", embed.title || "");
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node?.components) { walk(node.components); continue; }
      const data = node?.data ?? node;
      if (data?.label) parts.push(data.label);
      if (data?.placeholder) parts.push(data.placeholder);
      for (const option of data?.options || []) parts.push(option.label || "", option.description || "");
    }
  };
  walk(payload.components);
  return parts.join("\n");
}

function baseConfig(overrides = {}) {
  return {
    language: "fr",
    welcome_enabled: true,
    welcome_channel_id: "111111111111111111",
    welcome_message: "Bienvenue {mention}",
    welcome_embed_enabled: false,
    welcome_dm_enabled: false,
    welcome_image_enabled: false,
    goodbye_enabled: true,
    goodbye_channel_id: "222222222222222222",
    goodbye_message: "Au revoir {username}",
    goodbye_embed_enabled: false,
    ...overrides,
  };
}

/**
 * Transport conforme au contrat réel de WelcomeDeliveryService :
 * sendChannelMessage(channelId, payload) et sendDirectMessage(userId, payload).
 */
function deliveryTransport(sent) {
  return {
    async sendChannelMessage(_channelId, payload) { sent.push(payload); return { ok: true }; },
    async sendDirectMessage() { return { ok: true }; },
  };
}

/** Contexte minimal pour tester toggleWelcomeImage en unitaire. */
function toggleContext({ config, locale = "fr", entitlementService = null, writes = [] } = {}) {
  const state = { ...config };
  const replies = [];
  const updates = [];
  return {
    writes,
    guildId: "g1",
    userId: "u1",
    t: i18n.forLocale(locale),
    settings: {
      get: async () => ({ ...state }),
      update: async (_guildId, update) => { writes.push(update); Object.assign(state, update); return { ...state }; },
    },
    entitlementService,
    _state: state,
    envelope: {
      transport: {
        reply: async (payload) => { replies.push(payload); return payload; },
        update: async (payload) => { updates.push(payload); return payload; },
      },
    },
    _replies: replies,
    _updates: updates,
  };
}

function entitlement(decision) {
  let calls = 0;
  return {
    calls: () => calls,
    requireFeature: async () => {
      calls += 1;
      const granted = decision === EntitlementDecision.GRANTED;
      return { ok: true, granted, code: decision };
    },
  };
}

// ─── 1. panneau Welcome FR ──────────────────────────────────────────────────

test("panneau Welcome FR : titre, description et libellés sont en français", async () => {
  const text = visibleText(await renderWelcomePanel(baseConfig({ language: "fr" })));

  assert.ok(text.includes(welcomeFr.section), "titre de section FR absent");
  assert.ok(text.includes(welcomeFr.welcomeSection), "description FR absente");
  for (const key of ["disableWelcome", "welcomeMessage", "embedColor", "previewEmbed", "enableDm", "dmMessage", "testDm", "previewWelcomeImage", "testWelcome", "welcomeChannel", "selectTemplate", "back", "enableWelcomeImage"]) {
    assert.ok(text.includes(welcomeFr[key]), `libellé FR manquant : ${key} (« ${welcomeFr[key]} »)`);
  }
});

// ─── 2. panneau Welcome EN ──────────────────────────────────────────────────

test("panneau Welcome EN : les 15 textes signalés sont en anglais", async () => {
  const text = visibleText(await renderWelcomePanel(baseConfig({ language: "en" })));

  // Les chaînes exactement rapportées comme restées françaises.
  const expected = [
    "Welcome & Goodbye",
    "Welcome configuration: channel, message, embed, DM and card template.",
    "Disable Welcome",
    "Welcome Message",
    "Embed Color",
    "Preview Embed",
    "Enable Welcome DM",
    "DM Message",
    "Test Welcome DM",
    "Preview Welcome Image",
    "Test Welcome",
    "Select the Welcome channel",
    "Choose a Welcome card template",
    "Back",
  ];
  for (const value of expected) {
    assert.ok(text.includes(value), `texte EN absent du panneau : « ${value} »`);
  }
});

test("confirmation après bascule : localisée FR et EN", async () => {
  // « Welcome est activé. » / « Welcome is enabled. » n'apparaît qu'après une
  // action (welcomeUpdatedMessage), pas dans le panneau d'ouverture.
  for (const [locale, expected, forbidden] of [
    ["fr", welcomeFr.welcomeEnabled, welcomeEn.welcomeEnabled],
    ["en", welcomeEn.welcomeEnabled, welcomeFr.welcomeEnabled],
  ]) {
    const context = toggleContext({
      config: baseConfig({ language: locale, welcome_enabled: true, welcome_image_enabled: true }),
      locale,
      entitlementService: entitlement(EntitlementDecision.GRANTED),
    });
    // Désactivation du Welcome Image => refresh du panneau avec le message d'état.
    await toggleWelcomeImage(context);
    const content = context._updates[0].view.content;

    assert.ok(content.includes(expected), `confirmation « ${expected} » absente en ${locale}`);
    assert.equal(content.includes(forbidden), false, `texte de l'autre langue présent en ${locale}`);
  }
});

test("panneau Welcome EN : aucune chaîne française codée en dur ne subsiste", async () => {
  const text = visibleText(await renderWelcomePanel(baseConfig({ language: "en" })));

  // Toute valeur FR qui DIFFÈRE de son homologue EN doit être absente du rendu
  // EN. Les valeurs identiques dans les deux langues (ex. « 🟣 Violet ») sont
  // exclues pour éviter les faux positifs.
  const frenchOnly = Object.keys(welcomeFr).filter((key) => welcomeFr[key] !== welcomeEn[key]);
  assert.ok(frenchOnly.length > 50, "le jeu de clés FR/EN a changé, ce test doit être revu");

  for (const key of frenchOnly) {
    assert.equal(text.includes(welcomeFr[key]), false, `fuite française dans le rendu EN (${key}) : « ${welcomeFr[key]} »`);
  }
});

test("panneau Goodbye EN : localisé intégralement", async () => {
  const text = visibleText(await renderWelcomePanel(baseConfig({ language: "en" }), Id.OPEN_GOODBYE));

  assert.ok(text.includes(welcomeEn.goodbyeSection), "description Goodbye EN absente");
  for (const key of ["disableGoodbye", "goodbyeMessage", "goodbyeEmbedColor", "previewGoodbyeEmbed", "goodbyeChannel", "sameChannel", "previewGoodbye", "testGoodbye", "back"]) {
    assert.ok(text.includes(welcomeEn[key]), `libellé Goodbye EN manquant : ${key}`);
  }
  const frenchOnly = Object.keys(welcomeFr).filter((key) => welcomeFr[key] !== welcomeEn[key]);
  for (const key of frenchOnly) {
    assert.equal(text.includes(welcomeFr[key]), false, `fuite française dans le Goodbye EN (${key})`);
  }
});

// ─── 3. bascule FR → EN ─────────────────────────────────────────────────────

test("bascule FR → EN : le même panneau change intégralement de langue", async () => {
  const french = visibleText(await renderWelcomePanel(baseConfig({ language: "fr" })));
  const english = visibleText(await renderWelcomePanel(baseConfig({ language: "en" })));

  assert.notEqual(french, english, "les deux rendus sont identiques : la langue n'a aucun effet");

  const frenchOnly = Object.keys(welcomeFr).filter((key) => welcomeFr[key] !== welcomeEn[key]);
  for (const key of frenchOnly) {
    assert.equal(english.includes(welcomeFr[key]), false, `après bascule EN, « ${welcomeFr[key]} » subsiste (${key})`);
  }
  // Et l'inverse : le rendu FR ne doit pas contenir les textes EN spécifiques.
  const englishOnly = Object.keys(welcomeEn).filter((key) => welcomeEn[key] !== welcomeFr[key]);
  for (const key of englishOnly) {
    assert.equal(french.includes(welcomeEn[key]), false, `dans le rendu FR, « ${welcomeEn[key]} » apparaît (${key})`);
  }
});

test("une locale Discord EN ne force pas l'anglais quand la guilde est en FR", async () => {
  const captured = {};
  const runtime = runtimeFor(baseConfig({ language: "fr" }));
  await runtime.tryHandle(buttonInteraction(Id.OPEN_WELCOME, captured, { locale: "en-US" }));
  const text = visibleText(captured.update);

  assert.ok(text.includes(welcomeFr.welcomeSection), "la langue persistée de la guilde doit primer sur le client Discord");
  assert.equal(text.includes(welcomeEn.welcomeSection), false);
});

// ─── 4. isolation par guildId ───────────────────────────────────────────────

test("isolation guildId : deux serveurs, deux langues, aucun croisement", async () => {
  const guilds = {
    G_FR: baseConfig({ language: "fr" }),
    G_EN: baseConfig({ language: "en" }),
  };
  const services = Object.fromEntries(Object.entries(guilds).map(([id, cfg]) => [id, legacyConfigService(cfg)]));
  const runtime = createGuildSettingsRuntime({
    legacyConfigService: {
      getGuildConfig: async (guildId) => services[guildId].getGuildConfig(guildId),
      getGuildConfigState: async (guildId) => services[guildId].getGuildConfigState(guildId),
      updateGuildConfig: async (guildId, update) => services[guildId].updateGuildConfig(guildId, update),
      invalidateCache: async (guildId) => services[guildId].invalidateCache(guildId),
    },
  });

  const renders = {};
  for (const guildId of Object.keys(guilds)) {
    const captured = {};
    await runtime.tryHandle(buttonInteraction(Id.OPEN_WELCOME, captured, { guildId }));
    renders[guildId] = visibleText(captured.update);
  }

  assert.ok(renders.G_FR.includes(welcomeFr.welcomeSection), "G_FR doit être en français");
  assert.ok(renders.G_EN.includes(welcomeEn.welcomeSection), "G_EN doit être en anglais");
  assert.equal(renders.G_EN.includes(welcomeFr.welcomeSection), false, "le serveur EN affiche du français");
  assert.equal(renders.G_FR.includes(welcomeEn.welcomeSection), false, "le serveur FR affiche de l'anglais");
  assert.notEqual(renders.G_FR, renders.G_EN);
});

test("isolation guildId : basculer G_EN en français ne touche pas G_FR", async () => {
  const configs = { G_FR: baseConfig({ language: "fr" }), G_EN: baseConfig({ language: "en" }) };
  const services = Object.fromEntries(Object.entries(configs).map(([id, cfg]) => [id, legacyConfigService(cfg)]));
  const runtime = createGuildSettingsRuntime({
    legacyConfigService: {
      getGuildConfig: async (guildId) => services[guildId].getGuildConfig(guildId),
      getGuildConfigState: async (guildId) => services[guildId].getGuildConfigState(guildId),
      updateGuildConfig: async (guildId, update) => services[guildId].updateGuildConfig(guildId, update),
      invalidateCache: async () => {},
    },
  });

  await services.G_EN.updateGuildConfig("G_EN", { language: "fr" });

  const captured = {};
  await runtime.tryHandle(buttonInteraction(Id.OPEN_WELCOME, captured, { guildId: "G_FR" }));
  assert.ok(visibleText(captured.update).includes(welcomeFr.welcomeSection));
  assert.equal(services.G_FR.writes.length, 0, "aucune écriture ne doit viser G_FR");
});

// ─── 5. présence et état du toggle Welcome Image ────────────────────────────

function findComponent(payload, customId) {
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node?.components) {
        const found = walk(node.components);
        if (found) return found;
        continue;
      }
      const data = node?.data ?? node;
      if (data?.custom_id === customId) return data;
      if (data?.customId === customId) return { custom_id: data.customId, label: data.label, style: STYLE_BY_NAME[data.style] ?? data.style };
    }
    return null;
  };
  return walk(payload.components);
}

test("toggle Welcome Image présent et libellé « Activer » quand désactivée", async () => {
  const payload = await renderWelcomePanel(baseConfig({ language: "fr", welcome_image_enabled: false }));
  const toggle = findComponent(payload, Id.TOGGLE_WELCOME_IMAGE);

  assert.ok(toggle, "le toggle Welcome Image est absent du menu");
  assert.equal(toggle.label, "Activer Image Welcome");
  assert.equal(toggle.style, 2, "secondary attendu quand la fonctionnalité est éteinte");
});

test("toggle Welcome Image libellé « Désactiver » quand activée", async () => {
  const payload = await renderWelcomePanel(baseConfig({ language: "fr", welcome_image_enabled: true }));
  const toggle = findComponent(payload, Id.TOGGLE_WELCOME_IMAGE);

  assert.ok(toggle, "le toggle Welcome Image est absent du menu");
  assert.equal(toggle.label, "Désactiver Image Welcome");
  assert.equal(toggle.style, 3, "success attendu quand la fonctionnalité est allumée");
});

test("toggle Welcome Image traduit FR/EN", async () => {
  const fr = findComponent(await renderWelcomePanel(baseConfig({ language: "fr", welcome_image_enabled: true })), Id.TOGGLE_WELCOME_IMAGE);
  const en = findComponent(await renderWelcomePanel(baseConfig({ language: "en", welcome_image_enabled: true })), Id.TOGGLE_WELCOME_IMAGE);
  const frOff = findComponent(await renderWelcomePanel(baseConfig({ language: "fr", welcome_image_enabled: false })), Id.TOGGLE_WELCOME_IMAGE);
  const enOff = findComponent(await renderWelcomePanel(baseConfig({ language: "en", welcome_image_enabled: false })), Id.TOGGLE_WELCOME_IMAGE);

  assert.equal(fr.label, "Désactiver Image Welcome");
  assert.equal(en.label, "Disable Welcome Image");
  assert.equal(frOff.label, "Activer Image Welcome");
  assert.equal(enOff.label, "Enable Welcome Image");
});

test("la notice Premium du panneau est localisée et informe l'administrateur", async () => {
  const fr = visibleText(await renderWelcomePanel(baseConfig({ language: "fr" })));
  const en = visibleText(await renderWelcomePanel(baseConfig({ language: "en" })));

  assert.ok(fr.includes(welcomeFr.welcomeImagePremiumNotice), "notice Premium FR absente");
  assert.ok(en.includes(welcomeEn.welcomeImagePremiumNotice), "notice Premium EN absente");
  assert.equal(en.includes(welcomeFr.welcomeImagePremiumNotice), false);
});

test("la vue Welcome respecte toujours la limite Discord de 5 lignes avec le toggle", async () => {
  for (const welcomeImageEnabled of [false, true]) {
    const payload = await renderWelcomePanel(baseConfig({ welcome_image_enabled: welcomeImageEnabled }));
    const rows = payload.components || [];

    assert.ok(rows.length <= MAX_ACTION_ROWS, `${rows.length} lignes — au-dessus de la limite ${MAX_ACTION_ROWS}`);
    for (const row of rows) {
      assert.ok(row.components.length <= MAX_BUTTONS_PER_ROW, "une ligne dépasse 5 composants");
    }
    assert.equal(rows.length, MAX_ACTION_ROWS, "la vue doit occuper exactement 5 lignes, pas plus");
  }
});

test("aucun contrôle existant n'a disparu avec l'ajout du toggle", () => {
  const view = welcomeView({ t: tFr, config: baseConfig() });
  const ids = view.components.map((component) => component.customId);

  for (const id of [Id.TOGGLE_WELCOME, Id.WELCOME_CHANNEL, Id.WELCOME_MESSAGE, Id.TOGGLE_WELCOME_EMBED, Id.WELCOME_EMBED_COLOR, Id.PREVIEW_WELCOME_EMBED, Id.TOGGLE_WELCOME_DM, Id.WELCOME_DM_MESSAGE, Id.TEST_WELCOME_DM, Id.PREVIEW_WELCOME_IMAGE, Id.TEST_WELCOME, Id.TEMPLATE_SELECT, Id.SECTION]) {
    assert.ok(ids.includes(id), `contrôle perdu : ${id}`);
  }
  assert.equal(ids.filter((id) => id === Id.TOGGLE_WELCOME_IMAGE).length, 1, "le toggle doit apparaître exactement une fois");
  assert.equal(ids[ids.length - 1], Id.SECTION, "« Retour » doit rester le dernier contrôle");
  assert.ok(toActionRows(view.components).length <= MAX_ACTION_ROWS);
});

// ─── 6. activation / désactivation ──────────────────────────────────────────

test("activation avec entitlement accordé : écrit true et rafraîchit le panneau", async () => {
  const context = toggleContext({
    config: baseConfig({ welcome_image_enabled: false }),
    entitlementService: entitlement(EntitlementDecision.GRANTED),
  });

  const config = await toggleWelcomeImage(context);

  assert.deepEqual(context.writes, [{ [Key.WELCOME_IMAGE_ENABLED]: true }]);
  assert.equal(config[Key.WELCOME_IMAGE_ENABLED], true);
  assert.equal(context._updates.length, 1, "le panneau doit être rafraîchi");
  // updateWelcomeSettings appelle transport.update({ view }) : la vue contient
  // des composants « bruts » (pas encore des ActionRowBuilder).
  const toggle = findComponent(context._updates[0].view, Id.TOGGLE_WELCOME_IMAGE);
  assert.ok(toggle, "le toggle est absent du panneau rafraîchi");
  assert.equal(toggle.label, "Désactiver Image Welcome", "le libellé doit refléter le nouvel état");
});

test("désactivation : écrit false sans consulter le backend Premium", async () => {
  const service = entitlement(EntitlementDecision.PREMIUM_REQUIRED);
  const context = toggleContext({ config: baseConfig({ welcome_image_enabled: true }), entitlementService: service });

  const config = await toggleWelcomeImage(context);

  assert.deepEqual(context.writes, [{ [Key.WELCOME_IMAGE_ENABLED]: false }]);
  assert.equal(config[Key.WELCOME_IMAGE_ENABLED], false);
  assert.equal(service.calls(), 0, "éteindre la fonctionnalité ne doit jamais exiger le Premium");
  assert.equal(context._updates.length, 1);
});

test("aller-retour activation/désactivation : l'état réel est conservé", async () => {
  const config = baseConfig({ welcome_image_enabled: false });
  const context = toggleContext({ config, entitlementService: entitlement(EntitlementDecision.GRANTED) });

  await toggleWelcomeImage(context);
  assert.equal(context._state[Key.WELCOME_IMAGE_ENABLED], true, "l'état réel doit passer à true");

  await toggleWelcomeImage(context);
  assert.equal(context._state[Key.WELCOME_IMAGE_ENABLED], false, "l'état réel doit repasser à false");
  assert.deepEqual(context.writes.map((write) => write[Key.WELCOME_IMAGE_ENABLED]), [true, false]);
});

// ─── 7. refus Premium ───────────────────────────────────────────────────────

test("activation refusée (PREMIUM_REQUIRED) : aucune écriture, vue Premium affichée", async () => {
  const context = toggleContext({
    config: baseConfig({ welcome_image_enabled: false }),
    entitlementService: entitlement(EntitlementDecision.PREMIUM_REQUIRED),
  });

  const result = await toggleWelcomeImage(context);

  assert.deepEqual(context.writes, [], "rien ne doit être écrit sans entitlement");
  assert.equal(context._updates.length, 0, "le panneau ne doit pas être rafraîchi sur un refus");
  assert.equal(context._replies.length, 1, "une réponse Premium doit être envoyée");
  assert.equal(Key.WELCOME_IMAGE_ENABLED in (result || {}), false, "un refus ne renvoie pas une config");
});

test("backend Premium injoignable (UNAVAILABLE) : fail-closed, aucune écriture", async () => {
  const context = toggleContext({
    config: baseConfig({ welcome_image_enabled: false }),
    entitlementService: entitlement(EntitlementDecision.UNAVAILABLE),
  });

  await toggleWelcomeImage(context);

  assert.deepEqual(context.writes, [], "un backend injoignable ne doit jamais autoriser l'activation");
  assert.equal(context._replies.length, 1);
});

test("entitlementService absent : fail-closed UNAVAILABLE, aucune écriture", async () => {
  const context = toggleContext({ config: baseConfig({ welcome_image_enabled: false }), entitlementService: null });

  await toggleWelcomeImage(context);

  assert.deepEqual(context.writes, []);
  assert.equal(context._replies.length, 1);
});

test("les trois motifs Premium restent distingués (GRANTED / PREMIUM_REQUIRED / UNAVAILABLE)", async () => {
  const granted = entitlement(EntitlementDecision.GRANTED);
  const refused = entitlement(EntitlementDecision.PREMIUM_REQUIRED);
  const unavailable = entitlement(EntitlementDecision.UNAVAILABLE);

  const grantedContext = toggleContext({ config: baseConfig({ welcome_image_enabled: false }), entitlementService: granted });
  await toggleWelcomeImage(grantedContext);
  assert.equal(grantedContext.writes.length, 1, "GRANTED doit autoriser l'écriture");

  const refusedContext = toggleContext({ config: baseConfig({ welcome_image_enabled: false }), entitlementService: refused });
  await toggleWelcomeImage(refusedContext);
  const unavailableContext = toggleContext({ config: baseConfig({ welcome_image_enabled: false }), entitlementService: unavailable });
  await toggleWelcomeImage(unavailableContext);

  assert.equal(refusedContext.writes.length, 0);
  assert.equal(unavailableContext.writes.length, 0);
  assert.notEqual(refusedContext._replies[0].view.content, unavailableContext._replies[0].view.content,
    "« Premium requis » et « entitlement indisponible » doivent rester deux messages distincts");
});

test("valeur non booléenne de welcome_image_enabled : traitée comme désactivée (fail-closed)", async () => {
  for (const value of [undefined, null, "oui", 1, "true", {}]) {
    const context = toggleContext({
      config: { ...baseConfig(), [Key.WELCOME_IMAGE_ENABLED]: value },
      entitlementService: entitlement(EntitlementDecision.PREMIUM_REQUIRED),
    });

    await toggleWelcomeImage(context);

    assert.deepEqual(context.writes, [], `la valeur ${JSON.stringify(value)} a été traitée comme activée`);
    assert.equal(context._replies.length, 1, `la valeur ${JSON.stringify(value)} doit mener à un refus Premium`);
  }
});

test("le libellé du toggle suit l'état réel, y compris pour une valeur non booléenne", () => {
  for (const value of [undefined, null, "oui", 1]) {
    const view = welcomeView({ t: tFr, config: { ...baseConfig(), [Key.WELCOME_IMAGE_ENABLED]: value } });
    const toggle = view.components.find((component) => component.customId === Id.TOGGLE_WELCOME_IMAGE);
    assert.equal(toggle.label, "Activer Image Welcome", `la valeur ${JSON.stringify(value)} doit afficher « Activer »`);
  }
});

// ─── 8. non-régression de la logique Welcome Image existante ────────────────

test("NON-RÉGRESSION : toggle éteint ⇒ aucune carte générée à la livraison", async () => {
  let generated = 0;
  const delivery = new WelcomeDeliveryService({
    renderer: createWelcomeRenderer(),
    imagePipeline: { generate: async () => { generated += 1; return { buffer: Buffer.from("png") }; } },
    templateRegistry: { get: () => ({ id: "template-1", design: { width: 100, height: 100 } }) },
    entitlementService: { requireFeature: async () => ({ ok: true, granted: true, code: EntitlementDecision.GRANTED }) },
  });
  const sent = [];
  const transport = deliveryTransport(sent);
  const member = { guildId: "g1", userId: "u1", user: "@u", mention: "@u", username: "u", displayName: "U", server: "S", memberCount: 3, joinDate: "01/05/2024" };

  await delivery.welcome(member, { ...baseConfig(), welcome_image_enabled: false }, transport);

  assert.equal(generated, 0, "aucune carte ne doit être générée quand le toggle est éteint");
  assert.equal(sent.length, 1, "le texte doit être livré");
  assert.equal(sent[0].files, undefined, "aucune pièce jointe sans carte");
});

test("NON-RÉGRESSION : toggle allumé + entitlement accordé ⇒ carte générée", async () => {
  let generated = 0;
  const delivery = new WelcomeDeliveryService({
    renderer: createWelcomeRenderer(),
    imagePipeline: { generate: async () => { generated += 1; return { buffer: Buffer.from("png") }; } },
    templateRegistry: { get: () => ({ id: "template-1", design: { width: 100, height: 100 } }) },
    entitlementService: { requireFeature: async () => ({ ok: true, granted: true, code: EntitlementDecision.GRANTED }) },
  });
  const sent = [];
  const transport = deliveryTransport(sent);
  const member = { guildId: "g1", userId: "u1", user: "@u", mention: "@u", username: "u", displayName: "U", server: "S", memberCount: 3, joinDate: "01/05/2024" };

  await delivery.welcome(member, { ...baseConfig(), welcome_image_enabled: true }, transport);

  assert.equal(generated, 1, "la carte doit être générée");
  assert.ok(sent[0].files && sent[0].files.length === 1, "la carte doit être attachée au payload transporté");
  assert.equal(sent[0].files[0].name, "welcome-card.png");
});

test("NON-RÉGRESSION : toggle allumé + guilde Free ⇒ aucune carte, texte livré", async () => {
  let generated = 0;
  const delivery = new WelcomeDeliveryService({
    renderer: createWelcomeRenderer(),
    imagePipeline: { generate: async () => { generated += 1; return { buffer: Buffer.from("png") }; } },
    templateRegistry: { get: () => ({ id: "template-1", design: { width: 100, height: 100 } }) },
    entitlementService: { requireFeature: async () => ({ ok: true, granted: false, code: EntitlementDecision.PREMIUM_REQUIRED }) },
  });
  const sent = [];
  const transport = deliveryTransport(sent);
  const member = { guildId: "g1", userId: "u1", user: "@u", mention: "@u", username: "u", displayName: "U", server: "S", memberCount: 3, joinDate: "01/05/2024" };

  await delivery.welcome(member, { ...baseConfig(), welcome_image_enabled: true }, transport);

  assert.equal(generated, 0, "une guilde Free ne doit jamais obtenir la carte");
  assert.equal(sent.length, 1, "le texte reste livré");
  assert.equal(sent[0].files, undefined, "aucune pièce jointe pour une guilde Free");
});
