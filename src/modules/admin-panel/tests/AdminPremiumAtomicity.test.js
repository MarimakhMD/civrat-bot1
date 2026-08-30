"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EntitlementFeature,
  EntitlementService,
  PremiumMutationAuthority,
  PremiumMutationDecision,
  PremiumMutationPolicy,
  TECHNICAL_PREMIUM_GUILD_ID,
} = require("../../../core/entitlements");
const { AdminPanelService } = require("../services/AdminPanelService");

const OWNER_ID = "111111111111111111";
const ADMIN_ID = "222222222222222222";

class TracedEntitlementRepository {
  constructor() {
    this.calls = [];
    this.rows = [];
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
    return [...this.rows];
  }

  async activate(record) {
    this.calls.push(["activate", record.guild_id, record.feature_key]);
    this.rows.push({ ...record });
  }

  async setStatus(guildId, feature, status) {
    this.calls.push(["setStatus", guildId, feature, status]);
  }
}

function fixture(ownerAuthorization) {
  const entitlementRepository = new TracedEntitlementRepository();
  const historyRepository = {
    entries: [],
    append: async function append(entry) { this.entries.push({ ...entry }); },
    listByGuild: async () => [],
  };
  const auditRepository = {
    entries: [],
    append: async function append(entry) { this.entries.push({ ...entry }); },
    list: async () => [],
    count: async () => 0,
  };
  const mutationPolicy = new PremiumMutationPolicy({ ownerAuthorization });
  const entitlementService = new EntitlementService({
    repository: entitlementRepository,
    mutationPolicy,
    now: () => new Date("2030-01-01T00:00:00.000Z"),
  });
  const service = new AdminPanelService({
    entitlementService,
    historyRepository,
    auditRepository,
    now: () => Date.parse("2030-01-01T00:00:00.000Z"),
  });
  return { service, entitlementRepository, historyRepository, auditRepository };
}

function assertNoSideEffect(value) {
  assert.deepEqual(value.entitlementRepository.calls, []);
  assert.deepEqual(value.historyRepository.entries, []);
  assert.deepEqual(value.auditRepository.entries, []);
}

test("Admin activation, removal and revocation of technical Premium are side-effect free", async () => {
  const value = fixture(async () => false);
  const common = {
    actorId: ADMIN_ID,
    guildId: TECHNICAL_PREMIUM_GUILD_ID,
    plan: EntitlementFeature.TICKET_PREMIUM,
    authority: PremiumMutationAuthority.ADMIN,
  };

  for (const result of [
    await value.service.activatePremium(common),
    await value.service.removePremium(common),
    await value.service.revokePremiumForAbuse({ ...common, reason: "forged" }),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.code, PremiumMutationDecision.ADMIN_READ_ONLY);
  }
  assertNoSideEffect(value);
});

test("an Owner session expiring between preflight and service authorization cannot partially mutate", async () => {
  let checks = 0;
  const value = fixture(async ({ actorId }) => {
    checks += 1;
    return actorId === OWNER_ID && checks === 1;
  });

  const result = await value.service.activatePremium({
    actorId: OWNER_ID,
    guildId: TECHNICAL_PREMIUM_GUILD_ID,
    plan: EntitlementFeature.TICKET_PREMIUM,
    authority: PremiumMutationAuthority.OWNER,
  });

  assert.equal(checks, 2, "authorization is checked at preflight and again at mutation");
  assert.equal(result.ok, false);
  assert.equal(result.code, PremiumMutationDecision.OWNER_SESSION_REQUIRED);
  assertNoSideEffect(value);
});

test("a currently authenticated Owner produces one entitlement write, one history entry and one audit entry", async () => {
  const value = fixture(async ({ actorId }) => actorId === OWNER_ID);
  const result = await value.service.activatePremium({
    actorId: OWNER_ID,
    guildId: TECHNICAL_PREMIUM_GUILD_ID,
    plan: EntitlementFeature.TICKET_PREMIUM,
    authority: PremiumMutationAuthority.OWNER,
  });

  assert.equal(result.ok, true);
  assert.equal(result.permanent, true);
  assert.deepEqual(value.entitlementRepository.calls, [
    ["activate", TECHNICAL_PREMIUM_GUILD_ID, EntitlementFeature.TICKET_PREMIUM],
  ]);
  assert.equal(value.historyRepository.entries.length, 1);
  assert.equal(value.historyRepository.entries[0].actorId, OWNER_ID);
  assert.equal(value.auditRepository.entries.length, 1);
  assert.equal(value.auditRepository.entries[0].action, "premium.activate");
});
