"use strict";

// Admin Panel — routes (dashboard, premium, serveurs, audit, modales).
// Offline : runtime réel (identity + service) avec repositories en mémoire.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EntitlementService,
  EntitlementFeature,
  TECHNICAL_PREMIUM_GUILD_ID,
} = require("../../../core/entitlements");
const { OwnerPanelStateStore } = require("../../owner-panel/services/OwnerPanelStateStore");
const { CivratIdentityService } = require("../../owner-panel/services/CivratIdentityService");
const { OwnerPanelService } = require("../../owner-panel/services/OwnerPanelService");
const { AdminPanelService } = require("../services/AdminPanelService");
const { AdminSystemService } = require("../services/AdminSystemService");
const routes = require("../interactions/adminPanelRoutes");
const { AdminPanelComponentId: Id, AdminPanelFieldId: Field } = require("../configuration/adminPanelConstants");
const { RecoveryComponentId, RecoveryFieldId } = require("../../recovery/configuration/recoveryConstants");
const { toActionRows } = require("../../../adapters/discord/DiscordResponseTransport");
const adminEn = require("../translations/en.json");

const ADMIN_ID = "222222222222222222";
const GUILD_A = "111111111111111111";
const GUILD_B = "333333333333333333";
const FAKE_CODE = "fake-panel-code-for-tests";

class InMemoryEntitlementRepository {
  constructor(rows = []) { this.rows = rows.map((r) => ({ ...r })); }
  async findFeature(g, f) { return this.rows.find((r) => r.guild_id === g && r.feature_key === f) || null; }
  async listFeatures(g) { return this.rows.filter((r) => r.guild_id === g); }
  async listAll() { return [...this.rows]; }
  async activate(record) {
    const i = this.rows.findIndex((r) => r.guild_id === record.guild_id && r.feature_key === record.feature_key);
    if (i >= 0) this.rows[i] = { ...this.rows[i], ...record }; else this.rows.push({ ...record });
  }
  async setStatus(g, f, status) { const r = this.rows.find((x) => x.guild_id === g && x.feature_key === f); if (r) r.status = status; }
}
class InMemoryHistoryRepository {
  constructor() { this.entries = []; }
  async append(e) { this.entries.push({ ...e, created_at: new Date().toISOString() }); }
  async listByGuild(g, { limit = 20, offset = 0 } = {}) { return this.entries.filter((e) => e.guildId === g).slice().reverse().slice(offset, offset + limit); }
  async listRecent({ limit = 20 } = {}) { return this.entries.slice().reverse().slice(0, limit); }
}
class InMemoryAuditRepository {
  constructor() { this.entries = []; }
  async append(e) { this.entries.push({ ...e, created_at: new Date().toISOString() }); }
  async list({ limit = 20, offset = 0, guildId = null } = {}) { return this.entries.filter((e) => !guildId || e.guildId === guildId).slice().reverse().slice(offset, offset + limit); }
  async count({ guildId = null } = {}) { return this.entries.filter((e) => !guildId || e.guildId === guildId).length; }
}

function t(key, vars) {
  const raw = key.split(".").reduce((v, s) => (v ? v[s] : undefined), adminEn);
  return typeof raw === "string" ? raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, n) => String(vars?.[n] ?? "")) : raw;
}

