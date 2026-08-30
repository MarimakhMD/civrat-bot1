"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EntitlementDecision,
  EntitlementFeature,
  EntitlementFeatureList,
  EntitlementService,
  PremiumMutationAuthority,
  PremiumMutationDecision,
  PremiumMutationOperation,
  PremiumMutationPolicy,
  TECHNICAL_PREMIUM_GUILD_ID,
} = require("../../src/core/entitlements");
const { SupabaseEntitlementRepository } = require("../../src/adapters/supabase/SupabaseEntitlementRepository");

const OWNER_ID = "111111111111111111";
const ADMIN_ID = "222222222222222222";
const OTHER_GUILD_ID = "333333333333333333";

class MemoryRepository {
  constructor(rows = []) {
    this.rows = rows.map((row) => ({ ...row }));
    this.calls = [];
  }

  async findFeature(guildId, feature) {
    this.calls.push(["findFeature", guildId, feature]);
    return this.rows.find((row) => row.guild_id === guildId && row.feature_key === feature) || null;
  }

  async listFeatures(guildId) {
    this.calls.push(["listFeatures", guildId]);
    return this.rows.filter((row) => row.guild_id === guildId);
  }

  async listAll() {
    this.calls.push(["listAll"]);
    return this.rows.map((row) => ({ ...row }));
  }

  async activate(record) {
    this.calls.push(["activate", record.guild_id, record.feature_key]);
    const index = this.rows.findIndex((row) => (
      row.guild_id === record.guild_id && row.feature_key === record.feature_key
    ));
    if (index >= 0) this.rows[index] = { ...this.rows[index], ...record };
    else this.rows.push({ ...record });
  }

  async setStatus(guildId, feature, status) {
    this.calls.push(["setStatus", guildId, feature, status]);
  }
}

test("technical guild Premium is permanent and available without a backend", async () => {
  const service = new EntitlementService({ repository: null });

  for (const feature of EntitlementFeatureList) {
    assert.equal(await service.hasFeature({ guildId: TECHNICAL_PREMIUM_GUILD_ID, feature }), true);
    assert.deepEqual(
      await service.requireFeature({ guildId: TECHNICAL_PREMIUM_GUILD_ID, feature }),
      { ok: true, granted: true, code: EntitlementDecision.GRANTED },
    );
    const record = await service.findFeature(TECHNICAL_PREMIUM_GUILD_ID, feature);
    assert.equal(record.status, "active");
    assert.equal(record.ends_at, null);
    assert.equal(record.permanent, true);
  }

  const status = await service.getGuildStatus(TECHNICAL_PREMIUM_GUILD_ID);
  assert.deepEqual(status.map((entry) => entry.feature).sort(), [...EntitlementFeatureList].sort());
  assert.ok(status.every((entry) => entry.active && entry.permanent && entry.endsAt === null));
});

test("direct EntitlementService mutation with Admin authority is refused before repository I/O", async () => {
  const repository = new MemoryRepository();
  const service = new EntitlementService({ repository });

  await assert.rejects(
    service.grantPremium({
      guildId: TECHNICAL_PREMIUM_GUILD_ID,
      feature: EntitlementFeature.TICKET_PREMIUM,
      actorId: ADMIN_ID,
      authority: PremiumMutationAuthority.ADMIN,
    }),
    (error) => error.code === PremiumMutationDecision.ADMIN_READ_ONLY,
  );
  await assert.rejects(
    service.revokePremium({
      guildId: TECHNICAL_PREMIUM_GUILD_ID,
      feature: EntitlementFeature.TICKET_PREMIUM,
      actorId: ADMIN_ID,
      authority: PremiumMutationAuthority.OWNER,
    }),
    (error) => error.code === PremiumMutationDecision.OWNER_AUTHORIZATION_UNAVAILABLE,
  );
  assert.deepEqual(repository.calls, []);
});

