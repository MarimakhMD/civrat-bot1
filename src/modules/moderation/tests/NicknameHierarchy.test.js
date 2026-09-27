"use strict";

// P4 — hiérarchie acteur → cible de /pseudo (NicknameService).
// Couvre A–J, M (spec P4) + intégration : channelRegister transmet bien
// c.envelope.discordMember comme acteur. K (permission routeur), L (succès),
// N (dispatch unique) sont non-régressés par Channel* existants.

const test = require("node:test");
const assert = require("node:assert/strict");
const { NicknameService } = require("../services/NicknameService");

function makeActor(id, position) {
  return { id, roles: { highest: { position } } };
}

function makeTarget(id, position, extra = {}) {
  return { id, manageable: true, roles: { highest: { position } }, ...extra };
}

function makeTransport(target, { throwOnSet = false } = {}) {
  const calls = { getMember: 0, setNickname: 0 };
  return {
    calls,
    transport: {
      getMember: async () => {
        calls.getMember += 1;
        return target;
      },
      setNickname: async () => {
        calls.setNickname += 1;
        if (throwOnSet) throw new Error("api failure");
      },
    },
  };
}

const service = new NicknameService();

// ── A. acteur inférieur à la cible → refus ──────────────────────────────

test("P4-A: acteur inférieur à la cible → NICKNAME_NOT_MANAGEABLE, aucun appel setNickname", async () => {
  const { calls, transport } = makeTransport(makeTarget("u", 5));
  const result = await service.set({
    guildId: "g",
    actor: makeActor("a", 2),
    targetId: "u",
    nickname: "New",
    transport,
  });
  assert.equal(result.code, "NICKNAME_NOT_MANAGEABLE");
  assert.equal(calls.getMember, 1);
  assert.equal(calls.setNickname, 0);
});

// ── B. acteur supérieur à la cible → succès ─────────────────────────────

test("P4-B: acteur supérieur à la cible → NICKNAME_SUCCESS", async () => {
  const { calls, transport } = makeTransport(makeTarget("u", 2));
  const result = await service.set({
    guildId: "g",
    actor: makeActor("a", 5),
    targetId: "u",
    nickname: "New",
    transport,
  });
  assert.deepEqual(result, { ok: true, code: "NICKNAME_SUCCESS" });
  assert.equal(calls.setNickname, 1);
});

// ── C. même niveau → refus (comparaison stricte) ────────────────────────

test("P4-C: acteur au même niveau que la cible → NICKNAME_NOT_MANAGEABLE", async () => {
  const { calls, transport } = makeTransport(makeTarget("u", 3));
  const result = await service.set({
    guildId: "g",
    actor: makeActor("a", 3),
    targetId: "u",
    nickname: "New",
    transport,
  });
  assert.equal(result.code, "NICKNAME_NOT_MANAGEABLE");
  assert.equal(calls.setNickname, 0);
});

// ── D. self-target → autorisé (hiérarchie sautée, manageable conservé) ──

test("P4-D: self-target → NICKNAME_SUCCESS même à position égale", async () => {
  const { calls, transport } = makeTransport(makeTarget("a", 0));
  const result = await service.set({
    guildId: "g",
    actor: makeActor("a", 0),
    targetId: "a",
    nickname: "MyOwnNick",
    transport,
  });
  assert.deepEqual(result, { ok: true, code: "NICKNAME_SUCCESS" });
  assert.equal(calls.setNickname, 1);
});

// ── E. cible owner → refus via target.manageable ────────────────────────

test("P4-E: cible owner (manageable=false) → refus via la barrière bot → cible", async () => {
  // discord.js : manageable === false quand la cible est le owner de la guilde.
  const target = makeTarget("owner", 0, { manageable: false });
  const { calls, transport } = makeTransport(target);
  const result = await service.set({
    guildId: "g",
    actor: makeActor("a", 9),
    targetId: "owner",
    nickname: "New",
    transport,
  });
  assert.equal(result.code, "NICKNAME_NOT_MANAGEABLE");
  assert.equal(calls.setNickname, 0);
});

// ── F. cible admin sous le bot → le statut admin ne bloque pas ─────────

test("P4-F: cible admin (moderatable=false côté discord.js) avec hiérarchie acteur valide → NICKNAME_SUCCESS", async () => {
  // L'admin n'est lu NI par le service ni par manageable : seul comptent
  // l'hiérarchie acteur → cible et target.manageable.
  const target = makeTarget("u", 2, { moderatable: false, permissions: { administrator: true } });
  const { calls, transport } = makeTransport(target);
  const result = await service.set({
    guildId: "g",
    actor: makeActor("a", 5),
    targetId: "u",
    nickname: "New",
    transport,
  });
  assert.deepEqual(result, { ok: true, code: "NICKNAME_SUCCESS" });
  assert.equal(calls.setNickname, 1);
});

// ── G. cible bot → comportement actuel, target.manageable décide ────────

test("P4-G: cible bot manageable → NICKNAME_SUCCESS (comportement conservé)", async () => {
  const target = makeTarget("bot1", 2, { bot: true });
  const { transport } = makeTransport(target);
  const result = await service.set({
    guildId: "g",
    actor: makeActor("a", 5),
    targetId: "bot1",
    nickname: "BotNick",
    transport,
  });
  assert.deepEqual(result, { ok: true, code: "NICKNAME_SUCCESS" });
});

