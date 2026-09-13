"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { LogsCategory, LogsCategoryChannelKey } = require("../configuration/logsCategories");
const { LogsComponentId: Id } = require("../configuration/logsConstants");
const { LogsEventMapper } = require("../services/LogsEventMapper");
const { LogsDeliveryService } = require("../services/LogsDeliveryService");
const { logsView, channelView } = require("../interactions/logsViews");
const {
  previewLogs,
  selectLogsChannel,
  disableLogsCategory,
} = require("../interactions/configureLogs");
const { createGuildSettingsRuntime } = require("../../../runtime/createGuildSettingsRuntime");

// ── 1 & 2 — Aperçu avec dépendances réellement injectées ───────────────────
test("preview uses injected mapper/delivery and delivers to the configured channel", async () => {
  const sent = [];
  const replies = [];
  const delivery = new LogsDeliveryService({ transport: { deliver: async (entry) => sent.push(entry) } });

  const result = await previewLogs({
    guildId: "g",
    t: (key) => key,
    service: { read: async () => ({ log_message_delete_channel_id: "123" }), update: async () => ({}) },
    mapper: new LogsEventMapper(),
    delivery,
    envelope: { transport: { reply: async (payload) => replies.push(payload) } },
  });

  assert.equal(result.delivered, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, "123");
  assert.equal(sent[0].channelKey, "log_message_delete_channel_id");
  assert.equal(replies.length, 1);
});

