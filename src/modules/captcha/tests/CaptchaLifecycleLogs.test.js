"use strict";

/**
 * P-CAPT L4 — journalisation du cycle de vie CAPTCHA.
 *
 * Trois événements UNIQUEMENT, émis par le code réel :
 *   • `captcha_provision_failed` — échec de réparation automatique ;
 *   • `captcha_panel_published`  — panneau publié ou régénéré ;
 *   • `captcha_force_existing`   — application de masse exécutée.
 *
 * Sont vérifiés ici : l'émission par les flux réels (join, startup,
 * force-existing, commande /captcha), le respect de la configuration
 * (`logs_enabled`, canal de modération), la parité FR/EN des titres, la
 * déduplication anti-spam, et le caractère JAMAIS fatal d'une panne de
 * journalisation. Le rendu (transport) est couvert par la suite PHASE 1.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { createCaptchaRuntime } = require("../runtime/createCaptchaRuntime");
const { CaptchaConfigKey: Key } = require("../configuration/captchaConstants");
const { activePanels } = require("../services/CaptchaPanelDeliveryService");
const { toggleForceExisting } = require("../interactions/configureCaptcha");
const {
  CAPTCHA_LOG_DEDUP_WINDOWS,
  logProvisionFailures,
  logPanelPublished,
  logForceExisting,
  resetCaptchaLifecycleLogDedup,
} = require("../runtime/captchaLifecycleLogs");
const { createLogsRuntime } = require("../../logs/runtime/createLogsRuntime");
const { unrecognizedDetailKeys } = require("../../../adapters/discord/DiscordLogsTransport");
const fr = require("../../logs/translations/fr.json");
const en = require("../../logs/translations/en.json");

const L4_ACTIONS = Object.freeze([
  "captcha_provision_failed",
  "captcha_panel_published",
  "captcha_force_existing",
]);

/** Faux runtime de journaux : capture les appels, ne touche à rien. */
function captureLogs({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    handleCaptchaEvent: async (payload) => {
      calls.push(payload);
      if (fail) throw new Error("log transport down");
      return { delivered: true };
    },
  };
}

function resetState() {
  resetCaptchaLifecycleLogDedup();
  activePanels.clear();
}

// ─────────────────────────────────────────────────────────────
// Join : échec de provisionnement et publication du panneau
// ─────────────────────────────────────────────────────────────

function joinHarness({ config = {}, roles = new Map(), logsRuntime = null, transportOverrides = {} } = {}) {
  let current = {
    [Key.ENABLED]: true,
    [Key.ROLE_ID]: "r-ver",
    [Key.CHANNEL_ID]: "c1",
    [Key.UNVERIFIED_ROLE_ID]: "r-unv",
    logs_enabled: true,
    ...config,
  };
  const calls = { sentPanels: [], updates: [] };
  const resolver = {
    get: async () => ({ ...current }),
    update: async (_g, patch) => { calls.updates.push(patch); current = { ...current, ...patch }; return { ...current }; },
  };
  const transport = {
    wrapMember: (m) => ({ id: m.id, roleIds: [...m.roles.cache.keys()], discordMember: m }),
    getRole: async (id) => roles.get(id) || null,
    createRole: async () => ({ id: "created-role" }),
    assignRole: async () => {},
    unassignRole: async () => {},
    ensureChannelControl: async () => ({ ok: true, changed: false }),
    createCaptchaChannel: async (name) => ({ id: `chan-${name}` }),
    sendPanel: async (channelId) => { calls.sentPanels.push(channelId); return { id: `panel-${calls.sentPanels.length}` }; },
    deletePanel: async () => {},
    sendReminder: async () => {},
    fetchMembers: async () => [],
    ...transportOverrides,
  };
  const runtime = createCaptchaRuntime({ guildConfigResolver: resolver, transportFactory: () => transport, logsRuntime });
  return { runtime, calls, config: () => ({ ...current }) };
}

