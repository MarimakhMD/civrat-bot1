"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GiveawayService } = require("../services/GiveawayService");

function mockRepo(overrides = {}) {
  const entries = new Map();
  return {
    create: async ({ guildId, channelId, prize, winnersCount }) => ({ id: "g1", guild_id: guildId, channel_id: channelId, prize, winners_count: winnersCount, status: "open" }),
    findById: async (id) => (id === "g1" ? { id: "g1", guild_id: "g1", channel_id: "c1", prize: "prize", winners_count: 1, status: "open" } : null),
    join: async (gid, uid) => {
      const key = `${gid}:${uid}`;
      if (entries.has(key)) return { alreadyJoined: true };
      entries.set(key, true);
      return { alreadyJoined: false };
    },
    listEntries: async () => [{ user_id: "u1" }, { user_id: "u2" }],
    draw: async (gid) => ({ winners: ["u1"] }),
    close: async () => ({}),
    ...overrides,
  };
}

test("create respects disabled and invalid prize", async () => {
  const svc = new GiveawayService({ configService: { read: async () => ({ giveaway_enabled: false }) }, repository: mockRepo() });
  assert.equal((await svc.create({ guildId: "g1", prize: "prize" })).code, "GIVEAWAY_DISABLED");
  const svc2 = new GiveawayService({ configService: { read: async () => ({ giveaway_enabled: true }) }, repository: mockRepo() });
  assert.equal((await svc2.create({ guildId: "g1", prize: "" })).code, "GIVEAWAY_INVALID_PRIZE");
  assert.equal((await svc2.create({ guildId: "g1", prize: "a" })).code, "GIVEAWAY_INVALID_PRIZE");
});

test("create succeeds and join handles already joined", async () => {
  const svc = new GiveawayService({ configService: { read: async () => ({ giveaway_enabled: true }) }, repository: mockRepo() });
  const created = await svc.create({ guildId: "g1", prize: "prize", channelId: "c1" });
  assert.equal(created.ok, true);
  assert.equal(created.code, "GIVEAWAY_CREATED");
  const join1 = await svc.join({ guildId: "g1", giveawayId: "g1", userId: "u1" });
  assert.equal(join1.ok, true);
  const join2 = await svc.join({ guildId: "g1", giveawayId: "g1", userId: "u1" });
  assert.equal(join2.code, "GIVEAWAY_ALREADY_JOINED");
});

test("join handles not found and closed", async () => {
  const svc = new GiveawayService({
    configService: { read: async () => ({ giveaway_enabled: true }) },
    repository: { findById: async () => null, join: async () => ({}), create: async () => ({}), listEntries: async () => [], draw: async () => ({}), close: async () => ({}) },
  });
  assert.equal((await svc.join({ guildId: "g1", giveawayId: "bad", userId: "u1" })).code, "GIVEAWAY_NOT_FOUND");
  const svc2 = new GiveawayService({
    configService: { read: async () => ({ giveaway_enabled: true }) },
    repository: { findById: async () => ({ id: "g1", guild_id: "g1", status: "closed" }), join: async () => ({}) },
  });
  assert.equal((await svc2.join({ guildId: "g1", giveawayId: "g1", userId: "u1" })).code, "GIVEAWAY_CLOSED");
});

test("draw picks winners and closes", async () => {
  const svc = new GiveawayService({ configService: { read: async () => ({ giveaway_enabled: true }) }, repository: mockRepo() });
  const res = await svc.draw({ guildId: "g1", giveawayId: "g1" });
  assert.equal(res.ok, true);
  assert.equal(res.code, "GIVEAWAY_DRAWN");
  assert.deepEqual(res.winners, ["u1"]);
});

test("draw not found", async () => {
  const svc = new GiveawayService({ configService: { read: async () => ({}) }, repository: { findById: async () => null } });
  assert.equal((await svc.draw({ guildId: "g1", giveawayId: "bad" })).code, "GIVEAWAY_NOT_FOUND");
});