test("P4-G: cible bot non manageable par le bot → NICKNAME_NOT_MANAGEABLE", async () => {
  const target = makeTarget("bot2", 9, { bot: true, manageable: false });
  const { calls, transport } = makeTransport(target);
  const result = await service.set({
    guildId: "g",
    actor: makeActor("a", 10),
    targetId: "bot2",
    nickname: "BotNick",
    transport,
  });
  assert.equal(result.code, "NICKNAME_NOT_MANAGEABLE");
  assert.equal(calls.setNickname, 0);
});

// ── H. actor absent → erreur propre, aucun appel setNickname ────────────

test("P4-H: actor absent → NICKNAME_GUILD_MISMATCH, aucun fetch ni setNickname", async () => {
  const { calls, transport } = makeTransport(makeTarget("u", 1));
  const result = await service.set({
    guildId: "g",
    actor: undefined,
    targetId: "u",
    nickname: "New",
    transport,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "NICKNAME_GUILD_MISMATCH");
  assert.equal(calls.getMember, 0, "l'acteur invalide stoppe avant le fetch");
  assert.equal(calls.setNickname, 0);

  const noId = await service.set({ guildId: "g", actor: {}, targetId: "u", nickname: "New", transport });
  assert.equal(noId.code, "NICKNAME_GUILD_MISMATCH");
});

// ── I. cible absente → NICKNAME_INVALID_TARGET ──────────────────────────

test("P4-I: cible absente (option vide ou membre introuvable) → NICKNAME_INVALID_TARGET", async () => {
  const actor = makeActor("a", 5);

  const noOption = await service.set({ guildId: "g", actor, targetId: undefined, nickname: "x", transport: makeTransport(null).transport });
  assert.equal(noOption.code, "NICKNAME_INVALID_TARGET");

  const { calls, transport } = makeTransport(null);
  const notFound = await service.set({ guildId: "g", actor, targetId: "ghost", nickname: "x", transport });
  assert.equal(notFound.code, "NICKNAME_INVALID_TARGET");
  assert.equal(calls.setNickname, 0);
});

// ── J. setNickname qui throw → NICKNAME_FAILED ──────────────────────────

test("P4-J: erreur API setNickname → NICKNAME_FAILED (non bloquant)", async () => {
  const { calls, transport } = makeTransport(makeTarget("u", 2), { throwOnSet: true });
  const result = await service.set({
    guildId: "g",
    actor: makeActor("a", 5),
    targetId: "u",
    nickname: "New",
    transport,
  });
  assert.deepEqual(result, { ok: false, code: "NICKNAME_FAILED" });
  assert.equal(calls.setNickname, 1);
});

// ── M. guildId absent → NICKNAME_GUILD_MISMATCH ─────────────────────────

test("P4-M: guildId absent → NICKNAME_GUILD_MISMATCH, aucun appel setNickname", async () => {
  const { calls, transport } = makeTransport(makeTarget("u", 1));
  const result = await service.set({
    guildId: undefined,
    actor: makeActor("a", 5),
    targetId: "u",
    nickname: "New",
    transport,
  });
  assert.equal(result.code, "NICKNAME_GUILD_MISMATCH");
  assert.equal(calls.setNickname, 0);
});

// ── Intégration channelRegister : l'acteur réel est transmis ───────────

async function runPseudo({ actor, target }) {
  const { InteractionRegistry, InteractionRouter, InteractionKind } = require("../../../core/interactions");
  const { PermissionService } = require("../../../core/permissions");
  const { registerChannelModeration } = require("../channelRegister");

  const registry = new InteractionRegistry();
  registerChannelModeration({ registry });
  const guild = {
    id: "g",
    members: { fetch: async () => target },
  };
  const router = new InteractionRouter({
    registry,
    contextFactory: {
      create: async (envelope) => ({
        guildId: "g",
        userId: actor.id,
        member: { has: () => true },
        permissions: new PermissionService(),
        t: (key) => key,
        envelope,
        respondError: async () => envelope.transport.replyError(),
      }),
    },
  });
  let content = null;
  await router.handle({
    kind: InteractionKind.COMMAND,
    name: "pseudo",
    discordMember: { ...actor, guild, user: {} },
    discordChannel: {},
    options: {
      getInteger: () => 0,
      getUser: () => ({ id: "u" }),
      getString: () => "New",
    },
    transport: {
      reply: async (payload) => { content = payload.view.content; },
      replyError: async () => { content = "ERROR"; },
    },
  });
  return content;
}

test("P4-intégration: acteur inférieur transmis par channelRegister → NICKNAME_NOT_MANAGEABLE", async () => {
  const target = makeTarget("u", 5);
  target.setNickname = async () => { throw new Error("ne doit jamais être appelé"); };
  const content = await runPseudo({
    actor: { id: "a", roles: { highest: { position: 2 } } },
    target,
  });
  assert.equal(content, "moderation.NICKNAME_NOT_MANAGEABLE");
});

test("P4-intégration: acteur supérieur transmis par channelRegister → NICKNAME_SUCCESS", async () => {
  let renamed = false;
  const target = makeTarget("u", 2);
  target.setNickname = async () => { renamed = true; };
  const content = await runPseudo({
    actor: { id: "a", roles: { highest: { position: 5 } } },
    target,
  });
  assert.equal(content, "moderation.NICKNAME_SUCCESS");
  assert.equal(renamed, true);
});