function buildMember({ id = "m1", guildId = "g1", bot = false, roleIds = [] } = {}) {
  return {
    id,
    user: { bot, send: async () => {} },
    roles: { cache: new Map(roleIds.map((r) => [r, {}])) },
    guild: { id: guildId, preferredLocale: "fr" },
  };
}

test("L4 — un échec de provisionnement au join émet captcha_provision_failed avec l'élément, le code et le rôle", async () => {
  resetState();
  const logs = captureLogs();
  const h = joinHarness({
    logsRuntime: logs,
    config: { [Key.ROLE_ID]: null, [Key.PANEL_MESSAGE_ID]: "panel-existant" },
    transportOverrides: { getRole: async () => { throw new Error("Missing Permissions"); } },
  });

  await h.runtime.handleMemberJoined(buildMember());

  assert.equal(logs.calls.length, 1, "un seul événement émis");
  const [call] = logs.calls;
  assert.equal(call.action, "captcha_provision_failed");
  assert.equal(call.details.target, "unverifiedRole");
  assert.match(call.details.reason, /^captcha\.provision_role_failed: Missing Permissions$/);
  assert.equal(call.roleId, "r-unv", "le rôle concerné est celui configuré, jamais inventé");
  assert.equal(call.memberId, null, "aucun membre inventé");
  assert.equal(call.guild.id, "g1");
});

test("L4 — aucun échec de provisionnement n'émet aucun journal", async () => {
  resetState();
  const logs = captureLogs();
  const h = joinHarness({
    logsRuntime: logs,
    config: { [Key.PANEL_MESSAGE_ID]: "panel-existant" }, // panneau présent → pas de publication
    roles: new Map([["r-ver", { id: "r-ver" }], ["r-unv", { id: "r-unv" }]]),
  });

  await h.runtime.handleMemberJoined(buildMember());

  assert.deepEqual(logs.calls, [], "silence total quand tout est intact");
});

test("L4 — la publication d'un panneau au join est journalisée comme création", async () => {
  resetState();
  const logs = captureLogs();
  const h = joinHarness({
    logsRuntime: logs,
    config: { [Key.PANEL_MESSAGE_ID]: null },
    roles: new Map([["r-ver", { id: "r-ver" }], ["r-unv", { id: "r-unv" }]]),
  });

  await h.runtime.handleMemberJoined(buildMember());

  assert.equal(logs.calls.length, 1);
  const [call] = logs.calls;
  assert.equal(call.action, "captcha_panel_published");
  assert.equal(call.details.rule, "CAPTCHA_PANEL_CREATED");
  assert.equal(call.details.channel, "<#c1>");
  assert.equal(call.details.messageId, "panel-1");
  assert.equal(call.roleId, "r-ver", "le rôle distribué par le panneau accompagne le journal");
});

test("L4 — la réconciliation au démarrage distingue publication et régénération", async () => {
  resetState();
  const logs = captureLogs();
  const h = joinHarness({ logsRuntime: logs, roles: new Map([["r-ver", { id: "r-ver" }], ["r-unv", { id: "r-unv" }]]) });
  h.config().captcha_enabled = true;
  const client = { guilds: { cache: new Map([["g1", { id: "g1", preferredLocale: "fr" }]]) } };

  await h.runtime.reconcilePanelsOnStartup(client);
  await h.runtime.reconcilePanelsOnStartup(client);

  assert.equal(logs.calls.length, 2, "une publication, puis une régénération");
  assert.equal(logs.calls[0].details.rule, "CAPTCHA_PANEL_CREATED");
  assert.equal(logs.calls[1].details.rule, "CAPTCHA_PANEL_REGENERATED");
  assert.equal(logs.calls[1].details.messageId, "panel-2");
});

test("L4 — un delivery qui n'aboutit pas n'est jamais journalisé comme publication", async () => {
  resetState();
  const logs = captureLogs();

  const skipped = await logPanelPublished({ guild: { id: "g1" }, result: { delivered: false, reason: "captcha.channelMissing" }, logsRuntime: logs });
  assert.equal(skipped.emitted, false);
  assert.equal(skipped.reason, "not_delivered");
  assert.deepEqual(logs.calls, []);
});