test("preview with no configured channel does not send and reports LOG_CHANNEL_NOT_CONFIGURED", async () => {
  const replies = [];
  let transportCalled = false;
  const delivery = new LogsDeliveryService({
    transport: { deliver: async () => { transportCalled = true; } },
  });

  const result = await previewLogs({
    guildId: "g",
    t: (key) => key,
    service: { read: async () => ({}) },
    mapper: new LogsEventMapper(),
    delivery,
    envelope: { transport: { reply: async (payload) => replies.push(payload) } },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.reason, "LOG_CHANNEL_NOT_CONFIGURED");
  assert.equal(transportCalled, false);
  assert.equal(replies.length, 1);
});

// ── 3, 4 & 10 — Vue principale : salon affiché / non configuré / partiel ──
test("logsView renders each configured channel as a mention", () => {
  const view = logsView({
    t: (key) => key,
    config: { logs_enabled: true, log_message_delete_channel_id: "123", log_member_join_channel_id: "456" },
  });
  assert.ok(view.content.includes("<#123>"), "configured messages channel must be rendered");
  assert.ok(view.content.includes("<#456>"), "configured members channel must be rendered");
  assert.ok(view.content.includes("logs.categoryMessages"));
  assert.ok(view.content.includes("logs.categoryMembers"));
});

test("logsView renders unconfigured categories as not-configured", () => {
  const view = logsView({ t: (key) => key, config: { logs_enabled: true } });
  assert.ok(view.content.includes("logs.notConfigured"));
  assert.ok(!view.content.includes("<#"), "no channel mention expected without configuration");
});

test("logsView does not crash with a partial configuration", () => {
  const view = logsView({
    t: (key) => key,
    config: { logs_enabled: true, log_role_update_channel_id: "789" },
  });
  assert.ok(view.content.includes("<#789>"));
  assert.ok(view.content.includes("logs.notConfigured"));
  assert.ok(view.components.length > 0);
});

test("channelView shows the current channel and an explicit disable action", () => {
  const view = channelView({
    t: (key) => key,
    category: LogsCategory.MESSAGES,
    config: { log_message_delete_channel_id: "123" },
  });
  assert.ok(view.content.includes("<#123>"));
  const ids = JSON.stringify(view.components);
  assert.ok(ids.includes(`${Id.CHANNEL_PREFIX}:${LogsCategory.MESSAGES}`));
  assert.ok(ids.includes(`${Id.DISABLE_PREFIX}:${LogsCategory.MESSAGES}`));
  assert.ok(ids.includes(Id.BACK));
});

// ── 5 & 6 — Sélection de salon et désactivation → null ─────────────────────
test("selectLogsChannel persists the chosen channel for the right key", async () => {
  const saved = [];
  const updated = [];
  await selectLogsChannel({
    guildId: "g",
    t: (key) => key,
    service: {
      update: async (_g, patch) => { saved.push(patch); return { ...patch }; },
    },
    envelope: {
      customId: `${Id.CHANNEL_PREFIX}:${LogsCategory.MEMBERS}`,
      values: ["chan-1"],
      transport: { update: async (payload) => updated.push(payload) },
    },
  });
  assert.deepEqual(saved[0], { log_member_join_channel_id: "chan-1" });
  assert.equal(updated.length, 1);
});

test("disableLogsCategory persists null for the right key", async () => {
  const saved = [];
  const updated = [];
  await disableLogsCategory({
    guildId: "g",
    t: (key) => key,
    service: {
      update: async (_g, patch) => { saved.push(patch); return { ...patch }; },
    },
    envelope: {
      customId: `${Id.DISABLE_PREFIX}:${LogsCategory.MODERATION}`,
      transport: { update: async (payload) => updated.push(payload) },
    },
  });
  assert.deepEqual(saved[0], { log_moderation_channel_id: null });
  assert.equal(updated.length, 1);
});

// ── 7 & 9 — Correspondance exacte des 8 catégories (invitations incluses) ──
test("the 8 log categories map to their exact guild config key", () => {
  const expected = {
    [LogsCategory.MESSAGES]: "log_message_delete_channel_id",
    [LogsCategory.MESSAGES_EDIT]: "log_message_edit_channel_id",
    [LogsCategory.MEMBERS]: "log_member_join_channel_id",
    [LogsCategory.MEMBERS_LEAVE]: "log_member_leave_channel_id",
    [LogsCategory.MODERATION]: "log_moderation_channel_id",
    [LogsCategory.ROLES]: "log_role_update_channel_id",
    [LogsCategory.CHANNELS]: "log_channel_update_channel_id",
    [LogsCategory.INVITATIONS]: "invitations_log_channel_id",
  };
  assert.equal(Object.keys(expected).length, 8);
  for (const [category, key] of Object.entries(expected)) {
    assert.equal(LogsCategoryChannelKey[category], key, `${category} → ${key}`);
  }
  assert.equal(Object.keys(LogsCategoryChannelKey).length, 8, "no category may be missing or extra");
});

test("invitations category is part of the logs view", () => {
  const view = logsView({
    t: (key) => key,
    config: { invitations_log_channel_id: "inv-chan" },
  });
  assert.ok(view.content.includes("logs.categoryInvitations"));
  assert.ok(view.content.includes("<#inv-chan>"));
});

// ── 8 — Persistance / relecture à travers la composition réelle ────────────
function legacyConfigService(seed = {}) {
  const config = { language: "fr", ...seed };
  return {
    getGuildConfig: async () => config,
    getGuildConfigState: async () => ({ config, available: true, found: true, source: "database" }),
    updateGuildConfig: async (_id, update) => Object.assign(config, update),
    invalidateCache: async () => {},
    _config: config,
  };
}

function base(interaction, captured) {
  return Object.assign(interaction, {
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    guildId: "g",
    channelId: "channel",
    locale: "fr",
    user: { id: "u" },
    member: { id: "u", permissions: { has: () => true }, roles: { cache: { has: () => false } } },
    reply: async (payload) => { captured.reply = payload; },
    followUp: async () => {},
    update: async (payload) => { captured.update = payload; },
  });
}

function button(customId, captured) { const i = base({}, captured); i.isButton = () => true; i.customId = customId; return i; }
function stringSelect(customId, values, captured) { const i = base({}, captured); i.isStringSelectMenu = () => true; i.customId = customId; i.values = values; return i; }
function channelSelect(customId, values, captured) { const i = base({}, captured); i.isChannelSelectMenu = () => true; i.customId = customId; i.values = values; return i; }

test("configured channel persists and is re-read when reopening the Logs section", async () => {
  const legacy = legacyConfigService();
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacy });

  // Ouvrir la section Logs.
  let captured = {};
  assert.equal(await runtime.tryHandle(button(Id.SECTION, captured)), true);

  // Choisir la catégorie « membres ».
  captured = {};
  assert.equal(await runtime.tryHandle(stringSelect(Id.CATEGORY, [LogsCategory.MEMBERS], captured)), true);

  // Choisir un salon pour « membres ».
  captured = {};
  assert.equal(await runtime.tryHandle(channelSelect(`${Id.CHANNEL_PREFIX}:${LogsCategory.MEMBERS}`, ["chan-42"], captured)), true);
  assert.equal(legacy._config.log_member_join_channel_id, "chan-42");

  // Ré-ouvrir la section Logs : le salon doit être relu depuis la config.
  captured = {};
  assert.equal(await runtime.tryHandle(button(Id.SECTION, captured)), true);
  assert.ok(captured.update.content.includes("<#chan-42>"), "configured channel must be re-read from persistence");
});

