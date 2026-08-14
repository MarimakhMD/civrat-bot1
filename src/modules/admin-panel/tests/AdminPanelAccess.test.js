"use strict";

// Séparation stricte Owner / Admin pour le CIVRAT Admin Panel.
// - Admin = accès opérationnel permanent (sans session, sans code) ;
// - Admin retiré => accès immédiatement refusé ;
// - Admin ne peut JAMAIS gérer les Admins ni transférer le Owner ;
// - les routes d'identité restent CIVRAT_OWNER ;
// - Owner authentifié => accès opérationnel ; sans session => refus.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EntitlementService } = require("../../../core/entitlements");
const { OwnerPanelStateStore } = require("../../owner-panel/services/OwnerPanelStateStore");
const { CivratIdentityService } = require("../../owner-panel/services/CivratIdentityService");
const { OwnerPanelService } = require("../../owner-panel/services/OwnerPanelService");
const { AdminPanelService } = require("../services/AdminPanelService");
const adminPanelRoutes = require("../interactions/adminPanelRoutes");
const ownerPanelRoutes = require("../../owner-panel/interactions/ownerPanelRoutes");
const { registerOwnerPanel } = require("../../owner-panel/register");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const adminEn = require("../translations/en.json");

const OWNER_ID = "111111111111111111";
const ADMIN_ID = "222222222222222222";
const MEMBER_ID = "333333333333333333";
const TARGET_ID = "444444444444444444";
const FAKE_CODE = "fake-panel-code-for-tests";

class InMemoryIdentityRepository {
  constructor({ ownerId = null, adminIds = [] } = {}) { this.ownerId = ownerId; this.adminIds = [...adminIds]; }
  async readOwnerId() { return this.ownerId; }
  async readAdminIds() { return [...this.adminIds]; }
  async addAdmin(id) { if (!this.adminIds.includes(id)) this.adminIds.push(id); }
  async removeAdmin(id) { this.adminIds = this.adminIds.filter((a) => a !== id); }
  async transferOwnership({ newOwnerId }) { this.ownerId = newOwnerId; this.adminIds = this.adminIds.filter((a) => a !== newOwnerId); }
}

class InMemoryEntitlementRepository {
  constructor() { this.rows = []; }
  async findFeature() { return null; }
  async listFeatures() { return []; }
  async listAll() { return []; }
  async activate(record) { this.rows.push({ ...record }); }
  async setStatus() {}
}

function t(key, vars) {
  const raw = key.split(".").reduce((v, s) => (v ? v[s] : undefined), adminEn);
  return typeof raw === "string" ? raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, n) => String(vars?.[n] ?? "")) : raw;
}

function makeRuntime({ ownerId = OWNER_ID, adminIds = [] } = {}) {
  const clock = { now: 1_700_000_000_000 };
  const state = new OwnerPanelStateStore();
  const env = { civratOwnerId: () => ownerId, panelMasterCode: () => FAKE_CODE, transferCode: () => FAKE_CODE };
  const repository = new InMemoryIdentityRepository({ ownerId: null, adminIds });
  const identity = new CivratIdentityService({ repository, env });
  const panel = new OwnerPanelService({ state, env, now: () => clock.now });
  const admin = new AdminPanelService({
    entitlementService: new EntitlementService({ repository: new InMemoryEntitlementRepository(), now: () => new Date(clock.now) }),
    historyRepository: { append: async () => {}, listByGuild: async () => [], listRecent: async () => [] },
    auditRepository: { append: async () => {}, list: async () => [], count: async () => 0 },
  });
  const runtime = { identity, panel, state, admin, hasRecoveryElevation: () => false };
  runtime.adminPanel = { openDashboard: (context) => adminPanelRoutes.openDashboard(context, runtime) };
  return { runtime, identity, panel, state, admin, repository, clock };
}

function makeContext({ userId, modalValues = {} } = {}) {
  const sent = { replies: [], updates: [], modals: [] };
  const context = {
    userId,
    guildId: "g1",
    t,
    envelope: {
      modalValues,
      values: [],
      customId: "",
      discordClient: { guilds: { cache: { size: 3, get: () => ({ name: "Server" }) } } },
      transport: {
        reply: async (p) => { sent.replies.push(p); },
        update: async (p) => { sent.updates.push(p); },
        showModal: async (m) => { sent.modals.push(m); },
      },
    },
  };
  return { context, sent };
}