test("L4 — des IDs de panneau non persistés sont signalés (jamais passés sous silence)", async () => {
  resetState();
  const logs = captureLogs();

  await logPanelPublished({
    guild: { id: "g1" },
    result: { delivered: true, regenerated: false, channelId: "c1", messageId: "m1", persisted: false, details: {} },
    logsRuntime: logs,
  });

  assert.equal(logs.calls.length, 1);
  assert.equal(logs.calls[0].details.reason, "captcha.panel_not_persisted");
});

// ─────────────────────────────────────────────────────────────
// Force-existing (action de masse)
// ─────────────────────────────────────────────────────────────

function forceHarness({ logsRuntime = null, guildId = "g1", config = {} } = {}) {
  let current = {
    [Key.ENABLED]: true,
    [Key.ROLE_ID]: "r-ver",
    [Key.CHANNEL_ID]: "c1",
    [Key.UNVERIFIED_ROLE_ID]: "r-unv",
    [Key.FORCE_EXISTING]: false,
    logs_enabled: true,
    ...config,
  };
  const membersCache = new Map([
    ["h1", { id: "h1", user: { bot: false }, roles: { cache: new Map(), add: async () => {} } }],
    ["b1", { id: "b1", user: { bot: true }, roles: { cache: new Map(), add: async () => {} } }],
  ]);
  const guild = {
    id: guildId,
    preferredLocale: "fr",
    roles: {
      everyone: { id: "everyone" },
      cache: new Map([["r-unv", { id: "r-unv", position: 1 }], ["r-ver", { id: "r-ver", position: 1 }]]),
      create: async () => { throw new Error("Missing Access"); },
    },
    members: { me: { roles: { highest: { position: 10 } } }, fetch: async () => membersCache },
    channels: {
      cache: new Map([["c1", {
        id: "c1",
        isTextBased: () => true,
        permissionOverwrites: { cache: new Map([["everyone", { deny: { has: () => true } }]]), has: () => true },
      }]]),
    },
  };
  const replies = [];
  const context = {
    guildId,
    userId: "admin-1",
    logsRuntime,
    t: (key) => key,
    service: {
      read: async () => ({ ...current }),
      update: async (_g, patch) => { current = { ...current, ...patch }; return { ...current }; },
    },
    envelope: {
      discordMember: { guild },
      transport: { reply: async (payload) => { replies.push(payload); }, update: async () => {} },
    },
  };
  return { context, replies, config: () => ({ ...current }) };
}

test("L4 — force-existing journalise l'action réellement exécutée, avec son acteur et son résumé", async () => {
  resetState();
  const logs = captureLogs();
  const h = forceHarness({ logsRuntime: logs });

  const result = await toggleForceExisting(h.context);

  assert.equal(result.updated, true, "l'action reste exécutée");
  assert.equal(logs.calls.length, 1);
  const [call] = logs.calls;
  assert.equal(call.action, "captcha_force_existing");
  assert.equal(call.details.rule, "CAPTCHA_FORCE_EXISTING");
  assert.equal(call.details.moderatorId, "admin-1");
  assert.match(call.details.reason, /^Applied 1\/2 — failed 0$/);
});

test("L4 — une bascule de désactivation n'est jamais journalisée comme action de masse", async () => {
  resetState();
  const logs = captureLogs();
  const h = forceHarness({ logsRuntime: logs });
  h.context.service.read = async () => ({ ...h.config(), [Key.FORCE_EXISTING]: true });

  const result = await toggleForceExisting(h.context);

  assert.equal(result, null, "simple bascule ON → OFF");
  assert.deepEqual(logs.calls, []);
});

test("L4 — les échecs de l'opération de masse sont journalisés avant tout retour anticipé", async () => {
  resetState();
  const logs = captureLogs();
  // Rôle non vérifié configuré mais introuvable ET recréation impossible.
  const h = forceHarness({ logsRuntime: logs, config: { [Key.UNVERIFIED_ROLE_ID]: "r-disparu" } });

  const result = await toggleForceExisting(h.context);

  assert.equal(result, null, "opération refusée : rien n'est appliqué");
  assert.equal(logs.calls.length, 1);
  assert.equal(logs.calls[0].action, "captcha_provision_failed");
  assert.equal(logs.calls[0].details.target, "unverifiedRole");
});

