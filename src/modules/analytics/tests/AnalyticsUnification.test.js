"use strict";

// Phase 11 — unification du runtime Analytics : un seul service, un seul
// stockage d'événements, et les classements XP/Invites lus sur les MÊMES
// instances que le chemin d'écriture (plus d'instances disjointes).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAnalyticsRuntime } = require("../runtime/createAnalyticsRuntime");
const { InMemoryAnalyticsRepository } = require("../persistence/InMemoryAnalyticsRepository");
const { SupabaseAnalyticsRepository } = require("../persistence/SupabaseAnalyticsRepository");

test("createAnalyticsRuntime exposes the shared config service (composition reads/writes one instance)", () => {
  const configService = { read: async () => ({}), update: async () => ({}) };
  const runtime = createAnalyticsRuntime({ configService });
  assert.equal(runtime._configService, configService);
});

test("getAnalyticsRuntime uses InMemory event storage offline and reuses the write-side repositories", async () => {
  // Config legacy simulée AVANT la construction du runtime (même backend qu'en
  // prod : une seule table guild_configs, ici une closure partagée).
  const guildConfigModule = require("../../../services/guildConfig");
  const originalGet = guildConfigModule.getGuildConfig;
  guildConfigModule.getGuildConfig = async () => ({ analytics_enabled: true });
  try {
    const { getAnalyticsRuntime, _resetForTests } = require("../runtime/getAnalyticsRuntime");
    const xpRuntimeModule = require("../../xp/runtime/getXPRuntime");
    const legacyInviteService = require("../../../services/inviteService");
    const { InMemoryXPRepository } = require("../../xp/persistence/XPRepository");

    _resetForTests();
    xpRuntimeModule._resetForTests();

    const runtime = getAnalyticsRuntime();
    assert.ok(runtime._repository instanceof InMemoryAnalyticsRepository, "offline analytics events must use InMemory storage");
    assert.ok(xpRuntimeModule.getXPRuntime()._repository instanceof InMemoryXPRepository, "offline XP must use InMemory storage");

    // Identité d'instances : la lecture Analytics pointe EXACTEMENT le
    // repository écrit par le runtime XP et par le tracking legacy Invites.
    assert.equal(runtime._service.xpRepository, xpRuntimeModule.getXPRuntime()._repository);
    assert.equal(runtime._service.inviteRepository, legacyInviteService.statsRepository);

    // Un événement écrit via le runtime est visible à la lecture.
    const tracked = await runtime.trackMessage({ guild: { id: "g" }, author: { id: "u1", bot: false } });
    assert.equal(tracked.tracked, true);
    const stats = await runtime.getStats("g");
    assert.equal(stats.messages, 1);

    // Une montée d'XP écrite par le runtime XP est visible dans le top Analytics.
    await xpRuntimeModule.getXPRuntime()._repository.upsert("g", "grinder", 420, 4);

    const topXP = await runtime.getTopXP("g", 5);
    assert.equal(topXP[0].userId, "grinder");
    assert.equal(topXP[0].xp, 420);

    // Une invitation trackée par le service legacy est visible dans le top Analytics.
    await legacyInviteService.statsRepository.addInvite("recruiter", "g");
    const topInvites = await runtime.getTopInvites("g", 5);
    assert.equal(topInvites[0].userId, "recruiter");
    assert.equal(topInvites[0].current, 1);
  } finally {
    guildConfigModule.getGuildConfig = originalGet;
  }
});

test("SupabaseAnalyticsRepository persists and aggregates events via the client", async () => {
  const inserted = [];
  const rows = [
    { event_type: "message", user_id: "u1" },
    { event_type: "message", user_id: "u1" },
    { event_type: "member", user_id: "u2" },
    { event_type: "member", user_id: "u2" },
  ];
  const supabase = {
    from: (table) => {
      assert.equal(table, "analytics_events");
      return {
        insert: async (record) => { inserted.push(record); return { error: null }; },
        select: () => ({ eq: async () => ({ data: rows, error: null }) }),
      };
    },
  };
  const repo = new SupabaseAnalyticsRepository({ supabase });
  await repo.track("g", { type: "message", userId: "u1" });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].guild_id, "g");
  assert.equal(inserted[0].event_type, "message");
  const stats = await repo.getStats("g");
  assert.deepEqual(stats, { messages: 2, members: 1, total: 4 });
});

test("SupabaseAnalyticsRepository requires a client (constructor guard unchanged)", () => {
  assert.throws(() => new SupabaseAnalyticsRepository({}), TypeError);
});

test("AnalyticsService leaderboards stay defensive when a repository lacks the contract", async () => {
  const { AnalyticsService } = require("../services/AnalyticsService");
  const svc = new AnalyticsService({
    configService: { read: async () => ({ analytics_enabled: true }) },
    analyticsRepository: new InMemoryAnalyticsRepository(),
    xpRepository: { upsert: async () => {} }, // no getLeaderboard
    inviteRepository: null,
  });
  assert.deepEqual(await svc.getTopXP("g", 5), []);
  assert.deepEqual(await svc.getTopInvites("g", 5), []);
});