test("admin has permanent access without any session", async () => {
  const f = makeRuntime({ adminIds: [ADMIN_ID] });
  const { context, sent } = makeContext({ userId: ADMIN_ID });
  assert.equal(await adminPanelRoutes.requireOperationalAccess(context, f.runtime), true);
  assert.equal(f.panel.authenticate(ADMIN_ID), false, "admin holds no session");
  await adminPanelRoutes.openDashboard(context, f.runtime);
  assert.equal(sent.replies.length, 1);
  assert.ok(sent.replies[0].view.content.includes(t("adminpanel.dashboardTitle")));
});

test("removed admin is immediately refused", async () => {
  const f = makeRuntime({ adminIds: [ADMIN_ID] });
  const { context, sent } = makeContext({ userId: ADMIN_ID });
  assert.equal(await adminPanelRoutes.requireOperationalAccess(context, f.runtime), true);
  await f.identity.removeAdmin({ actorId: OWNER_ID, targetId: ADMIN_ID });
  assert.equal(await adminPanelRoutes.requireOperationalAccess(context, f.runtime), false, "access revoked after removal");
  await adminPanelRoutes.openDashboard(context, f.runtime);
  assert.equal(sent.replies[0].view.content, t("adminpanel.refused"));
});

test("owner without a session cannot use operational routes; with session it works", async () => {
  const f = makeRuntime();
  const { context, sent } = makeContext({ userId: OWNER_ID });
  assert.equal(await adminPanelRoutes.requireOperationalAccess(context, f.runtime), false, "owner needs the master-code session");
  await adminPanelRoutes.openDashboard(context, f.runtime);
  assert.equal(sent.replies[0].view.content, t("adminpanel.refused"));
  f.panel.tryAuthenticate(OWNER_ID, FAKE_CODE, { isOwner: true });
  assert.equal(await adminPanelRoutes.requireOperationalAccess(context, f.runtime), true, "authenticated owner allowed");
});

test("a plain member is refused", async () => {
  const f = makeRuntime({ adminIds: [ADMIN_ID] });
  const { context, sent } = makeContext({ userId: MEMBER_ID });
  await adminPanelRoutes.openDashboard(context, f.runtime);
  assert.equal(sent.replies[0].view.content, t("adminpanel.refused"));
});

test("an admin can never manage admins or transfer ownership (service barriers)", async () => {
  const f = makeRuntime({ adminIds: [ADMIN_ID] });
  assert.equal((await f.identity.addAdmin({ actorId: ADMIN_ID, targetId: TARGET_ID })).code, "OWNER_ONLY");
  assert.equal((await f.identity.removeAdmin({ actorId: ADMIN_ID, targetId: ADMIN_ID })).code, "OWNER_ONLY");
  assert.equal((await f.identity.transferOwnership({ actorId: ADMIN_ID, newOwnerId: TARGET_ID })).code, "OWNER_ONLY");
  assert.equal((await f.identity.transferOwnershipViaRecovery({ actorId: ADMIN_ID, newOwnerId: TARGET_ID })).code, "RECOVERY_ELEVATION_REQUIRED");
  assert.equal(await f.identity.getOwnerId(), OWNER_ID, "owner unchanged");
});

test("identity action routes stay CIVRAT_OWNER (admin can never reach them)", () => {
  const registry = new InteractionRegistry();
  registerOwnerPanel({ registry, runtimeFactory: () => ({}) });
  for (const customId of ["civrat:v1:ownerpanel:admin:add", "civrat:v1:ownerpanel:admin:remove", "civrat:v1:ownerpanel:transfer"]) {
    const route = registry.find({ kind: "button", customId });
    assert.ok(route, `${customId} registered`);
    assert.deepEqual(route.permissions.allOf, [PermissionName.CIVRAT_OWNER], `${customId} stays owner-only`);
  }
});

test("admin opening /ownerpanel lands on the operational dashboard", async () => {
  const f = makeRuntime({ adminIds: [ADMIN_ID] });
  const { context, sent } = makeContext({ userId: ADMIN_ID });
  await ownerPanelRoutes.openOwnerPanel(context, f.runtime);
  assert.equal(sent.modals.length, 0, "no master modal for an admin");
  assert.equal(sent.replies.length, 1);
  assert.ok(sent.replies[0].view.content.includes(t("adminpanel.dashboardTitle")), "admin lands on the dashboard");
});