// ─────────────────────────────────────────────────────────────
// Anti-spam (déduplication)
// ─────────────────────────────────────────────────────────────

test("L4 — un même échec n'est pas répété dans la fenêtre, mais l'est après", async () => {
  resetState();
  const logs = captureLogs();
  const base = Date.parse("2026-10-13T10:00:00.000Z");
  const results = { failed: [{ element: "unverifiedRole", state: "failed", code: "captcha.provision_role_failed", error: "boom" }] };
  const once = (now) => logProvisionFailures({ guild: { id: "g-dedup" }, results, logsRuntime: logs, now });

  await once(base);
  await once(base + 1000);
  assert.equal(logs.calls.length, 1, "rafale absorbée");

  await once(base + CAPTCHA_LOG_DEDUP_WINDOWS.captcha_provision_failed + 1);
  assert.equal(logs.calls.length, 2, "un échec durable reste visible");
});

test("L4 — une clé de déduplication différente reste journalisée (jamais d'étouffement global)", async () => {
  resetState();
  const logs = captureLogs();
  const base = Date.parse("2026-10-13T10:00:00.000Z");
  const failures = [
    { element: "unverifiedRole", state: "failed", code: "captcha.provision_role_failed" },
    { element: "channel", state: "failed", code: "captcha.provision_channel_failed" },
    { element: "channel", state: "failed", code: "captcha.provision_channel_permissions_failed" },
  ];

  await logProvisionFailures({ guild: { id: "g-distinct" }, config: { captcha_channel_id: "c9" }, results: { failed: failures }, logsRuntime: logs, now: base });

  assert.equal(logs.calls.length, 3, "chaque élément/code a son propre journal");
  assert.equal(logs.calls[1].details.channelId, "<#c9>");
  assert.equal(logs.calls[2].details.reason, "captcha.provision_channel_permissions_failed");
});

test("L4 — deux joins successifs en échec n'inondent pas le canal de modération", async () => {
  resetState();
  const logs = captureLogs();
  const h = joinHarness({
    logsRuntime: logs,
    config: { [Key.ROLE_ID]: null, [Key.PANEL_MESSAGE_ID]: "panel-existant" },
    transportOverrides: { getRole: async () => { throw new Error("Missing Permissions"); } },
  });

  await h.runtime.handleMemberJoined(buildMember({ id: "m1" }));
  await h.runtime.handleMemberJoined(buildMember({ id: "m2" }));

  assert.equal(logs.calls.length, 1, "le même échec n'est journalisé qu'une fois");
});

// ─────────────────────────────────────────────────────────────
// Robustesse : une panne de journalisation n'interrompt rien
// ─────────────────────────────────────────────────────────────

test("L4 — un runtime de journaux en panne ne casse ni le join ni le force-existing", async () => {
  resetState();
  const logs = captureLogs({ fail: true });
  const h = joinHarness({
    logsRuntime: logs,
    config: { [Key.PANEL_MESSAGE_ID]: null },
    roles: new Map([["r-ver", { id: "r-ver" }], ["r-unv", { id: "r-unv" }]]),
  });

  const joined = await h.runtime.handleMemberJoined(buildMember());
  assert.equal(joined.sent, true, "le flux CAPTCHA continue malgré la panne de journalisation");
  assert.ok(h.config()[Key.PANEL_MESSAGE_ID], "le panneau reste publié et persisté");

  const logs2 = captureLogs({ fail: true });
  const f = forceHarness({ logsRuntime: logs2, guildId: "g-fail" });
  const result = await toggleForceExisting(f.context);
  assert.equal(result.updated, true, "l'action de masse aboutit malgré la panne");
  assert.equal(f.config()[Key.FORCE_EXISTING], true);
});

