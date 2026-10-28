"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ChannelModerationService } = require("../services/ChannelModerationService");
const { ChannelLockService } = require("../services/ChannelLockService");
const { NicknameService } = require("../services/NicknameService");
const { DiscordModerationTransport } = require("../../../adapters/discord/DiscordModerationTransport");
const { registerChannelModeration } = require("../channelRegister");
const { InteractionRegistry, InteractionRouter, InteractionKind } = require("../../../core/interactions");
const { PermissionService } = require("../../../core/permissions");
const { I18nService } = require("../../../core/i18n");
const dictionaries = { fr: require("../translations/fr.json"), en: require("../translations/en.json") };
function fixture({ initial = { ViewChannel: true, AttachFiles: false }, messages = [] } = {}) {
  const f = { api: [], replies: [], logs: 0, errors: 0, reads: 0, messages, initial };
  const guild = { id: "g", ownerId: "owner", members: {} };
  const member = (id, position) => ({ id, guild, user: { bot: false }, roles: { highest: { position } }, permissions: { has: () => true } });
  const actor = member("actor", 5), bot = member("civrat", 10), target = member("u", 1);
  guild.members.me = bot;
  guild.members.fetch = async () => { f.reads++; if (f.readError) throw f.readError; return f.missing ? null : target; };
  Object.assign(target, { manageable: true, setNickname: async value => { f.api.push(["nickname", value]); if (f.apiError) throw f.apiError; target.nickname = value; } });
  // Stateful overwrite endpoint double: edits merge only the supplied bit.
  // SDK implementation was inspected separately; this is not a live SDK test.
  const overwrites = new Map([["g", { ...initial }], ["role", { SendMessages: true, ViewChannel: true }], ["user", { SendMessages: false }]]);
  const channel = {
    guildId: "g",
    permissionsFor: m => ({ has: p => !(m.id === actor.id ? f.actorDenied : f.botDenied)?.includes(p) }),
    bulkDelete: async (count, filterOld) => {
      f.api.push(["purge", count, filterOld]); if (f.apiError) throw f.apiError;
      if (f.malformedCollection) return { size: "not confirmed" };
      const selected = f.messages.slice(0, count).filter(m => !filterOld || !m.old);
      return new Map(selected.map((m, i) => [String(i), m]));
    },
    setRateLimitPerUser: async seconds => { f.api.push(["slowmode", seconds]); if (f.apiError) throw f.apiError; channel.rateLimitPerUser = seconds; },
    permissionOverwrites: {
      edit: async (id, patch) => {
        f.api.push(["overwrite", id, { ...patch }]); if (f.apiError) throw f.apiError;
        const next = { ...overwrites.get(id) };
        for (const [key, value] of Object.entries(patch)) { if (value === null) delete next[key]; else next[key] = value; }
        overwrites.set(id, next);
      },
    },
  };
  return Object.assign(f, { actor, bot, guild, target, channel, overwrites, transport: new DiscordModerationTransport({ guild, actor }) });
}
function runtime(f, name, { locale = "fr", count = 1, seconds = 0, nickname = "New", user = { id: "u" }, guildId = "g" } = {}) {
  const registry = new InteractionRegistry();
  registerChannelModeration({ registry, logsRuntimeFactory: () => { f.logs++; throw Error("command must not emit logs"); } });
  const router = new InteractionRouter({ registry, contextFactory: { create: async envelope => ({ guildId, envelope, member: { has: () => true, hasInChannel: () => true }, permissions: new PermissionService(), t: new I18nService({ dictionaries }).forLocale(locale), respondError: async () => { f.errors++; } }) } });
  const envelope = { kind: InteractionKind.COMMAND, name, discordMember: f.actor, discordChannel: f.channel,
    options: { getInteger: option => option === "count" ? count : seconds, getString: () => nickname, getUser: () => user },
    transport: { reply: async payload => f.replies.push(payload) } };
  return { router, envelope, registry };
}
async function run(f, name, options) { const { router, envelope } = runtime(f, name, options); return router.handle(envelope); }
const recent = n => Array.from({ length: n }, () => ({ old: false }));
for (const [label, count, messages, deleted, code] of [
  ["complete", 3, recent(3), 3, "PURGE_SUCCESS"],
  ["single", 1, recent(1), 1, "PURGE_SUCCESS"],
  ["maximum", 100, recent(100), 100, "PURGE_SUCCESS"],
  ["partial due to available stock", 5, recent(2), 2, "PURGE_PARTIAL"],
  ["partial with old messages", 4, [...recent(2), { old: true }, { old: true }], 2, "PURGE_PARTIAL"],
  ["empty channel", 5, [], 0, "PURGE_NONE"],
  ["only old messages", 2, [{ old: true }, { old: true }], 0, "PURGE_NONE"],
]) for (const locale of ["fr", "en"]) test(`purge ${label}, ${locale}: actual counts and single reply`, async () => {
  const f = fixture({ messages }); const result = await run(f, "supprimer", { count, locale });
  assert.equal(result.code, code); assert.equal(result.ok, deleted > 0); assert.equal(result.count, deleted); assert.equal(result.requestedCount, count);
  assert.deepEqual(f.api, [["purge", count, true]]); assert.equal(f.replies.length, 1); assert.equal(f.replies[0].ephemeral, true);
  const view = f.replies[0].view;
  assert.equal(view.content, dictionaries[locale].moderation[code]);
  assert.deepEqual(view.embed.fields, [
    { name: dictionaries[locale].moderation.purgeRequested, value: String(count), inline: true },
    { name: dictionaries[locale].moderation.purgeDeleted, value: String(deleted), inline: true },
  ]);
  assert.equal(f.errors, 0); assert.equal(f.logs, 0);
});
for (const count of [0, -1, 101, 1.2, "5", null, undefined, NaN, Infinity]) test(`purge invalid count ${count}: no API call`, async () => {
  const f = fixture(); const service = new ChannelModerationService();
  const r = await service.purge({ guildId: "g", count, transport: { bulkDelete: async () => { throw Error("must not be invoked"); } } });
  assert.equal(r.code, "PURGE_INVALID_COUNT"); assert.equal(r.ok, false); assert.equal("count" in r, false); assert.equal(f.api.length, 0);
});
for (const deleted of [undefined, null, -1, 4, 1.5, "2", NaN, Infinity, {}]) test(`purge inconsistent return ${deleted}: never invents deleted count`, async () => {
  const result = await new ChannelModerationService().purge({ guildId: "g", count: 3, transport: { bulkDelete: async () => deleted } });
  assert.equal(result.ok, false); assert.equal(result.code, "PURGE_UNCONFIRMED"); assert.equal("count" in result, false); assert.equal(result.requestedCount, 3);
});
test("purge malformed collection and timeout do not announce requested count as deleted", async () => {
  for (const apiError of [null, { code: "ETIMEDOUT" }]) {
    const f = fixture(); f.malformedCollection = !apiError; f.apiError = apiError;
    const result = await run(f, "supprimer", { count: 10 });
    assert.equal(result.code, apiError ? "PURGE_UNAVAILABLE" : "PURGE_UNCONFIRMED"); assert.equal(result.ok, false);
    assert.equal("count" in result, false); assert.equal(f.replies[0].view.embed, undefined); assert.equal(f.api.length, 1); assert.equal(f.replies.length, 1);
  }
});
for (const seconds of [0, 1, 21600]) test(`slowmode boundary ${seconds}`, async () => {
  const f = fixture(); const r = await run(f, "slowmode", { seconds });
  assert.equal(r.ok, true); assert.equal(r.seconds, seconds); assert.equal(f.channel.rateLimitPerUser, seconds); assert.deepEqual(f.api, [["slowmode", seconds]]); assert.equal(f.replies.length, 1); assert.equal(f.logs, 0);
});
for (const seconds of [-1, 21601, 0.5, "10", null, NaN, Infinity]) test(`slowmode rejects ${seconds}, no default/coercion`, async () => {
  const f = fixture(); const r = await run(f, "slowmode", { seconds });
  assert.equal(r.code, "SLOWMODE_INVALID_SECONDS"); assert.equal(f.api.length, 0); assert.equal(f.replies.length, 1);
});
for (const initialBit of [true, false, undefined]) test(`lock V1 preserves unrelated bits and overwrites, initial SendMessages=${initialBit}`, async () => {
  const initial = { ViewChannel: false, AttachFiles: true, ManageMessages: false };
  if (initialBit !== undefined) initial.SendMessages = initialBit;
  const f = fixture({ initial }); const otherRole = f.overwrites.get("role"), otherUser = f.overwrites.get("user");
  for (let i = 0; i < 2; i++) {
    assert.equal((await run(f, "verrouiller")).code, "LOCK_SUCCESS");
    assert.deepEqual(f.overwrites.get("g"), { ...initial, SendMessages: false });
  }
  const expected = { ...initial }; delete expected.SendMessages;
  for (let i = 0; i < 2; i++) {
    assert.equal((await run(f, "deverrouiller")).code, "UNLOCK_SUCCESS");
    assert.deepEqual(f.overwrites.get("g"), expected); // even initial true is NOT restored
  }
  assert.equal(f.overwrites.get("role"), otherRole); assert.equal(f.overwrites.get("user"), otherUser);
  assert.equal(otherRole.SendMessages, true); assert.equal(otherUser.SendMessages, false);
  assert.deepEqual(f.api, [["overwrite", "g", { SendMessages: false }], ["overwrite", "g", { SendMessages: false }], ["overwrite", "g", { SendMessages: null }], ["overwrite", "g", { SendMessages: null }]]);
  assert.equal(f.logs, 0); assert.equal(f.replies.length, 4);
});
test("lock without existing everyone overwrite creates only the desired bit, unlock leaves unrelated entries", async () => {
  const f = fixture(); f.overwrites.delete("g");
  await run(f, "verrouiller"); assert.deepEqual(f.overwrites.get("g"), { SendMessages: false });
  await run(f, "deverrouiller"); assert.deepEqual(f.overwrites.get("g"), {}); assert.equal(f.overwrites.size, 3);
});
test("unlock does not remove the overwrite entry or force allow; role allow remains effective", async () => {
  const f = fixture({ initial: { SendMessages: false, ViewChannel: false } }); await run(f, "deverrouiller");
  assert.deepEqual(f.overwrites.get("g"), { ViewChannel: false }); assert.equal(f.overwrites.get("role").SendMessages, true);
  assert.match(dictionaries.fr.moderation.LOCK_SUCCESS, /peuvent encore/); assert.match(dictionaries.en.moderation.LOCK_SUCCESS, /may still/);
});
for (const [name, permission] of [["supprimer", "ManageMessages"], ["slowmode", "ManageChannels"], ["verrouiller", "ManageRoles"], ["deverrouiller", "ManageRoles"]]) test(`${name}: bot permission refusal has no mutation`, async () => {
  const f = fixture(); f.botDenied = [permission]; const r = await run(f, name);
  assert.equal(r.ok, false); assert.match(r.code, /PERMISSION_DENIED$/); assert.equal(f.api.length, 0); assert.equal(f.replies.length, 1); assert.equal(f.logs, 0);
});
for (const name of ["supprimer", "slowmode", "verrouiller", "deverrouiller", "pseudo"]) test(`${name}: cross-guild context rejected`, async () => {
  const f = fixture(); const r = await run(f, name, { guildId: "other" }); assert.equal(r.ok, false); assert.equal(f.api.length, 0); assert.equal(f.reads, 0); assert.equal(f.replies.length, 1);
});
for (const name of ["supprimer", "slowmode", "verrouiller", "deverrouiller"]) test(`${name}: foreign channel rejected`, async () => {
  const f = fixture(); f.channel.guildId = "other"; const r = await run(f, name); assert.equal(r.ok, false); assert.equal(f.api.length, 0);
});
for (const [name, prefix] of [["supprimer", "PURGE"], ["slowmode", "SLOWMODE"], ["verrouiller", "LOCK"], ["deverrouiller", "UNLOCK"], ["pseudo", "NICKNAME"]]) {
  for (const [error, suffix] of [[{ code: 50013 }, "PERMISSION_DENIED"], [{ code: "ECONNRESET" }, "UNAVAILABLE"], [{ status: 429 }, "RATE_LIMITED"], [{ code: 50035 }, "INVALID_REQUEST"], [Error("secret"), "FAILED"]]) {
    test(`${name}: ${suffix} no success/retry/log`, async () => {
      const f = fixture({ messages: recent(1) }); f.apiError = error;
      const before = JSON.stringify([...f.overwrites]); const r = await run(f, name);
      assert.equal(r.ok, false); assert.equal(r.code, `${prefix}_${suffix}`); assert.equal(f.api.length, 1); assert.equal(f.replies.length, 1); assert.equal(f.logs, 0); assert.equal(f.errors, 0);
      assert.equal(JSON.stringify([...f.overwrites]), before); assert.equal(JSON.stringify(f.replies).includes("secret"), false);
    });
  }
}
for (const nickname of [null, "", undefined]) test(`pseudo reset via omitted/empty option ${nickname}`, async () => {
  const f = fixture(); const r = await run(f, "pseudo", { nickname: nickname === undefined ? null : nickname });
  assert.equal(r.code, "NICKNAME_RESET_SUCCESS"); assert.equal(f.target.nickname, null); assert.deepEqual(f.api, [["nickname", null]]); assert.equal(f.replies.length, 1); assert.equal(f.logs, 0);
});
test("pseudo omitted option returning undefined is normalized to null; definition is backward-compatible", async () => {
  const f = fixture(); const { router, envelope, registry } = runtime(f, "pseudo"); envelope.options.getString = () => undefined;
  assert.equal((await router.handle(envelope)).code, "NICKNAME_RESET_SUCCESS"); assert.deepEqual(f.api, [["nickname", null]]);
  const options = registry.commandRoutes.get("pseudo").options; assert.deepEqual(options.map(o => o.name), ["user", "nickname"]);
  assert.equal(options[0].required, true); assert.equal(options[1].required, false);
});
for (const nickname of ["x", "x".repeat(32), "Élodie", "  valid  "]) test(`pseudo valid ${JSON.stringify(nickname)} preserved without truncation`, async () => {
  const f = fixture(); assert.equal((await run(f, "pseudo", { nickname })).code, "NICKNAME_SUCCESS"); assert.deepEqual(f.api, [["nickname", nickname]]);
});
for (const nickname of ["x".repeat(33), " ", "\t\n", 42, true, {}, []]) test(`pseudo invalid ${JSON.stringify(nickname)} before fetch/mutation`, async () => {
  const f = fixture(); const r = await run(f, "pseudo", { nickname }); assert.equal(r.code, "NICKNAME_INVALID_NICKNAME"); assert.equal(f.reads, 0); assert.equal(f.api.length, 0); assert.equal(f.replies.length, 1);
});
for (const targetId of ["owner", "civrat"]) test(`pseudo reset still protects ${targetId}`, async () => {
  const f = fixture(); f.target.id = targetId; const r = await run(f, "pseudo", { nickname: null, user: { id: targetId } }); assert.equal(r.ok, false); assert.equal(f.api.length, 0);
});
test("pseudo reset retains actor/bot hierarchy and manageability checks", async () => {
  for (const change of [f => { f.target.roles.highest.position = 5; }, f => { f.target.roles.highest.position = 11; }, f => { f.target.manageable = false; }, f => { f.actor.permissions.has = () => false; }, f => { f.bot.permissions.has = () => false; }]) {
    const f = fixture(); change(f); const r = await run(f, "pseudo", { nickname: null }); assert.equal(r.code, "NICKNAME_NOT_MANAGEABLE"); assert.equal(f.api.length, 0);
  }
});
for (const [error, code] of [[{ code: 10007 }, "NICKNAME_INVALID_TARGET"], [{ code: 50013 }, "NICKNAME_PERMISSION_DENIED"], [{ code: "ETIMEDOUT" }, "NICKNAME_UNAVAILABLE"]]) test(`pseudo lookup failure ${code} is caught without mutation`, async () => {
  const f = fixture(); f.readError = error; const r = await run(f, "pseudo", { nickname: null }); assert.equal(r.code, code); assert.equal(f.api.length, 0); assert.equal(f.replies.length, 1); assert.equal(f.errors, 0);
});
test("new channel result keys are translated in both locales without global placeholder work", () => {
  const fr = dictionaries.fr.moderation, en = dictionaries.en.moderation; assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const key of ["PURGE_PARTIAL", "PURGE_NONE", "PURGE_UNCONFIRMED", "purgeRequested", "purgeDeleted", "NICKNAME_RESET_SUCCESS"]) {
    for (const locale of [fr, en]) { assert.equal(typeof locale[key], "string"); assert.equal(locale[key].includes("{{"), false); }
  }
});