function makeRuntime({ adminIds = [ADMIN_ID], entitlementRepository = new InMemoryEntitlementRepository() } = {}) {
  const clock = { now: 1_700_000_000_000 };
  const state = new OwnerPanelStateStore();
  const env = { civratOwnerId: () => "111111111111111111", panelMasterCode: () => FAKE_CODE, transferCode: () => FAKE_CODE };
  const identity = new CivratIdentityService({
    repository: { readOwnerId: async () => null, readAdminIds: async () => [...adminIds], addAdmin: async () => {}, removeAdmin: async () => {}, transferOwnership: async () => {} },
    env,
  });
  const panel = new OwnerPanelService({ state, env, now: () => clock.now });
  const entitlementService = new EntitlementService({ repository: entitlementRepository, now: () => new Date(clock.now) });
  entitlementService.configurePremiumOwnerAuthorization(({ actorId }) => (
    panel.authorizePremiumMutation({ actorId, identityService: identity })
  ));
  const admin = new AdminPanelService({
    entitlementService,
    historyRepository: new InMemoryHistoryRepository(),
    auditRepository: new InMemoryAuditRepository(),
    analyticsReader: { getGlobalStats: async () => ({ messages: 1, members: 1, servers: 1 }), getServerStats: async () => ({ messages: 1, members: 1, total: 2 }) },
  });
  const system = new AdminSystemService({
    technicalConfig: { guildId: GUILD_A, channelId: "555555555555555555", roleId: "666666666666666666" },
    configurationReader: async () => ({ config: { language: "en", tickets_enabled: true }, available: true, found: true, source: "database" }),
    entitlementService,
    now: () => clock.now,
    startedAt: clock.now - 5000,
  });
  return {
    runtime: {
      identity,
      panel,
      state,
      admin,
      system,
      technicalAdminProvider: { isAdmin: async () => true },
      hasRecoveryElevation: () => false,
      recoveryServiceFactory: () => ({ requestRecovery: async () => ({ requested: true }), verifyRecovery: async () => ({ recovered: false }) }),
    },
    clock,
  };
}

function makeContext({ userId = ADMIN_ID, modalValues = {}, values = [], customId = "" } = {}) {
  const sent = { replies: [], updates: [], modals: [] };
  const cache = new Map([
    [GUILD_A, { id: GUILD_A, name: "Alpha", memberCount: 10 }],
    [GUILD_B, { id: GUILD_B, name: "Beta", memberCount: 20 }],
  ]);
  const context = {
    userId, guildId: GUILD_A, channelId: "555555555555555555", member: { hasRole: () => true }, t,
    envelope: {
      modalValues, values, customId,
      discordClient: { isReady: () => true, guilds: { cache } },
      transport: {
        reply: async (p) => { sent.replies.push(p); },
        update: async (p) => { sent.updates.push(p); },
        showModal: async (m) => { sent.modals.push(m); },
      },
    },
  };
  return { context, sent };
}

test("dashboard renders with nav buttons and packs within Discord limits", async () => {
  const { runtime } = makeRuntime();
  const { context, sent } = makeContext();
  await routes.openDashboard(context, runtime);
  const view = sent.replies[0].view;
  assert.ok(view.content.includes(t("adminpanel.dashboardDescription")));
  assert.deepEqual(view.components.map((c) => c.customId), [
    Id.SERVERS,
    Id.DIAGNOSTICS,
    Id.CONFIGURATION,
    Id.PREMIUM,
    Id.AUDIT,
    Id.RECOVERY,
    Id.REFRESH,
  ]);
  assert.ok(toActionRows(view.components).length <= 5, "dashboard packs within 5 action rows");
});

test("installations, diagnostics, and configuration render only available data", async () => {
  const { runtime } = makeRuntime();

  const installations = makeContext();
  await routes.openServers(installations.context, runtime);
  assert.ok(installations.sent.replies[0].view.content.includes("Alpha"));
  assert.ok(installations.sent.replies[0].view.content.includes(GUILD_B));

  const diagnostics = makeContext();
  await routes.openDiagnostics(diagnostics.context, runtime);
  assert.ok(diagnostics.sent.replies[0].view.content.includes("5s"));
  assert.ok(diagnostics.sent.replies[0].view.content.includes(t("adminpanel.available")));

  const configuration = makeContext();
  await routes.openConfiguration(configuration.context, runtime);
  assert.ok(configuration.sent.replies[0].view.content.includes("TICKET".toLowerCase()));
  assert.ok(configuration.sent.replies[0].view.content.includes(GUILD_A));
});

test("premium view lists servers with a select menu and pagination buttons", async () => {
  const { runtime } = makeRuntime();
  await runtime.admin.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  await runtime.admin.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_B, plan: EntitlementFeature.WELCOME_IMAGE });
  const { context, sent } = makeContext();
  await routes.openPremium(context, runtime);
  const view = sent.replies[0].view;
  assert.ok(view.content.includes(GUILD_A));
  assert.equal(view.components.find((c) => c.type === "select").options.length, 3);
  assert.ok(toActionRows(view.components).length <= 5);
});