test("L4 — sans runtime de journaux exploitable, l'émission est refusée proprement (jamais d'exception)", async () => {
  resetState();
  const outcome = await logForceExisting({
    guild: { id: "g-none" },
    moderatorId: "admin-1",
    stats: { applied: 1, processed: 1, failed: 0 },
    logsRuntime: { handleCaptchaEvent: null },
  });
  assert.deepEqual(outcome, { emitted: false, reason: "logs_unavailable" });

  const noGuild = await logForceExisting({ guild: null, moderatorId: "a", stats: {}, logsRuntime: captureLogs() });
  assert.deepEqual(noGuild, { emitted: false, reason: "guild_unavailable" });
});

// ─────────────────────────────────────────────────────────────
// Chaîne complète : pont → runtime de journaux → transport
// ─────────────────────────────────────────────────────────────

function realLogsHarness() {
  const sent = [];
  const channel = { id: "CH-MOD", isTextBased: () => true, send: async (payload) => { sent.push(payload.embeds[0].toJSON()); return { id: "SENT" }; } };
  const guild = { id: "g-real", name: "Serveur", memberCount: 3, channels: { cache: new Map([["CH-MOD", channel]]) } };
  const config = { guild_id: "g-real", logs_enabled: true, language: "fr", log_moderation_channel_id: "CH-MOD" };
  const runtime = createLogsRuntime({ guildConfigResolver: { get: async () => config } });
  return { sent, guild, runtime, config };
}

test("L4 — chaîne réelle : le transport reçoit un embed traduit, sans aucun nom de champ technique", async () => {
  resetState();
  const h = realLogsHarness();

  await logProvisionFailures({
    guild: h.guild,
    config: { ...h.config, captcha_unverified_role_id: "r-unv" },
    results: { failed: [{ element: "unverifiedRole", state: "failed", code: "captcha.provision_role_failed", error: "Missing Permissions" }] },
    logsRuntime: h.runtime,
  });
  await logForceExisting({ guild: h.guild, moderatorId: "admin-1", stats: { applied: 2, processed: 5, failed: 1 }, logsRuntime: h.runtime });
  await logPanelPublished({
    guild: h.guild,
    result: { delivered: true, regenerated: true, channelId: "c1", messageId: "m2", persisted: true, details: { roleId: "r-unv" } },
    logsRuntime: h.runtime,
  });

  assert.equal(h.sent.length, 3, "les trois événements arrivent dans le canal de modération");
  assert.match(h.sent[0].title, /Provisionnement CAPTCHA en échec/);
  assert.match(h.sent[1].title, /CAPTCHA appliqué aux membres existants/);
  assert.match(h.sent[2].title, /Panneau CAPTCHA publié/);

  const knownLabels = new Set([
    ...Object.values(require("../../../adapters/discord/DiscordLogsTransport").LABELS.fr),
    ...Object.values(require("../../../adapters/discord/DiscordLogsTransport").LABELS.en),
  ]);
  for (const embed of h.sent) {
    assert.ok(embed.fields.length > 0, "jamais d'embed vide");
    for (const field of embed.fields) {
      assert.ok(knownLabels.has(field.name), `nom de champ hors table : « ${field.name} »`);
    }
    assert.equal(/^(captcha|logs)\./.test(embed.title), false, "titre jamais une clé technique");
  }
  assert.ok(h.sent[0].fields.some((f) => f.name === "🎯 Cible"), "la cible est libellée");
  assert.ok(h.sent[2].fields.some((f) => f.name === "📏 Règle" && /REGENERATED/.test(f.value)), "régénération signalée");
});

