"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EntitlementService } = require("../../../core/entitlements");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { OwnerPanelStateStore } = require("../../owner-panel/services/OwnerPanelStateStore");
const { CivratIdentityService } = require("../../owner-panel/services/CivratIdentityService");
const { OwnerPanelService } = require("../../owner-panel/services/OwnerPanelService");
const { AdminPanelService } = require("../services/AdminPanelService");
const { TechnicalAdminProvider } = require("../services/TechnicalAdminProvider");
const { registerAdminPanel } = require("../register");
const { AdminPanelComponentId } = require("../configuration/adminPanelConstants");
const { OwnerPanelComponentId, OwnerPanelFieldId } = require("../../owner-panel/configuration/ownerPanelConstants");
const adminPanelRoutes = require("../interactions/adminPanelRoutes");
const adminEn = require("../translations/en.json");
const ownerEn = require("../../owner-panel/translations/en.json");
const recoveryEn = require("../../recovery/translations/en.json");

const GUILD_ID = "1320817768962064384";
const CHANNEL_ID = "1542957356382552154";
const ROLE_ID = "1542958959907053688";
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
  async removeAdmin(id) { this.adminIds = this.adminIds.filter((entry) => entry !== id); }
  async transferOwnership({ newOwnerId }) { this.ownerId = newOwnerId; this.adminIds = this.adminIds.filter((entry) => entry !== newOwnerId); }
}

class InMemoryEntitlementRepository {
  async findFeature() { return null; }
  async listFeatures() { return []; }
  async listAll() { return []; }
  async activate(record) { return record; }
  async setStatus() { return null; }
}

const dictionaries = { ...adminEn, ...ownerEn, ...recoveryEn };
function t(key, vars) {
  const raw = key.split(".").reduce((value, segment) => (value ? value[segment] : undefined), dictionaries);
  return typeof raw === "string"
    ? raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name) => String(vars?.[name] ?? ""))
    : key;
}

function makeRuntime({ ownerId = OWNER_ID, adminIds = [] } = {}) {
  const clock = { now: 1_700_000_000_000 };
  const state = new OwnerPanelStateStore();
  const env = {
    civratOwnerId: () => ownerId,
    panelMasterCode: () => FAKE_CODE,
    transferCode: () => FAKE_CODE,
  };
  const repository = new InMemoryIdentityRepository({ adminIds });
  const identity = new CivratIdentityService({ repository, env });
  const panel = new OwnerPanelService({ state, env, now: () => clock.now });
  const admin = new AdminPanelService({
    entitlementService: new EntitlementService({
      repository: new InMemoryEntitlementRepository(),
      now: () => new Date(clock.now),
    }),
    historyRepository: { append: async () => {}, listByGuild: async () => [] },
    auditRepository: { append: async () => {}, list: async () => [], count: async () => 0 },
  });
  const technicalAdminProvider = new TechnicalAdminProvider({
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    roleId: ROLE_ID,
  });
  const runtime = {
    identity,
    panel,
    state,
    admin,
    technicalAdminProvider,
    system: {},
    hasRecoveryElevation: () => false,
    recoveryServiceFactory: () => ({}),
  };
  return { runtime, identity, panel, state, repository, clock };
}

function makeContext({
  userId,
  guildId = GUILD_ID,
  channelId = CHANNEL_ID,
  hasRole = true,
  modalValues = {},
} = {}) {
  const sent = { replies: [], updates: [], modals: [] };
  const guilds = new Map();
  const context = {
    userId,
    guildId,
    channelId,
    member: { hasRole: (roleId) => hasRole && roleId === ROLE_ID },
    t,
    envelope: {
      modalValues,
      values: [],
      customId: "",
      discordClient: { guilds: { cache: guilds } },
      transport: {
        reply: async (payload) => { sent.replies.push(payload); },
        update: async (payload) => { sent.updates.push(payload); },
        showModal: async (modal) => { sent.modals.push(modal); },
      },
    },
  };
  return { context, sent };
}

test("technical role grants Admin tools without a persisted identity or Owner session", async () => {
  const fixture = makeRuntime();
  const { context, sent } = makeContext({ userId: ADMIN_ID });
  assert.equal(await adminPanelRoutes.requireOperationalAccess(context, fixture.runtime), true);
  assert.equal(fixture.panel.authenticate(ADMIN_ID), false);
  await adminPanelRoutes.openDashboard(context, fixture.runtime);
  assert.equal(sent.replies[0].view.title, t("adminpanel.dashboardTitle"));
  assert.equal(JSON.stringify(sent.replies[0]).includes(AdminPanelComponentId.OWNER), false);
});

