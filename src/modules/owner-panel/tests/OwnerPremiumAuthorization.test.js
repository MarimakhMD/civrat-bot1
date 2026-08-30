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
const { RecoveryPolicy } = require("../../recovery/configuration/recoveryConstants");
const { RecoveryCodeStore } = require("../../recovery/services/RecoveryCodeStore");
const { OwnerPanelStateStore } = require("../services/OwnerPanelStateStore");
const { CivratIdentityService } = require("../services/CivratIdentityService");
const { OwnerPanelService } = require("../services/OwnerPanelService");

const OWNER_ID = "111111111111111111";
const ADMIN_ID = "222222222222222222";
const RECOVERED_ID = "333333333333333333";
const NEW_OWNER_ID = "444444444444444444";
const PANEL_CODE = "offline-owner-panel-code";

class IdentityRepository {
  constructor() {
    this.ownerId = OWNER_ID;
    this.adminIds = [ADMIN_ID];
  }

  async readOwnerId() { return this.ownerId; }
  async readAdminIds() { return [...this.adminIds]; }
  async addAdmin(userId) { this.adminIds.push(userId); }
  async removeAdmin(userId) { this.adminIds = this.adminIds.filter((id) => id !== userId); }
  async transferOwnership({ newOwnerId }) {
    this.ownerId = newOwnerId;
    this.adminIds = this.adminIds.filter((id) => id !== newOwnerId);
  }
}

function fixture() {
  const clock = { now: 1_000_000 };
  const state = new OwnerPanelStateStore();
  const recoveryStore = new RecoveryCodeStore();
  const repository = new IdentityRepository();
  const env = {
    civratOwnerId: () => OWNER_ID,
    panelMasterCode: () => PANEL_CODE,
    transferCode: () => "offline-transfer-code",
  };
  const identity = new CivratIdentityService({
    repository,
    env,
    elevation: {
      isActive: (userId) => recoveryStore.hasActiveElevation(userId, clock.now),
      consume: (userId) => recoveryStore.clearElevation(userId),
    },
    onOwnershipTransferred: (previousOwnerId) => state.revokeSession(previousOwnerId),
  });
  const panel = new OwnerPanelService({ state, env, now: () => clock.now });
  const mutationPolicy = new PremiumMutationPolicy({
    ownerAuthorization: ({ actorId }) => panel.authorizePremiumMutation({
      actorId,
      identityService: identity,
    }),
  });
  const entitlementRepository = {
    writes: [],
    activate: async function activate(record) { this.writes.push(["activate", record.guild_id]); },
    setStatus: async function setStatus(guildId) { this.writes.push(["setStatus", guildId]); },
    findFeature: async () => null,
    listFeatures: async () => [],
    listAll: async () => [],
  };
  const entitlementService = new EntitlementService({
    repository: entitlementRepository,
    mutationPolicy,
  });
  return {
    clock,
    state,
    recoveryStore,
    repository,
    identity,
    panel,
    entitlementRepository,
    entitlementService,
  };
}

async function attempt(value, actorId) {
  try {
    await value.entitlementService.grantPremium({
      guildId: TECHNICAL_PREMIUM_GUILD_ID,
      feature: EntitlementFeature.TICKET_PREMIUM,
      actorId,
      authority: PremiumMutationAuthority.OWNER,
    });
    return "ALLOWED";
  } catch (error) {
    return error.code;
  }
}

test("the real Owner without an active Owner session cannot mutate technical Premium", async () => {
  const value = fixture();
  assert.equal(await value.identity.isOwner(OWNER_ID), true);
  assert.equal(value.panel.authenticate(OWNER_ID), false);
  assert.equal(await attempt(value, OWNER_ID), PremiumMutationDecision.OWNER_SESSION_REQUIRED);
  assert.deepEqual(value.entitlementRepository.writes, []);
});

test("an Admin cannot gain Premium authority even with a valid Master Code session", async () => {
  const value = fixture();
  assert.equal(value.panel.tryAuthenticate(ADMIN_ID, PANEL_CODE).ok, true);
  assert.equal(value.panel.authenticate(ADMIN_ID), true);
  assert.equal(await value.identity.isAdmin(ADMIN_ID), true);
  assert.equal(await attempt(value, ADMIN_ID), PremiumMutationDecision.OWNER_SESSION_REQUIRED);
  assert.deepEqual(value.entitlementRepository.writes, []);
});

test("Recovery elevation never substitutes for Owner identity and Owner session", async () => {
  const value = fixture();
  value.recoveryStore.setElevation(RECOVERED_ID, value.clock.now + RecoveryPolicy.ELEVATION_WINDOW_MS);
  assert.equal(value.recoveryStore.hasActiveElevation(RECOVERED_ID, value.clock.now), true);
  assert.equal(await attempt(value, RECOVERED_ID), PremiumMutationDecision.OWNER_SESSION_REQUIRED);
  assert.deepEqual(value.entitlementRepository.writes, []);
});

test("the true Owner with a live session can mutate through the single EntitlementService", async () => {
  const value = fixture();
  assert.equal(value.panel.tryAuthenticate(OWNER_ID, PANEL_CODE, { isOwner: true }).ok, true);
  assert.equal(await attempt(value, OWNER_ID), "ALLOWED");
  assert.deepEqual(value.entitlementRepository.writes, [["activate", TECHNICAL_PREMIUM_GUILD_ID]]);
});

test("session expiry closes Premium mutation without changing Owner identity", async () => {
  const value = fixture();
  value.panel.tryAuthenticate(OWNER_ID, PANEL_CODE, { isOwner: true });
  value.clock.now += value.panel.policy.OWNER_SESSION_TTL_MS + 1;
  assert.equal(await value.identity.isOwner(OWNER_ID), true);
  assert.equal(value.panel.authenticate(OWNER_ID), false);
  assert.equal(await attempt(value, OWNER_ID), PremiumMutationDecision.OWNER_SESSION_REQUIRED);
  assert.deepEqual(value.entitlementRepository.writes, []);
});

test("after ownership transfer neither the old nor new Owner inherits a mutation session", async () => {
  const value = fixture();
  value.panel.tryAuthenticate(OWNER_ID, PANEL_CODE, { isOwner: true });
  assert.equal((await value.identity.transferOwnership({ actorId: OWNER_ID, newOwnerId: NEW_OWNER_ID })).ok, true);
  assert.equal(value.panel.authenticate(OWNER_ID), false);
  assert.equal(value.panel.authenticate(NEW_OWNER_ID), false);
  assert.equal(await attempt(value, OWNER_ID), PremiumMutationDecision.OWNER_SESSION_REQUIRED);
  assert.equal(await attempt(value, NEW_OWNER_ID), PremiumMutationDecision.OWNER_SESSION_REQUIRED);

  value.panel.tryAuthenticate(NEW_OWNER_ID, PANEL_CODE, { isOwner: true });
  assert.equal(await attempt(value, NEW_OWNER_ID), "ALLOWED");
  assert.deepEqual(value.entitlementRepository.writes, [["activate", TECHNICAL_PREMIUM_GUILD_ID]]);
});