test("technical Premium detail is read-only for Admin and mutable only for an authenticated Owner", async () => {
  const { runtime } = makeRuntime();

  const admin = makeContext({
    userId: ADMIN_ID,
    modalValues: { [Field.GUILD_ID]: TECHNICAL_PREMIUM_GUILD_ID },
  });
  await routes.submitSearch(admin.context, runtime);
  const adminView = admin.sent.replies[0].view;
  assert.match(adminView.content, /read-only/i);
  assert.equal(adminView.components.some((component) => component.customId.startsWith(Id.ACTIVATE_PREFIX)), false);
  assert.equal(adminView.components.some((component) => component.customId.startsWith(Id.REMOVE_PREFIX)), false);
  assert.equal(adminView.components.some((component) => component.customId.startsWith(Id.REVOKE_PREFIX)), false);

  const ownerId = GUILD_A;
  runtime.panel.tryAuthenticate(ownerId, FAKE_CODE, { isOwner: true });
  const owner = makeContext({
    userId: ownerId,
    modalValues: { [Field.GUILD_ID]: TECHNICAL_PREMIUM_GUILD_ID },
  });
  await routes.submitSearch(owner.context, runtime);
  const ownerIds = owner.sent.replies[0].view.components.map((component) => component.customId);
  assert.ok(ownerIds.includes(`${Id.ACTIVATE_PREFIX}${TECHNICAL_PREMIUM_GUILD_ID}`));
  assert.ok(ownerIds.includes(`${Id.REMOVE_PREFIX}${TECHNICAL_PREMIUM_GUILD_ID}`));
  assert.ok(ownerIds.includes(`${Id.REVOKE_PREFIX}${TECHNICAL_PREMIUM_GUILD_ID}`));
});

test("premium outage is shown as unavailable, never as an empty subscription list", async () => {
  const repository = new InMemoryEntitlementRepository();
  repository.listAll = async () => { throw new Error("offline"); };
  const { runtime } = makeRuntime({ entitlementRepository: repository });
  const { context, sent } = makeContext();
  await routes.openPremium(context, runtime);
  const view = sent.replies[0].view;
  assert.ok(view.content.includes(t("adminpanel.premiumUnavailable")));
  assert.equal(view.components.some((component) => component.type === "select"), false);
});

test("search opens a modal and submit renders the server detail", async () => {
  const { runtime } = makeRuntime();
  await runtime.admin.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  const open = makeContext();
  await routes.openSearch(open.context, runtime);
  assert.equal(open.sent.modals[0].customId, Id.SEARCH_SUBMIT);
  const submit = makeContext({ modalValues: { [Field.GUILD_ID]: GUILD_A } });
  await routes.submitSearch(submit.context, runtime);
  const view = submit.sent.replies[0].view;
  assert.ok(view.content.includes("Alpha"), "name resolved from Discord cache");
  assert.ok(view.content.includes("TICKET_PREMIUM"), "premium feature shown");
  assert.ok(toActionRows(view.components).length <= 5);
});

test("invalid search is generically refused", async () => {
  const { runtime } = makeRuntime();
  const submit = makeContext({ modalValues: { [Field.GUILD_ID]: "nope" } });
  await routes.submitSearch(submit.context, runtime);
  assert.equal(submit.sent.replies[0].view.content, t("adminpanel.refused"));
});

test("integrated Recovery preserves its generic response and never renders the submitted secret", async () => {
  const { runtime } = makeRuntime();
  let received = null;
  runtime.recoveryServiceFactory = () => ({
    requestRecovery: async (input) => { received = input; return { requested: true }; },
  });
  const open = makeContext();
  await routes.openRecovery(open.context, runtime);
  assert.equal(open.sent.modals[0].customId, RecoveryComponentId.MASTER_SUBMIT);

  const submit = makeContext({ modalValues: { [RecoveryFieldId.MASTER]: FAKE_CODE } });
  await routes.submitRecoveryMaster(submit.context, runtime);
  assert.equal(received.masterCode, FAKE_CODE);
  assert.equal(JSON.stringify(submit.sent).includes(FAKE_CODE), false);
  assert.equal(submit.sent.replies[0].ephemeral, true);
});