test("disabling a category through the runtime persists null and reflects in the view", async () => {
  const legacy = legacyConfigService({ log_moderation_channel_id: "mod-chan" });
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacy });

  let captured = {};
  assert.equal(await runtime.tryHandle(button(Id.SECTION, captured)), true);

  captured = {};
  assert.equal(await runtime.tryHandle(button(`${Id.DISABLE_PREFIX}:${LogsCategory.MODERATION}`, captured)), true);
  assert.equal(legacy._config.log_moderation_channel_id, null);
});

// ── 11 — Aperçu bout à bout à travers le runtime (wiring réel) ─────────────
// Ces tests cliquent réellement le bouton PREVIEW via le router, et non pas en
// appelant previewLogs() directement : ils prouvent que mapper/delivery
// injectés par registerLogs atteignent bien le handler (régression du crash
// "Cannot read properties of undefined (reading 'map')").
test("preview button through the runtime delivers a real test to the configured channel", async () => {
  const sent = [];
  const legacy = legacyConfigService({ logs_enabled: true, log_message_delete_channel_id: "123" });
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacy });
  const captured = {};
  const interaction = button(Id.PREVIEW, captured);
  // DiscordLogsTransport lit context.envelope.discordMember.guild.
  interaction.member.guild = {
    channels: { cache: { get: (id) => ({ isTextBased: () => true, send: async (m) => sent.push(m) }) } },
  };
  const handled = await runtime.tryHandle(interaction);
  assert.equal(handled, true);
  assert.equal(sent.length, 1, "the preview must actually send a test message");
  // Le t du runtime est le vrai i18n (locale fr) : le message de succès est
  // traduit, on vérifie donc la mention du salon, pas la clé brute.
  assert.ok(captured.reply.content.includes("<#123>"), "must report the sent channel");
});

test("preview button through the runtime with no channel does not send and does not crash", async () => {
  const legacy = legacyConfigService({ logs_enabled: true });
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacy });
  const captured = {};
  const interaction = button(Id.PREVIEW, captured);
  const handled = await runtime.tryHandle(interaction);
  assert.equal(handled, true);
  assert.ok(typeof captured.reply.content === "string" && captured.reply.content.length > 0, "must reply without crashing");
  assert.ok(!captured.reply.content.includes("<#"), "no channel mention when nothing is configured");
});

// ── 12 — Libellés d'accueil des 8 catégories (FR/EN) ───────────────────────
test("the 8 category display labels exist in both locales", () => {
  const fr = require("../translations/fr.json");
  const en = require("../translations/en.json");
  const { LogsCategoryLabelKey } = require("../configuration/logsCategories");
  assert.equal(Object.keys(LogsCategoryLabelKey).length, 8);
  for (const key of Object.values(LogsCategoryLabelKey)) {
    const [, name] = key.split(".");
    assert.equal(typeof fr.logs[name], "string", `${key} missing in fr.json`);
    assert.ok(fr.logs[name].length > 0, `${key} empty in fr.json`);
    assert.equal(typeof en.logs[name], "string", `${key} missing in en.json`);
    assert.ok(en.logs[name].length > 0, `${key} empty in en.json`);
  }
});

test("logsView lists the 8 categories with their display label", () => {
  const view = logsView({ t: (key) => key, config: { logs_enabled: true } });
  for (const labelKey of ["logs.categoryMessages", "logs.categoryMessagesEdit", "logs.categoryMembers", "logs.categoryMembersLeave", "logs.categoryModeration", "logs.categoryRoles", "logs.categoryChannels", "logs.categoryInvitations"]) {
    assert.ok(view.content.includes(labelKey), `main view missing ${labelKey}`);
  }
});