test("Supabase adapter rejects an unpermitted technical mutation before touching its client", async () => {
  const clientCalls = [];
  const mutationPolicy = new PremiumMutationPolicy({
    ownerAuthorization: async ({ actorId }) => actorId === OWNER_ID,
  });
  const supabase = {
    from(table) {
      clientCalls.push(["from", table]);
      return {
        upsert: async () => ({ error: null }),
        update: () => ({
          eq: () => ({ eq: async () => ({ error: null }) }),
        }),
      };
    },
  };
  const repository = new SupabaseEntitlementRepository({ supabase, mutationPolicy });
  const record = {
    guild_id: TECHNICAL_PREMIUM_GUILD_ID,
    feature_key: EntitlementFeature.TICKET_PREMIUM,
    status: "active",
  };

  await assert.rejects(
    repository.activate(record),
    (error) => error.code === PremiumMutationDecision.INVALID_PERMIT,
  );
  assert.deepEqual(clientCalls, []);

  const service = new EntitlementService({ repository, mutationPolicy });
  await service.grantPremium({
    guildId: TECHNICAL_PREMIUM_GUILD_ID,
    feature: EntitlementFeature.TICKET_PREMIUM,
    actorId: OWNER_ID,
    authority: PremiumMutationAuthority.OWNER,
  });
  assert.deepEqual(clientCalls, [["from", "guild_entitlements"]]);
});

test("repository permits are operation-bound, short-lived and single-use", async () => {
  const clock = { now: 1000 };
  const policy = new PremiumMutationPolicy({
    ownerAuthorization: async () => true,
    now: () => clock.now,
    permitTtlMs: 10,
  });
  const permit = await policy.authorizeMutation({
    guildId: TECHNICAL_PREMIUM_GUILD_ID,
    feature: EntitlementFeature.TICKET_PREMIUM,
    operation: PremiumMutationOperation.ACTIVATE,
    actorId: OWNER_ID,
    authority: PremiumMutationAuthority.OWNER,
  });

  assert.throws(() => policy.assertRepositoryMutation({
    guildId: TECHNICAL_PREMIUM_GUILD_ID,
    feature: EntitlementFeature.TICKET_PREMIUM,
    operation: PremiumMutationOperation.SET_STATUS,
    permit,
  }), (error) => error.code === PremiumMutationDecision.INVALID_PERMIT);

  assert.equal(policy.assertRepositoryMutation({
    guildId: TECHNICAL_PREMIUM_GUILD_ID,
    feature: EntitlementFeature.TICKET_PREMIUM,
    operation: PremiumMutationOperation.ACTIVATE,
    permit,
  }), true);
  assert.throws(() => policy.assertRepositoryMutation({
    guildId: TECHNICAL_PREMIUM_GUILD_ID,
    feature: EntitlementFeature.TICKET_PREMIUM,
    operation: PremiumMutationOperation.ACTIVATE,
    permit,
  }), (error) => error.code === PremiumMutationDecision.INVALID_PERMIT);

  const expired = await policy.authorizeMutation({
    guildId: TECHNICAL_PREMIUM_GUILD_ID,
    feature: EntitlementFeature.TICKET_PREMIUM,
    operation: PremiumMutationOperation.ACTIVATE,
    actorId: OWNER_ID,
    authority: PremiumMutationAuthority.OWNER,
  });
  clock.now += 11;
  assert.throws(() => policy.assertRepositoryMutation({
    guildId: TECHNICAL_PREMIUM_GUILD_ID,
    feature: EntitlementFeature.TICKET_PREMIUM,
    operation: PremiumMutationOperation.ACTIVATE,
    permit: expired,
  }), (error) => error.code === PremiumMutationDecision.INVALID_PERMIT);
});

test("technical rows from persistence cannot downgrade the effective permanent status", async () => {
  const repository = new MemoryRepository([
    {
      guild_id: TECHNICAL_PREMIUM_GUILD_ID,
      feature_key: EntitlementFeature.TICKET_PREMIUM,
      status: "revoked",
      ends_at: "2000-01-01T00:00:00.000Z",
    },
    {
      guild_id: OTHER_GUILD_ID,
      feature_key: EntitlementFeature.TICKET_PREMIUM,
      status: "active",
      ends_at: null,
    },
  ]);
  const servers = await new EntitlementService({ repository }).listPremiumServers();
  const technical = servers.filter((server) => server.guildId === TECHNICAL_PREMIUM_GUILD_ID);
  assert.equal(technical.length, 1);
  assert.equal(technical[0].active, true);
  assert.equal(technical[0].permanent, true);
  assert.equal(technical[0].endsAt, null);
  assert.equal(servers.some((server) => server.guildId === OTHER_GUILD_ID), true);
});
