"use strict";

/**
 * PHASE 1 — routage des journaux.
 *
 * Chaque action doit arriver dans SON salon configuré, et uniquement dans
 * celui-là. Une catégorie ne doit jamais recevoir les logs d'une autre. Toute
 * configuration reste strictement liée au `guild_id`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createLogsRuntime } = require("../../src/modules/logs/runtime/createLogsRuntime");
const { LogsCategoryChannelKey } = require("../../src/modules/logs/configuration/logsCategories");

const CHANNELS = Object.freeze({
  messages: "CH_MESSAGES",
  edit: "CH_EDIT",
  join: "CH_JOIN",
  leave: "CH_LEAVE",
  moderation: "CH_MODERATION",
  roles: "CH_ROLES",
  channels: "CH_CHANNELS",
  invitations: "CH_INVITATIONS",
});

function makeConfig(guildId, overrides = {}) {
  return {
    guild_id: guildId,
    logs_enabled: true,
    language: "fr",
    log_message_delete_channel_id: CHANNELS.messages,
    log_message_edit_channel_id: CHANNELS.edit,
    log_member_join_channel_id: CHANNELS.join,
    log_member_leave_channel_id: CHANNELS.leave,
    log_moderation_channel_id: CHANNELS.moderation,
    log_role_update_channel_id: CHANNELS.roles,
    log_channel_update_channel_id: CHANNELS.channels,
    invitations_log_channel_id: CHANNELS.invitations,
    ...overrides,
  };
}

function makeHarness(configByGuild) {
  const sent = [];
  const cache = new Map();
  for (const channelId of Object.values(CHANNELS)) {
    cache.set(channelId, { id: channelId, isTextBased: () => true, send: async (payload) => { sent.push({ channelId, embed: payload.embeds[0].toJSON() }); return { id: "SENT" }; } });
  }
  const guildOf = (guildId) => ({ id: guildId, name: `Serveur ${guildId}`, memberCount: 10, channels: { cache } });
  const runtime = createLogsRuntime({ guildConfigResolver: { get: async (guildId) => configByGuild[guildId] || null } });
  return { runtime, sent, guildOf };
}

function member(guild, id, overrides = {}) {
  return {
    id,
    guild,
    user: { id, tag: `user_${id}`, bot: false, createdAt: new Date("2024-01-01"), displayAvatarURL: () => null },
    nickname: null,
    roles: { cache: new Map([["@everyone", { id: "@everyone" }]]) },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Chaque action → son salon
// ─────────────────────────────────────────────────────────────

const ROUTING_CASES = [
  { name: "message supprimé", expected: CHANNELS.messages, run: (h, guild, config) => h.runtime.handleMessageDeleted({ guild, id: "M1", channelId: "C1", channel: { id: "C1", name: "général" }, author: { id: "A", tag: "Alice", displayAvatarURL: () => null }, content: "bonjour" }) },
  { name: "message modifié", expected: CHANNELS.edit, run: (h, guild, config) => h.runtime.handleMessageUpdated({ guild, id: "M1", channelId: "C1", channel: { id: "C1", name: "général" }, author: { id: "A", tag: "Alice", displayAvatarURL: () => null }, content: "après" }, { content: "avant" }) },
  { name: "suppression en masse", expected: CHANNELS.messages, run: (h, guild, config) => h.runtime.handleMessageBulkDeleted({ size: 2, first: () => ({ guild, channel: { id: "C1", name: "général" } }), map: (fn) => [{ author: { id: "A", tag: "Alice" }, content: "x" }].map(fn) }, config) },
  { name: "arrivée d'un membre", expected: CHANNELS.join, run: (h, guild, config) => h.runtime.handleMemberJoined(member(guild, "U1")) },
  { name: "départ d'un membre", expected: CHANNELS.leave, run: (h, guild, config) => h.runtime.handleMemberLeft(member(guild, "U1")) },
  { name: "changement de pseudo", expected: CHANNELS.moderation, run: (h, guild, config) => h.runtime.handleMemberNicknameChanged({ oldMember: member(guild, "U1", { nickname: "a" }), newMember: member(guild, "U1", { nickname: "b" }), config }) },
  { name: "expulsion", expected: CHANNELS.moderation, run: (h, guild, config) => h.runtime.handleModerationEvent({ guild, config, action: "member_kicked", targetId: "U1", target: "<@U1>", moderator: null }) },
  { name: "bannissement", expected: CHANNELS.moderation, run: (h, guild, config) => h.runtime.handleModerationEvent({ guild, config, action: "member_banned", targetId: "U1", target: "<@U1>", moderator: null }) },
  { name: "timeout", expected: CHANNELS.moderation, run: (h, guild, config) => h.runtime.handleModerationEvent({ guild, config, action: "member_timed_out", targetId: "U1", target: "<@U1>", moderator: null }) },
  { name: "avertissement", expected: CHANNELS.moderation, run: (h, guild, config) => h.runtime.handleModerationEvent({ guild, config, action: "warn", targetId: "U1", target: "<@U1>", moderator: null }) },
  { name: "AutoMod", expected: CHANNELS.moderation, run: (h, guild, config) => h.runtime.handleModerationEvent({ guild, config, action: "automod", targetId: "U1", target: "<@U1>", rule: "R", reason: "r" }) },
  { name: "alerte raid", expected: CHANNELS.moderation, run: (h, guild, config) => h.runtime.handleModerationEvent({ guild, config, action: "security_raid", targetId: "U1", reason: "r", rule: "SECURITY_RAID" }) },
  { name: "ticket créé", expected: CHANNELS.moderation, run: (h, guild, config) => h.runtime.handleTicketEvent({ guild, config, action: "ticket_created", ticketChannelId: "T1", userId: "U1" }) },
  { name: "captcha vérifié", expected: CHANNELS.moderation, run: (h, guild, config) => h.runtime.handleCaptchaEvent({ guild, config, action: "captcha_verified", memberId: "U1", roleId: "R1" }) },
  { name: "rôle créé", expected: CHANNELS.roles, run: (h, guild, config) => h.runtime.handleRoleEvent({ guild, config, action: "role_created", roleId: "R1", target: "@Modo" }) },
  { name: "rôle modifié", expected: CHANNELS.roles, run: (h, guild, config) => h.runtime.handleRoleEvent({ guild, config, action: "role_updated", roleId: "R1", target: "@Modo", before: "a", after: "b" }) },
  { name: "rôle ajouté à un membre", expected: CHANNELS.roles, run: (h, guild, config) => h.runtime.handleRoleEvent({ guild, config, action: "member_role_added", roleId: "R1", memberId: "U1", target: "@Membre", member: "<@U1>" }) },
  { name: "salon créé", expected: CHANNELS.channels, run: (h, guild, config) => h.runtime.handleChannelEvent({ channel: { id: "C1", name: "général", guild, type: 0 }, config, action: "channel_created" }) },
  { name: "salon modifié", expected: CHANNELS.channels, run: (h, guild, config) => h.runtime.handleChannelEvent({ channel: { id: "C1", name: "général", guild, type: 0 }, config, action: "channel_updated", before: "a", after: "b" }) },
  { name: "fil créé", expected: CHANNELS.channels, run: (h, guild, config) => h.runtime.handleChannelEvent({ channel: { id: "T1", name: "sujet", guild, type: 11 }, config, action: "thread_created", parent: "#général" }) },
  { name: "invitation créée", expected: CHANNELS.invitations, run: (h, guild, config) => h.runtime.handleInviteEvent({ guild, config, action: "invite_created", inviteCode: "abc", inviter: "Alice (A1)" }) },
  { name: "invitation supprimée", expected: CHANNELS.invitations, run: (h, guild, config) => h.runtime.handleInviteEvent({ guild, config, action: "invite_deleted", inviteCode: "abc", inviter: "Alice (A1)" }) },
];

for (const testCase of ROUTING_CASES) {
  test(`PHASE1: ${testCase.name} → ${testCase.expected}`, async () => {
    const config = makeConfig("G1");
    const harness = makeHarness({ G1: config });
    const guild = harness.guildOf("G1");

    await testCase.run(harness, guild, config);

    assert.equal(harness.sent.length, 1, `un seul log émis, obtenu ${harness.sent.length}`);
    assert.equal(harness.sent[0].channelId, testCase.expected, `${testCase.name} mal routé`);
  });
}

// ─────────────────────────────────────────────────────────────
// Cohérence catégorie ↔ clé de salon
// ─────────────────────────────────────────────────────────────

test("PHASE1: la catégorie déclarée de chaque handler correspond à sa clé de salon", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const directory = "src/modules/logs/events";
  const keyByCategory = Object.fromEntries(Object.entries(LogsCategoryChannelKey).map(([category, key]) => [category, key]));

  const problems = [];
  for (const file of fs.readdirSync(directory)) {
    if (!file.startsWith("handle") || !file.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(directory, file), "utf8");
    const channelKey = /channelKey:\s*"([a-z_]+)"/.exec(source);
    const category = /category:\s*"([a-z_]+)"/.exec(source);
    if (!channelKey || !category) {
      problems.push(`${file}: channelKey ou catégorie absent`);
      continue;
    }
    const expectedKey = keyByCategory[category[1]];
    if (expectedKey !== channelKey[1]) {
      problems.push(`${file}: catégorie « ${category[1]} » attend « ${expectedKey} », code utilise « ${channelKey[1]} »`);
    }
  }
  assert.deepEqual(problems, [], problems.join(" | "));
});

test("PHASE1: chaque catégorie de logs a exactement une clé de salon distincte", () => {
  const keys = Object.values(LogsCategoryChannelKey);
  assert.equal(new Set(keys).size, keys.length, "deux catégories partagent une clé de salon");
});

// ─────────────────────────────────────────────────────────────
// Isolation par guild_id
// ─────────────────────────────────────────────────────────────

test("PHASE1: la configuration d'une guilde n'influence jamais une autre", async () => {
  const harness = makeHarness({
    "G-A": makeConfig("G-A"),
    "G-B": makeConfig("G-B", { log_moderation_channel_id: null, logs_enabled: true }),
  });

  await harness.runtime.handleModerationEvent({
    guild: harness.guildOf("G-A"),
    action: "member_kicked",
    targetId: "U1",
    target: "<@U1>",
    moderator: null,
  });
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].channelId, CHANNELS.moderation);

  // Guilde B : aucun salon de modération configuré → rien n'est livré ailleurs.
  const result = await harness.runtime.handleModerationEvent({
    guild: harness.guildOf("G-B"),
    action: "member_kicked",
    targetId: "U2",
    target: "<@U2>",
    moderator: null,
  });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "LOG_CHANNEL_NOT_CONFIGURED");
  assert.equal(harness.sent.length, 1, "aucun débordement vers le salon de la guilde A");
});

test("PHASE1: des logs désactivés sur une guilde n'éteignent pas une autre guilde", async () => {
  const harness = makeHarness({
    "G-OFF": makeConfig("G-OFF", { logs_enabled: false }),
    "G-ON": makeConfig("G-ON"),
  });

  const off = await harness.runtime.handleMemberLeft(member(harness.guildOf("G-OFF"), "U1"));
  assert.equal(off, null, "logs coupés : aucun traitement");
  assert.equal(harness.sent.length, 0);

  await harness.runtime.handleMemberLeft(member(harness.guildOf("G-ON"), "U2"));
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].channelId, CHANNELS.leave);
});

test("PHASE1: la langue est résolue par guilde, pas globalement", async () => {
  const harness = makeHarness({
    "G-FR": makeConfig("G-FR", { language: "fr" }),
    "G-EN": makeConfig("G-EN", { language: "en" }),
  });

  await harness.runtime.handleModerationEvent({ guild: harness.guildOf("G-FR"), action: "member_kicked", targetId: "U1", target: "<@U1>", moderator: null });
  await harness.runtime.handleModerationEvent({ guild: harness.guildOf("G-EN"), action: "member_kicked", targetId: "U2", target: "<@U2>", moderator: null });

  assert.equal(harness.sent.length, 2);
  assert.match(harness.sent[0].embed.title, /expulsé/i);
  assert.match(harness.sent[1].embed.title, /kick/i);
  // `moderator: null` → champ omis (aucune identité inventée) : on vérifie la
  // langue sur un champ toujours présent.
  assert.ok(harness.sent[0].embed.fields.some((field) => field.name === "👤 Membre"), "libellé FR");
  assert.ok(harness.sent[1].embed.fields.some((field) => field.name === "👤 Member"), "les champs suivent aussi la langue");
});