test("guild, channel, and role are each mandatory and refusals are identical", async () => {
  const fixture = makeRuntime();
  const denied = [
    makeContext({ userId: ADMIN_ID, guildId: "999999999999999999" }),
    makeContext({ userId: ADMIN_ID, channelId: "999999999999999999" }),
    makeContext({ userId: ADMIN_ID, hasRole: false }),
  ];
  for (const { context, sent } of denied) {
    assert.equal(await adminPanelRoutes.requireOperationalAccess(context, fixture.runtime), false);
    assert.equal(sent.replies[0].view.content, t("adminpanel.refused"));
    assert.equal(sent.replies[0].ephemeral, true);
    assert.deepEqual(sent.replies[0].view.components, []);
  }
});

test("true Owner keeps Admin tools and alone sees the Owner entry", async () => {
  const fixture = makeRuntime();
  const { context, sent } = makeContext({ userId: OWNER_ID });
  await adminPanelRoutes.openDashboard(context, fixture.runtime);
  assert.ok(JSON.stringify(sent.replies[0]).includes(AdminPanelComponentId.OWNER));
  assert.equal(fixture.panel.authenticate(OWNER_ID), false, "Admin tools do not require the Owner secret");
});

test("Owner section rejects non-Owner and requires the env-only Master Code", async () => {
  const fixture = makeRuntime();
  const nonOwner = makeContext({ userId: ADMIN_ID });
  await adminPanelRoutes.openOwner(nonOwner.context, fixture.runtime);
  assert.equal(nonOwner.sent.replies[0].view.content, t("adminpanel.refused"));
  assert.equal(nonOwner.sent.modals.length, 0);

  const owner = makeContext({ userId: OWNER_ID });
  await adminPanelRoutes.openOwner(owner.context, fixture.runtime);
  assert.equal(owner.sent.modals[0].customId, OwnerPanelComponentId.MASTER_SUBMIT);

  const wrong = makeContext({ userId: OWNER_ID, modalValues: { [OwnerPanelFieldId.MASTER]: "wrong" } });
  await adminPanelRoutes.submitOwnerMaster(wrong.context, fixture.runtime);
  assert.equal(wrong.sent.replies[0].view.content, t("adminpanel.refused"));
  assert.equal(fixture.panel.authenticate(OWNER_ID), false);

  const correct = makeContext({ userId: OWNER_ID, modalValues: { [OwnerPanelFieldId.MASTER]: FAKE_CODE } });
  await adminPanelRoutes.submitOwnerMaster(correct.context, fixture.runtime);
  assert.equal(fixture.panel.authenticate(OWNER_ID), true);
  assert.ok(JSON.stringify(correct.sent).includes(OwnerPanelComponentId.ADD_ADMIN));
  assert.equal(JSON.stringify(correct.sent).includes(FAKE_CODE), false, "secret must never be rendered or persisted in a component");
});

test("Owner identity service still blocks Admin role holders from Owner mutations", async () => {
  const fixture = makeRuntime({ adminIds: [ADMIN_ID] });
  assert.equal((await fixture.identity.addAdmin({ actorId: ADMIN_ID, targetId: TARGET_ID })).code, "OWNER_ONLY");
  assert.equal((await fixture.identity.removeAdmin({ actorId: ADMIN_ID, targetId: ADMIN_ID })).code, "OWNER_ONLY");
  assert.equal((await fixture.identity.transferOwnership({ actorId: ADMIN_ID, newOwnerId: TARGET_ID })).code, "OWNER_ONLY");
  assert.equal(await fixture.identity.getOwnerId(), OWNER_ID);
});

test("registry applies CIVRAT_ADMIN everywhere and CIVRAT_OWNER to Owner actions", () => {
  const registry = new InteractionRegistry();
  registerAdminPanel({ registry, runtimeFactory: () => ({}) });

  const command = registry.find({ kind: "command", name: "admin" });
  assert.deepEqual(command.permissions.allOf, [PermissionName.CIVRAT_ADMIN]);

  const adminRoute = registry.find({ kind: "button", customId: AdminPanelComponentId.PREMIUM });
  assert.deepEqual(adminRoute.permissions.allOf, [PermissionName.CIVRAT_ADMIN]);

  for (const customId of [OwnerPanelComponentId.ADD_ADMIN, OwnerPanelComponentId.REMOVE_ADMIN, OwnerPanelComponentId.TRANSFER]) {
    const route = registry.find({ kind: "button", customId });
    assert.deepEqual(route.permissions.allOf, [PermissionName.CIVRAT_ADMIN, PermissionName.CIVRAT_OWNER]);
  }
});
