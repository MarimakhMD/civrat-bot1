"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { BanService } = require("../services/BanService");
const { KickService } = require("../services/KickService");
const { TimeoutService } = require("../services/TimeoutService");
const { WarningService } = require("../services/WarningService");
const { NicknameService } = require("../services/NicknameService");
const { DiscordModerationTransport } = require("../../../adapters/discord/DiscordModerationTransport");
const { InMemoryWarningRepository } = require("../persistence/WarningRepository");
const { SupabaseWarningRepository } = require("../persistence/SupabaseWarningRepository");
const { InteractionRegistry, InteractionRouter, InteractionKind } = require("../../../core/interactions");
const { PermissionService } = require("../../../core/permissions");
const { AuthorizationError } = require("../../../core/errors");
const { registerModeration } = require("../register");
const { validUserId, failure } = require("../services/sanctionReliability");
const ID = "123456789012345678";
function fixture() {
  const f = { reads: 0, mutations: [], writes: [], replies: [], logs: 0, errors: 0 };
  const guild = { id: "223456789012345678", ownerId: "323456789012345678", name: "Test", members: {}, bans: {} };
  const member = (id, position) => ({ id, guild, user: { bot: false, tag: "member" }, permissions: { has: () => true }, roles: { highest: { position } } });
  const actor = member("423456789012345678", 5), bot = member("523456789012345678", 10), target = member(ID, 1);
  Object.assign(target, { bannable: true, kickable: true, moderatable: true, manageable: true, isCommunicationDisabled: () => true });
  for (const op of ["timeout", "ban", "kick", "setNickname"]) target[op] = async (...args) => { f.mutations.push({ op, args }); if (f.writeError) throw f.writeError; };
  target.user.send = async () => { f.mutations.push({ op: "dm" }); if (f.dmError) throw f.dmError; };
  guild.members.me = bot;
  guild.members.fetch = async () => { f.reads++; if (f.readError) throw f.readError; return f.missing ? null : target; };
  guild.bans.fetch = async () => { f.reads++; if (f.readError) throw f.readError; return f.missing ? null : {}; };
  guild.members.unban = async (...args) => { f.mutations.push({ op: "unban", args }); if (f.writeError) throw f.writeError; };
  const repository = { durable: true, createWarning: async row => { if (f.persistenceError) throw f.persistenceError; f.writes.push(row); return { id: f.writes.length }; } };
  return Object.assign(f, { guild, actor, target, repository, transport: new DiscordModerationTransport({ guild, actor }) });
}
const cases = [
  ["BAN", "bannir", f => new BanService().ban(input(f))],
  ["KICK", "expulser", f => new KickService().kick(input(f))],
  ["TIMEOUT", "mute", f => new TimeoutService().apply({ ...input(f), durationMinutes: 10 })],
  ["UNTIMEOUT", "unmute", f => new TimeoutService().remove(input(f))],
  ["UNBAN", "debannir", f => new BanService().unban({ ...input(f), userId: ID })],
];
function input(f) { return { guildId: f.guild.id, actor: f.actor, targetId: ID, transport: f.transport }; }
const errors = [
  ["missing access", { code: 50001 }, "PERMISSION_DENIED"],
  ["permissions", { rawError: { code: 50013 } }, "PERMISSION_DENIED"],
  ["network", { cause: { code: "ECONNRESET" } }, "UNAVAILABLE"],
  ["server", { status: 503 }, "UNAVAILABLE"],
  ["rate", { status: 429 }, "RATE_LIMITED"],
  ["API validation", { code: 50035 }, "INVALID_REQUEST"],
  ["unexpected", { code: 987654, message: "SECRET must never reach the response" }, "FAILED"],
];
for (const [prefix, , run] of cases) for (const [label, error, suffix] of errors) for (const phase of ["read", "write"]) {
  test(`${prefix}: ${phase} ${label} distinct from absent target`, async () => {
    const f = fixture(); f[phase === "read" ? "readError" : "writeError"] = error;
    const result = await run(f); assert.equal(result.ok, false); assert.equal(result.code, `${prefix}_${suffix}`);
    assert.equal(f.mutations.length, phase === "read" ? 0 : 1); assert.equal(f.writes.length, 0);
    assert.equal(JSON.stringify(result).includes("SECRET"), false);
  });
}
for (const [label, error, suffix] of errors) test(`WARN: lookup ${label} causes no INSERT/DM`, async () => {
  const f = fixture(); f.readError = error;
  const r = await new WarningService({ repository: f.repository }).warn(input(f));
  assert.equal(r.warned, false); assert.equal(r.code, `WARN_${suffix}`); assert.deepEqual(f.writes, []); assert.deepEqual(f.mutations, []);
});
test("transport collapses only Unknown Member and Unknown Ban, not generic 404/unknown guild/permissions", async () => {
  const f = fixture();
  for (const code of [10007, "10007"]) { f.readError = { code }; assert.equal(await f.transport.getMember(ID), null); }
  f.readError = { rawError: { code: 10026 } }; assert.equal(await f.transport.getBan(ID), null);
  for (const error of [{ code: 10004 }, { status: 404 }, { code: 50013 }, { code: "ETIMEDOUT" }]) {
    f.readError = error; await assert.rejects(() => f.transport.getMember(ID), e => e === error); await assert.rejects(() => f.transport.getBan(ID), e => e === error);
  }
  f.readError = { code: 10004 }; assert.equal((await cases[4][2](f)).code, "UNBAN_FAILED");
  f.readError = { code: 10026 }; assert.equal((await cases[4][2](f)).code, "UNBAN_NOT_BANNED");
  assert.equal(f.mutations.length, 0);
});
test("known missing target on lookup and race during mutation are not permission/network errors", async () => {
  for (const [prefix, , run] of cases) {
    const f = fixture(); f.readError = { code: prefix === "UNBAN" ? 10026 : 10007 };
    assert.equal((await run(f)).code, prefix === "UNBAN" ? "UNBAN_NOT_BANNED" : `${prefix}_INVALID_TARGET`); assert.equal(f.mutations.length, 0);
    f.readError = null; f.writeError = { code: prefix === "UNBAN" ? 10026 : 10007 };
    assert.equal((await run(f)).code, prefix === "UNBAN" ? "UNBAN_NOT_BANNED" : `${prefix}_INVALID_TARGET`); assert.equal(f.mutations.length, 1);
  }
});
test("authorization race in adapter is classified as permission denial", async () => {
  assert.equal(failure("BAN", new AuthorizationError()).code, "BAN_PERMISSION_DENIED");
});
for (const [prefix, , run] of cases.filter(([p]) => ["BAN", "KICK", "TIMEOUT"].includes(p))) {
  test(`${prefix}: reason type/length rejected before lookup or mutation; 500 accepted unchanged`, async () => {
    const f = fixture(); const Service = prefix === "BAN" ? BanService : prefix === "KICK" ? KickService : TimeoutService;
    const method = prefix === "BAN" ? "ban" : prefix === "KICK" ? "kick" : "apply";
    for (const reason of ["x".repeat(501), {}, 42, true, ["reason"]]) {
      const r = await new Service()[method]({ ...input(f), durationMinutes: 10, reason }); assert.equal(r.code, `${prefix}_INVALID_REASON`);
    }
    assert.equal(f.reads, 0); assert.equal(f.mutations.length, 0);
    const reason = "é".repeat(500); assert.equal((await new Service()[method]({ ...input(f), durationMinutes: 10, reason })).ok, true);
    const args = f.mutations[0].args; assert.equal(prefix === "BAN" ? args[0].reason : prefix === "KICK" ? args[0] : args[1], reason);
  });
}
test("warn reason invalid before INSERT, lookup or DM", async () => {
  const f = fixture(), service = new WarningService({ repository: f.repository });
  for (const reason of ["x".repeat(501), {}, 42, true]) assert.equal((await service.warn({ ...input(f), reason })).warned, false);
  assert.equal(f.reads, 0); assert.equal(f.writes.length, 0); assert.equal(f.mutations.length, 0);
});
test("nickname bound validation only, without changing reset or channel contracts", async () => {
  const f = fixture();
  for (const nickname of ["x".repeat(33), 42, {}, undefined]) assert.equal((await new NicknameService().set({ ...input(f), nickname })).code, "NICKNAME_INVALID_NICKNAME");
  assert.equal(f.reads, 0); assert.equal(f.mutations.length, 0);
  assert.equal((await new NicknameService().set({ ...input(f), nickname: "x".repeat(32) })).ok, true); assert.equal(f.mutations[0].args[0].length, 32);
});
function setupRoute(f, name, overrides = {}) {
  const registry = new InteractionRegistry();
  registerModeration({ registry, transportFactory: () => f.transport, warningRepositoryFactory: () => f.repository,
    logsRuntimeFactory: () => ({ disabled: true }), ...overrides });
  const router = new InteractionRouter({ registry, contextFactory: { create: async envelope => ({ guildId: f.guild.id, envelope, member: { has: () => true }, permissions: new PermissionService(), t: key => key, respondError: async () => { f.errors++; } }) } });
  const envelope = { kind: InteractionKind.COMMAND, name, discordMember: f.actor, options: { getUser: () => ({ id: ID }), getString: key => key === "id" ? ID : null, getInteger: () => 10 }, transport: { reply: async p => { f.replies.push(p); } } };
  return { router, envelope };
}
for (const duration of [0, -1, 40321, 1.5, NaN, "10"]) test(`runtime /mute rejects duration ${duration} without lookup or mutation`, async () => {
  const f = fixture(), { router, envelope } = setupRoute(f, "mute"); envelope.options.getInteger = () => duration;
  const result = await router.handle(envelope); assert.equal(result.code, "TIMEOUT_INVALID_DURATION"); assert.equal(f.reads, 0); assert.equal(f.mutations.length, 0); assert.equal(f.replies.length, 1); assert.equal(f.errors, 0);
});
for (const duration of [null, undefined, 1, 40320]) test(`runtime /mute default/bound ${duration}`, async () => {
  const f = fixture(), { router, envelope } = setupRoute(f, "mute"); envelope.options.getInteger = () => duration;
  assert.equal((await router.handle(envelope)).ok, true); assert.equal(f.mutations.length, 1); assert.equal(f.mutations[0].args[0], (duration ?? 10) * 60000); assert.equal(f.replies.length, 1);
});
test("timeout service has the same absent default and untimeout remains null", async () => {
  const f = fixture(); await new TimeoutService().apply(input(f)); await new TimeoutService().remove(input(f));
  assert.equal(f.mutations[0].args[0], 600000); assert.equal(f.mutations[1].args[0], null);
});
for (const name of ["warn", "mute", "unmute", "bannir", "debannir", "expulser"]) test(`${name}: malformed ID rejected at boundary before any lookup/write/log`, async () => {
  for (const id of ["", "u", "123", " 123456789012345678", "123456789012345678 ", "-123456789012345678", "1e18", "0".repeat(18), "18446744073709551616", 123456789012345678, null, "<@123456789012345678>"]) {
    const f = fixture(), { router, envelope } = setupRoute(f, name); envelope.options.getUser = () => ({ id }); envelope.options.getString = key => key === "id" ? id : null;
    const r = await router.handle(envelope); assert.equal(name === "warn" ? r.warned : r.ok, false); assert.match(r.code, /_INVALID_TARGET$/); assert.equal(f.reads, 0); assert.deepEqual(f.mutations, []); assert.deepEqual(f.writes, []); assert.equal(f.logs, 0); assert.equal(f.replies.length, 1); assert.equal(f.errors, 0);
  }
});
test("unban validates free-text ID in service too and preserves precision", async () => {
  for (const id of ["bad", 123, "18446744073709551616", null]) { const f = fixture(); assert.equal((await new BanService().unban({ ...input(f), userId: id })).code, "UNBAN_INVALID_TARGET"); assert.equal(f.reads, 0); }
  assert.equal(validUserId("18446744073709551615"), true);
  const f = fixture(); await new BanService().unban({ ...input(f), userId: ID }); assert.equal(f.mutations[0].args[0], ID);
});
for (const mode of ["factory throw", "sync throw", "promise reject", "plain return", "disabled"]) test(`recorded warn survives logging ${mode} with one INSERT/DM/reply`, async () => {
  const f = fixture();
  const factory = () => {
    f.logs++; if (mode === "factory throw") throw Error("logging unavailable");
    return { disabled: mode === "disabled", handleModerationEvent: () => {
      if (mode === "sync throw") throw Error("sync logging unavailable");
      if (mode === "promise reject") return Promise.reject(Error("async logging unavailable"));
      return undefined;
    } };
  };
  const { router, envelope } = setupRoute(f, "warn", { logsRuntimeFactory: factory });
  const result = await router.handle(envelope); assert.equal(result.warned, true); assert.equal(result.code, "WARN_SUCCESS"); assert.equal(f.writes.length, 1); assert.equal(f.mutations.length, 1); assert.equal(f.logs, 1); assert.equal(f.replies.length, 1); assert.equal(f.errors, 0);
});
for (const dmFails of [false, true]) test(`memory warning and DM failure=${dmFails} explicitly reports volatile storage`, async () => {
  const f = fixture(); f.repository = new InMemoryWarningRepository(); if (dmFails) f.dmError = { code: 50007 };
  const { router, envelope } = setupRoute(f, "warn"); const result = await router.handle(envelope);
  assert.equal(result.warned, true); assert.equal(result.persistence, "memory"); assert.equal(result.dmSent, !dmFails); assert.match(f.replies[0].view.content, /warningMemory/);
  assert.equal((await f.repository.listWarnings(f.guild.id, ID)).length, 1); assert.equal((await f.repository.listWarnings("other", ID)).length, 0); assert.equal(f.mutations.length, 1); assert.equal(f.replies.length, 1);
});
test("durable and unknown repositories are distinguished without optimistic durable claim", async () => {
  for (const durable of [true, undefined]) {
    const f = fixture(); f.repository.durable = durable; const { router, envelope } = setupRoute(f, "warn"); const result = await router.handle(envelope);
    assert.equal(result.persistence, durable ? "durable" : "unknown"); assert.equal(f.replies[0].view.content.includes("warningPersistenceUnknown"), !durable);
    assert.equal(f.writes.length, 1); assert.equal(f.mutations.length, 1);
  }
  assert.equal(new InMemoryWarningRepository().durable, false); assert.equal(new SupabaseWarningRepository({ supabase: { from() {} } }).durable, true);
});
test("durable persistence failure never falls back to memory, sends DM or logs success", async () => {
  const f = fixture(); f.persistenceError = Error("storage unavailable"); const { router, envelope } = setupRoute(f, "warn", { logsRuntimeFactory: () => { f.logs++; return {}; } });
  const result = await router.handle(envelope); assert.equal(result.warned, false); assert.equal(result.code, "WARN_PERSISTENCE_FAILED"); assert.equal(f.writes.length, 0); assert.equal(f.mutations.length, 0); assert.equal(f.logs, 0); assert.equal(f.replies.length, 1);
});
test("new result keys have FR/EN parity and never contain raw error details", () => {
  const fr = require("../translations/fr.json").moderation, en = require("../translations/en.json").moderation;
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const prefix of ["BAN", "UNBAN", "KICK", "TIMEOUT", "UNTIMEOUT", "WARN"]) for (const suffix of ["PERMISSION_DENIED", "UNAVAILABLE", "RATE_LIMITED", "INVALID_REQUEST"]) {
    for (const locale of [fr, en]) { assert.equal(typeof locale[`${prefix}_${suffix}`], "string"); assert.equal(locale[`${prefix}_${suffix}`].includes("SECRET"), false); }
  }
});
