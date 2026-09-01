"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GiveawayService } = require("../services/GiveawayService");

function mockRepo(overrides = {}) {
  const entries = new Map();
  return {
    // C1 : signature et colonnes alignées sur le dépôt Supabase réel.
    create: async ({ guildId, channelId, title, winnersCount, duration, endsAt }) => ({
      id: "g1",
      guild_id: guildId,
      channel_id: channelId,
      title,
      winners_count: winnersCount,
      duration,
      ends_at: endsAt,
      active: true,
      status: "active",
    }),
    findById: async (id) => (id === "g1"
      ? { id: "g1", guild_id: "g1", channel_id: "c1", title: "prize", winners_count: 1, active: true, status: "active" }
      : null),
    join: async (gid, uid) => {
      const key = `${gid}:${uid}`;
      if (entries.has(key)) return { alreadyJoined: true };
      entries.set(key, true);
      return { alreadyJoined: false };
    },
    listEntries: async () => [{ user_id: "u1" }, { user_id: "u2" }],
    draw: async () => ({ winners: ["u1"] }),
    close: async () => ({}),
    ...overrides,
  };
}

const enabled = { read: async () => ({ giveaways_enabled: true }) };

test("create respects disabled and invalid prize", async () => {
  const svc = new GiveawayService({ configService: { read: async () => ({ giveaways_enabled: false }) }, repository: mockRepo() });
  assert.equal((await svc.create({ guildId: "g1", channelId: "c1", title: "prize" })).code, "GIVEAWAY_DISABLED");
  const svc2 = new GiveawayService({ configService: enabled, repository: mockRepo() });
  assert.equal((await svc2.create({ guildId: "g1", channelId: "c1", title: "" })).code, "GIVEAWAY_INVALID_PRIZE");
  assert.equal((await svc2.create({ guildId: "g1", channelId: "c1", title: "a" })).code, "GIVEAWAY_INVALID_PRIZE");
});

test("create requires a channel — il n'existe aucune colonne giveaways_channel_id", async () => {
  const svc = new GiveawayService({ configService: enabled, repository: mockRepo() });
  const res = await svc.create({ guildId: "g1", title: "prize" });
  assert.equal(res.ok, false);
  assert.equal(res.code, "GIVEAWAY_NO_CHANNEL");
});

test("create succeeds and join handles already joined", async () => {
  const svc = new GiveawayService({ configService: enabled, repository: mockRepo() });
  const created = await svc.create({ guildId: "g1", channelId: "c1", title: "prize" });
  assert.equal(created.ok, true);
  assert.equal(created.code, "GIVEAWAY_CREATED");
  assert.equal(created.giveaway.title, "prize");
  assert.equal(created.giveaway.status, "active");
  const join1 = await svc.join({ guildId: "g1", giveawayId: "g1", userId: "u1" });
  assert.equal(join1.ok, true);
  const join2 = await svc.join({ guildId: "g1", giveawayId: "g1", userId: "u1" });
  assert.equal(join2.code, "GIVEAWAY_ALREADY_JOINED");
});

test("join handles not found and closed", async () => {
  const svc = new GiveawayService({
    configService: enabled,
    repository: { findById: async () => null, join: async () => ({}), create: async () => ({}), listEntries: async () => [], draw: async () => ({}), close: async () => ({}) },
  });
  assert.equal((await svc.join({ guildId: "g1", giveawayId: "bad", userId: "u1" })).code, "GIVEAWAY_NOT_FOUND");

  // C1 : la garde porte sur le booléen réel `active`, plus sur status !== "open".
  // La valeur réelle par défaut de status est 'active', jamais 'open'.
  const svc2 = new GiveawayService({
    configService: enabled,
    repository: { findById: async () => ({ id: "g1", guild_id: "g1", active: false, status: "ended" }), join: async () => ({}) },
  });
  assert.equal((await svc2.join({ guildId: "g1", giveawayId: "g1", userId: "u1" })).code, "GIVEAWAY_CLOSED");
});

test("draw picks winners and closes", async () => {
  const svc = new GiveawayService({ configService: enabled, repository: mockRepo() });
  const res = await svc.draw({ guildId: "g1", giveawayId: "g1" });
  assert.equal(res.ok, true);
  assert.equal(res.code, "GIVEAWAY_DRAWN");
  assert.deepEqual(res.winners, ["u1"]);
});

test("draw not found", async () => {
  const svc = new GiveawayService({ configService: { read: async () => ({}) }, repository: { findById: async () => null } });
  assert.equal((await svc.draw({ guildId: "g1", giveawayId: "bad" })).code, "GIVEAWAY_NOT_FOUND");
});

test("C1 anti-double-tirage : draw refuse un giveaway inactif", async () => {
  let draws = 0;
  let active = true;
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", channel_id: "c1", title: "prize", winners_count: 1, active, status: active ? "active" : "ended" }),
      draw: async () => { draws += 1; return { winners: ["u1"] }; },
      close: async () => { active = false; return {}; },
    },
  });

  const first = await svc.draw({ guildId: "g1", giveawayId: "g1" });
  assert.equal(first.ok, true);
  assert.equal(draws, 1);

  // Sans la garde, ce second appel tirait une deuxième fois.
  const second = await svc.draw({ guildId: "g1", giveawayId: "g1" });
  assert.equal(second.ok, false);
  assert.equal(second.code, "GIVEAWAY_CLOSED");
  assert.equal(draws, 1, "le dépôt ne doit pas être rappelé");
});

test("C1 anti-double-tirage : active null ou absent est refusé", async () => {
  for (const active of [null, undefined]) {
    let draws = 0;
    const svc = new GiveawayService({
      configService: enabled,
      repository: {
        findById: async () => ({ id: "g1", guild_id: "g1", active }),
        draw: async () => { draws += 1; return { winners: [] }; },
        close: async () => ({}),
      },
    });
    const res = await svc.draw({ guildId: "g1", giveawayId: "g1" });
    assert.equal(res.code, "GIVEAWAY_CLOSED");
    assert.equal(draws, 0);
  }
});

test("C1 M5 : join et draw signalent explicitement l'absence de giveaway_entries", async () => {
  const unavailable = Object.assign(new Error("no table"), { code: "GIVEAWAY_ENTRIES_UNAVAILABLE" });
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", channel_id: "c1", title: "p", active: true, status: "active" }),
      join: async () => { throw unavailable; },
      draw: async () => { throw unavailable; },
      close: async () => ({}),
    },
  });

  // Le code renvoyé distingue « table absente » d'un échec réel.
  assert.equal((await svc.join({ guildId: "g1", giveawayId: "g1", userId: "u1" })).code, "GIVEAWAY_ENTRIES_UNAVAILABLE");
  assert.equal((await svc.draw({ guildId: "g1", giveawayId: "g1" })).code, "GIVEAWAY_ENTRIES_UNAVAILABLE");
});

test("C1 : un échec réel de join n'est pas confondu avec l'absence de table", async () => {
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", active: true, status: "active" }),
      join: async () => { throw Object.assign(new Error("permission denied"), { code: "42501" }); },
    },
  });
  assert.equal((await svc.join({ guildId: "g1", giveawayId: "g1", userId: "u1" })).code, "GIVEAWAY_JOIN_FAILED");
});