test("L4 — chaque champ émis est reconnu par le transport (aucun détail silencieusement écarté)", async () => {
  resetState();
  const logs = captureLogs();
  await logProvisionFailures({
    guild: { id: "g-keys" },
    config: { captcha_channel_id: "c1" },
    results: { failed: [{ element: "channel", state: "failed", code: "captcha.provision_channel_failed", error: "nope" }] },
    logsRuntime: logs,
  });
  await logPanelPublished({ guild: { id: "g-keys" }, result: { delivered: true, channelId: "c1", messageId: "m1", details: { roleId: "r1" } }, logsRuntime: logs });
  await logForceExisting({ guild: { id: "g-keys" }, moderatorId: "admin-1", stats: { applied: 1, processed: 1, failed: 0 }, logsRuntime: logs });

  assert.equal(logs.calls.length, 3);
  for (const call of logs.calls) {
    const details = { ...call.details };
    if (call.roleId) details.roleId = call.roleId;
    if (call.memberId) details.memberId = call.memberId;
    const unrecognized = unrecognizedDetailKeys({ action: call.action, details });
    assert.deepEqual(unrecognized, [], `${call.action}: clés non rendues → ${unrecognized.join(", ")}`);
    assert.ok(L4_ACTIONS.includes(call.action), `${call.action} hors périmètre L4`);
  }
});

test("L4 — les trois événements respectent logs_enabled et la langue de la guilde", async () => {
  resetState();
  const logsDisabled = createLogsRuntime({ guildConfigResolver: { get: async () => ({ guild_id: "g-off", logs_enabled: false }) } });
  const off = await logProvisionFailures({ guild: { id: "g-off" }, results: { failed: [{ element: "config", state: "failed", code: "captcha.provision_config_read_failed" }] }, logsRuntime: logsDisabled });
  assert.equal(off[0].emitted, false, "logs coupés : rien n'est envoyé");
  assert.equal(off[0].reason, "logs_disabled");

  // Salon de modération absent ⇒ aucun envoi, et l'appelant le sait.
  const logsNoChannel = createLogsRuntime({ guildConfigResolver: { get: async () => ({ guild_id: "g-nochan", logs_enabled: true }) } });
  const noChannel = await logForceExisting({ guild: { id: "g-nochan" }, moderatorId: "admin-2", stats: {}, logsRuntime: logsNoChannel });
  assert.equal(noChannel.emitted, false);
  assert.equal(noChannel.reason, "not_delivered");

  const sent = [];
  const channel = { id: "CH-MOD", isTextBased: () => true, send: async (payload) => { sent.push(payload.embeds[0].toJSON()); return { id: "SENT" }; } };
  const guild = { id: "g-en", channels: { cache: new Map([["CH-MOD", channel]]) } };
  const logsEn = createLogsRuntime({ guildConfigResolver: { get: async () => ({ guild_id: "g-en", logs_enabled: true, language: "en", log_moderation_channel_id: "CH-MOD" }) } });

  await logForceExisting({ guild, moderatorId: "admin-1", stats: { applied: 1, processed: 1, failed: 0 }, logsRuntime: logsEn });

  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /CAPTCHA applied to existing members/);
  assert.ok(sent[0].fields.some((f) => f.name === "🛡️ Moderator"), "libellés EN");
});

// ─────────────────────────────────────────────────────────────
// Parité FR/EN et câblage de la commande
// ─────────────────────────────────────────────────────────────

test("L4 — les trois titres existent en FR et EN (sinon titre de secours générique)", () => {
  const problems = [];
  for (const action of L4_ACTIONS) {
    if (typeof fr.logs[action] !== "string" || !fr.logs[action].trim()) problems.push(`fr.logs.${action}`);
    if (typeof en.logs[action] !== "string" || !en.logs[action].trim()) problems.push(`en.logs.${action}`);
    if (fr.logs[action] === en.logs[action]) problems.push(`${action}: FR et EN identiques`);
  }
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(fr.logs).sort(), Object.keys(en.logs).sort(), "parité stricte des clés logs");
});

test("L4 — /captcha panel publie via le pont de journaux (aucun envoi parallèle)", () => {
  const source = fs.readFileSync("src/commands/captcha.js", "utf8");
  assert.match(source, /logPanelPublished/);
  assert.match(source, /if \(result\.delivered\) await logPanelPublished/);
});

test("L4 — aucun quatrième événement CAPTCHA n'est journalisé", () => {
  const source = fs.readFileSync("src/modules/captcha/runtime/captchaLifecycleLogs.js", "utf8");
  const actions = [...source.matchAll(/action:\s*"(captcha_[a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(actions)].sort(), [...L4_ACTIONS].sort());
});