test("activate flow: modal prefills guild id, submit grants premium", async () => {
  const { runtime } = makeRuntime();
  const open = makeContext();
  await routes.openActivate(open.context, runtime, GUILD_A);
  assert.equal(open.sent.modals[0].customId, Id.ACTIVATE_SUBMIT);
  assert.equal(open.sent.modals[0].fields.find((f) => f.id === Field.GUILD_ID).value, GUILD_A);
  const submit = makeContext({ modalValues: { [Field.GUILD_ID]: GUILD_A, [Field.PLAN]: EntitlementFeature.TICKET_PREMIUM, [Field.EXPIRES_IN_DAYS]: "30" } });
  await routes.submitActivate(submit.context, runtime);
  assert.equal(submit.sent.replies[0].view.content, t("adminpanel.premiumActivated"));
  const info = await runtime.admin.getServerInfo(GUILD_A);
  assert.equal(info.server.status.find((s) => s.feature === EntitlementFeature.TICKET_PREMIUM).active, true);
});

test("revoke flow: modal prefills plan, submit revokes with reason", async () => {
  const { runtime } = makeRuntime();
  await runtime.admin.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  const open = makeContext();
  await routes.openDeactivate(open.context, runtime, GUILD_A, "revoke");
  assert.equal(open.sent.modals[0].customId, Id.REVOKE_SUBMIT);
  assert.equal(open.sent.modals[0].fields.find((f) => f.id === Field.PLAN).value, EntitlementFeature.TICKET_PREMIUM);
  const submit = makeContext({ modalValues: { [Field.GUILD_ID]: GUILD_A, [Field.PLAN]: EntitlementFeature.TICKET_PREMIUM, [Field.REASON]: "abuse" } });
  await routes.submitDeactivate(submit.context, runtime, "revoke");
  assert.equal(submit.sent.replies[0].view.content, t("adminpanel.premiumRevoked"));
  const audit = await runtime.admin.listAudit({});
  assert.equal(audit.entries[0].action, "premium.revoke_abuse");
});

test("audit renders paginated entries within Discord limits", async () => {
  const { runtime } = makeRuntime();
  await runtime.admin.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  await runtime.admin.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_B, plan: EntitlementFeature.WELCOME_IMAGE });
  const { context, sent } = makeContext();
  await routes.openAudit(context, runtime);
  const view = sent.replies[0].view;
  assert.ok(view.content.includes("premium.activate"));
  assert.ok(toActionRows(view.components).length <= 5);
  // Pagination suivante.
  const next = makeContext({ customId: `${Id.AUDIT_NEXT_PREFIX}0` });
  await routes.openAudit(next.context, runtime, 1);
  assert.ok(next.sent.replies[0].view.content.includes(t("adminpanel.auditTitle")));
});

test("history view shows a server's premium history", async () => {
  const { runtime } = makeRuntime();
  await runtime.admin.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  const { context, sent } = makeContext();
  await routes.openHistory(context, runtime, GUILD_A);
  const view = sent.replies[0].view;
  assert.ok(view.content.includes("activate"));
  assert.ok(toActionRows(view.components).length <= 5);
});

test("all views keep packing within the 5 action-row limit", async () => {
  const { runtime } = makeRuntime();
  await runtime.admin.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  const views = [];
  const dashboard = makeContext();
  await routes.openDashboard(dashboard.context, runtime);
  views.push(dashboard.sent.replies[0].view);
  const premium = makeContext();
  await routes.openPremium(premium.context, runtime);
  views.push(premium.sent.replies[0].view);
  const server = makeContext({ modalValues: { [Field.GUILD_ID]: GUILD_A } });
  await routes.submitSearch(server.context, runtime);
  views.push(server.sent.replies[0].view);
  const audit = makeContext();
  await routes.openAudit(audit.context, runtime);
  views.push(audit.sent.replies[0].view);
  for (const view of views) {
    assert.ok(toActionRows(view.components).length <= 5, "no view exceeds Discord action-row limit");
  }
});
