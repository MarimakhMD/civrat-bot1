"use strict";

// Admin Panel — routes (dashboard, premium, serveurs, audit, modales).
// Offline : runtime réel (identity + service) avec repositories en mémoire.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EntitlementService, EntitlementFeature } = require("../../../core/entitlements");
const { OwnerPanelStateStore } = require("../../owner-panel/services/OwnerPanelStateStore");
const { CivratIdentityService } = require("../../owner-panel/services/CivratIdentityService");
const { OwnerPanelService } = require("../../owner-panel/services/OwnerPanelService");
const { AdminPanelService } = require("../services/AdminPanelService");
const routes = require("../interactions/adminPanelRoutes");
const { AdminPanelComponentId: Id, AdminPanelFieldId: Field } = require("../configuration/adminPanelConstants");
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

function makeRuntime({ adminIds = [ADMIN_ID] } = {}) {
  const clock = { now: 1_700_000_000_000 };
  const state = new OwnerPanelStateStore();
  const env = { civratOwnerId: () => "111111111111111111", panelMasterCode: () => FAKE_CODE, transferCode: () => FAKE_CODE };
  const identity = new CivratIdentityService({
    repository: { readOwnerId: async () => null, readAdminIds: async () => [...adminIds], addAdmin: async () => {}, removeAdmin: async () => {}, transferOwnership: async () => {} },
    env,
  });
  const panel = new OwnerPanelService({ state, env, now: () => clock.now });
  const entitlementService = new EntitlementService({ repository: new InMemoryEntitlementRepository(), now: () => new Date(clock.now) });
  const admin = new AdminPanelService({
    entitlementService,
    historyRepository: new InMemoryHistoryRepository(),
    auditRepository: new InMemoryAuditRepository(),
    analyticsReader: { getGlobalStats: async () => ({ messages: 1, members: 1, servers: 1 }), getServerStats: async () => ({ messages: 1, members: 1, total: 2 }) },
  });
  return { runtime: { identity, panel, state, admin, hasRecoveryElevation: () => false }, clock };
}

function makeContext({ userId = ADMIN_ID, modalValues = {}, values = [], customId = "" } = {}) {
  const sent = { replies: [], updates: [], modals: [] };
  const context = {
    userId, guildId: "g1", t,
    envelope: {
      modalValues, values, customId,
      discordClient: { guilds: { cache: { size: 2, get: (id) => (id === GUILD_A ? { name: "Alpha" } : { name: "Beta" }) } } },
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
  assert.ok(view.content.includes(t("adminpanel.dashboardTitle")));
  assert.deepEqual(view.components.map((c) => c.customId), [Id.PREMIUM, Id.SERVERS, Id.AUDIT, Id.REFRESH]);
  assert.ok(toActionRows(view.components).length <= 5, "dashboard packs within 5 action rows");
});

test("premium view lists servers with a select menu and pagination buttons", async () => {
  const { runtime } = makeRuntime();
  await runtime.admin.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  await runtime.admin.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_B, plan: EntitlementFeature.WELCOME_IMAGE });
  const { context, sent } = makeContext();
  await routes.openPremium(context, runtime);
  const view = sent.replies[0].view;
  assert.ok(view.content.includes(GUILD_A));
  assert.equal(view.components.find((c) => c.type === "select").options.length, 2);
  assert.ok(toActionRows(view.components).length <= 5);
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
