"use strict";

// Admin Panel — service opérationnel (Premium / stats / recherche / audit).
// Offline intégral : repositories en mémoire, horloge contrôlée, AUCUN secret.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EntitlementService, EntitlementFeature } = require("../../../core/entitlements");
const { AdminPanelService } = require("../services/AdminPanelService");

const ADMIN_ID = "222222222222222222";
const GUILD_A = "111111111111111111";
const GUILD_B = "333333333333333333";

class InMemoryEntitlementRepository {
  constructor(rows = []) { this.rows = rows.map((r) => ({ ...r })); }
  async findFeature(guildId, feature) { return this.rows.find((r) => r.guild_id === guildId && r.feature_key === feature) || null; }
  async listFeatures(guildId) { return this.rows.filter((r) => r.guild_id === guildId); }
  async listAll() { return [...this.rows]; }
  async activate(record) {
    const i = this.rows.findIndex((r) => r.guild_id === record.guild_id && r.feature_key === record.feature_key);
    if (i >= 0) this.rows[i] = { ...this.rows[i], ...record };
    else this.rows.push({ ...record });
  }
  async setStatus(guildId, feature, status) {
    const r = this.rows.find((x) => x.guild_id === guildId && x.feature_key === feature);
    if (r) r.status = status;
  }
}

class InMemoryPremiumHistoryRepository {
  constructor() { this.entries = []; }
  async append(entry) { this.entries.push({ ...entry, created_at: new Date().toISOString() }); }
  async listByGuild(guildId, { limit = 20, offset = 0 } = {}) {
    return this.entries.filter((e) => e.guildId === guildId).slice().reverse().slice(offset, offset + limit);
  }
  async listRecent({ limit = 20 } = {}) { return this.entries.slice().reverse().slice(0, limit); }
}

class InMemoryAdminAuditRepository {
  constructor() { this.entries = []; }
  async append(entry) { this.entries.push({ ...entry, created_at: new Date().toISOString() }); }
  async list({ limit = 20, offset = 0, guildId = null } = {}) {
    return this.entries.filter((e) => !guildId || e.guildId === guildId).slice().reverse().slice(offset, offset + limit);
  }
  async count({ guildId = null } = {}) { return this.entries.filter((e) => !guildId || e.guildId === guildId).length; }
}

function fixture({ rows = [], clientGuildCount = 5 } = {}) {
  const clock = { now: 1_700_000_000_000 };
  const logs = [];
  const logger = { info: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a) };
  const entitlementRepository = new InMemoryEntitlementRepository(rows);
  const entitlementService = new EntitlementService({ repository: entitlementRepository, now: () => new Date(clock.now) });
  const historyRepository = new InMemoryPremiumHistoryRepository();
  const auditRepository = new InMemoryAdminAuditRepository();
  const analyticsReader = {
    getGlobalStats: async () => ({ messages: 42, members: 7, servers: 3 }),
    getServerStats: async (guildId) => ({ messages: 10, members: 2, total: 12 }),
  };
  const service = new AdminPanelService({
    entitlementService, historyRepository, auditRepository, analyticsReader,
    logger, now: () => clock.now,
  });
  return { service, entitlementService, entitlementRepository, historyRepository, auditRepository, logs, clock, clientGuildCount };
}

test("activatePremium grants active entitlement with starts_at, plan and no expiry", async () => {
  const f = fixture();
  const result = await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  assert.equal(result.ok, true);
  assert.equal(result.code, "PREMIUM_ACTIVATED");
  assert.equal(result.endsAt, null, "no expiry by default");
  assert.ok(result.startsAt, "starts_at recorded");
  const row = await f.entitlementRepository.findFeature(GUILD_A, EntitlementFeature.TICKET_PREMIUM);
  assert.equal(row.status, "active");
  assert.equal(row.plan, EntitlementFeature.TICKET_PREMIUM);
  assert.equal(row.ends_at, null);
  assert.equal(f.historyRepository.entries.length, 1);
  assert.equal(f.historyRepository.entries[0].action, "activate");
  assert.equal(f.auditRepository.entries.length, 1);
  assert.equal(f.auditRepository.entries[0].action, "premium.activate");
});

test("revokePremiumForAbuse sets status revoked and records the reason (audit + history)", async () => {
  const f = fixture();
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  const result = await f.service.revokePremiumForAbuse({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM, reason: "spam abuse" });
  assert.equal(result.ok, true);
  assert.equal(result.code, "PREMIUM_REVOKED");
  const row = await f.entitlementRepository.findFeature(GUILD_A, EntitlementFeature.TICKET_PREMIUM);
  assert.equal(row.status, "revoked", "row preserved, status changed (no data loss)");
  const history = f.historyRepository.entries.find((e) => e.action === "revoke_abuse");
  assert.ok(history);
  assert.equal(history.reason, "spam abuse");
  const audit = f.auditRepository.entries.find((e) => e.action === "premium.revoke_abuse");
  assert.equal(audit.reason, "spam abuse");
});

test("removePremium sets status inactive (non-destructive)", async () => {
  const f = fixture();
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  const result = await f.service.removePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  assert.equal(result.ok, true);
  assert.equal(result.code, "PREMIUM_REMOVED");
  const row = await f.entitlementRepository.findFeature(GUILD_A, EntitlementFeature.TICKET_PREMIUM);
  assert.equal(row.status, "inactive");
  assert.ok(row.starts_at, "starts_at preserved after removal");
});

test("premium with expiry becomes expired after the delay; without expiry stays active", async () => {
  const f = fixture();
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM, expiresInDays: 1 });
  assert.equal(await f.entitlementService.hasFeature({ guildId: GUILD_A, feature: EntitlementFeature.TICKET_PREMIUM }), true);
  f.clock.now += 2 * 24 * 60 * 60 * 1000;
  assert.equal(await f.entitlementService.hasFeature({ guildId: GUILD_A, feature: EntitlementFeature.TICKET_PREMIUM }), false, "expired");
  const servers = await f.entitlementService.listPremiumServers();
  assert.equal(servers[0].expired, true);

  const f2 = fixture();
  await f2.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  f2.clock.now += 100 * 24 * 60 * 60 * 1000;
  assert.equal(await f2.entitlementService.hasFeature({ guildId: GUILD_A, feature: EntitlementFeature.TICKET_PREMIUM }), true, "no expiry => always active");
});

test("legacy rows without starts_at/plan stay exploitable (retrocompat)", async () => {
  const f = fixture({ rows: [{ guild_id: GUILD_A, feature_key: EntitlementFeature.TICKET_PREMIUM, status: "active", ends_at: null }] });
  const info = await f.service.getServerInfo(GUILD_A);
  assert.equal(info.ok, true);
  const feature = info.server.status.find((s) => s.feature === EntitlementFeature.TICKET_PREMIUM);
  assert.equal(feature.active, true, "legacy active row usable");
  assert.equal(feature.startsAt, null, "missing starts_at reads as null");
  assert.equal(feature.plan, EntitlementFeature.TICKET_PREMIUM, "plan falls back to feature_key");
});

test("listPremiumServers paginates and resolves names via the injected resolver", async () => {
  const f = fixture();
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_B, plan: EntitlementFeature.WELCOME_IMAGE });
  const list = await f.service.listPremiumServers({ page: 0, pageSize: 1, guildNameResolver: (id) => (id === GUILD_A ? "Alpha" : null) });
  assert.equal(list.ok, true);
  assert.equal(list.total, 3, "two persisted records plus the permanent technical server");
  assert.equal(list.items.length, 1);
  assert.equal(list.hasMore, true);
  assert.equal(list.items[0].name, "Alpha");
});

test("counters distinguish active/expired/inactive", async () => {
  const f = fixture();
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_B, plan: EntitlementFeature.TICKET_PREMIUM, expiresInDays: 1 });
  f.clock.now += 2 * 24 * 60 * 60 * 1000;
  assert.equal(await f.entitlementService.countActive(EntitlementFeature.TICKET_PREMIUM), 1);
  assert.equal(await f.entitlementService.countExpired(EntitlementFeature.TICKET_PREMIUM), 1);
  await f.service.revokePremiumForAbuse({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM, reason: "x" });
  assert.equal(await f.entitlementService.countInactive(EntitlementFeature.TICKET_PREMIUM), 1);
});

test("getServerInfo returns id, name, status, history and analytics", async () => {
  const f = fixture();
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  const info = await f.service.getServerInfo(GUILD_A, { guildNameResolver: (id) => "My Server" });
  assert.equal(info.ok, true);
  assert.equal(info.server.guildId, GUILD_A);
  assert.equal(info.server.name, "My Server");
  assert.equal(info.server.history.length, 1);
  assert.equal(info.server.analytics.messages, 10);
});

test("getDashboardStats aggregates counts and global analytics", async () => {
  const f = fixture();
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_B, plan: EntitlementFeature.WELCOME_IMAGE });
  const stats = await f.service.getDashboardStats({ clientGuildCount: 5 });
  assert.equal(stats.knownServers, 5);
  assert.equal(stats.premiumAvailable, true);
  assert.equal(stats.analyticsAvailable, true);
  assert.equal(stats.premiumTotal, 3, "two persisted records plus the permanent technical server");
  assert.equal(stats.premiumActive, 3);
  assert.equal(stats.freeServers, 2);
  assert.equal(stats.analytics.messages, 42);
});

test("audit is paginated and filterable by guild", async () => {
  const f = fixture();
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_B, plan: EntitlementFeature.WELCOME_IMAGE });
  const page = await f.service.listAudit({ page: 0, pageSize: 1 });
  assert.equal(page.ok, true);
  assert.equal(page.total, 2);
  assert.equal(page.entries.length, 1);
  const filtered = await f.service.listAudit({ page: 0, pageSize: 5, guildId: GUILD_A });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.entries[0].guildId, GUILD_A);
});

test("invalid discord IDs and plans are refused without mutation", async () => {
  const f = fixture();
  assert.equal((await f.service.activatePremium({ actorId: ADMIN_ID, guildId: "not-an-id", plan: EntitlementFeature.TICKET_PREMIUM })).code, "INVALID_GUILD_ID");
  assert.equal((await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: "UNKNOWN" })).code, "INVALID_PLAN");
  assert.equal((await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM, expiresInDays: -5 })).code, "INVALID_EXPIRES_IN_DAYS");
  assert.equal((await f.service.getServerInfo("nope")).code, "INVALID_GUILD_ID");
  assert.equal(f.auditRepository.entries.length, 0, "no audit for refused actions");
});

test("repository failure fails closed (generic codes, no throw)", async () => {
  const brokenRepo = { listAll: async () => { throw new Error("db down"); }, listFeatures: async () => { throw new Error("db down"); }, findFeature: async () => { throw new Error("db down"); }, activate: async () => { throw new Error("db down"); }, setStatus: async () => { throw new Error("db down"); } };
  const service = new AdminPanelService({ entitlementService: new EntitlementService({ repository: brokenRepo }), historyRepository: new InMemoryPremiumHistoryRepository(), auditRepository: new InMemoryAdminAuditRepository() });
  const activation = await service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  assert.equal(activation.code, "PREMIUM_UNAVAILABLE");
  const list = await service.listPremiumServers({});
  assert.equal(list.code, "PREMIUM_LIST_UNAVAILABLE");
  const stats = await service.getDashboardStats({ clientGuildCount: 5 });
  assert.equal(stats.premiumAvailable, false);
  assert.equal(stats.premiumTotal, null);
  assert.equal(stats.premiumActive, null);
  assert.equal(stats.freeServers, null, "unknown Premium data must not fabricate Free counts");
});

test("unavailable repositories return unavailable (not thrown)", async () => {
  const f = fixture();
  const service = new AdminPanelService({ entitlementService: f.entitlementService, historyRepository: null, auditRepository: null, analyticsReader: null });
  const audit = await service.listAudit({});
  assert.equal(audit.code, "AUDIT_UNAVAILABLE");
  const history = await service.getHistory(GUILD_A, {});
  assert.equal(history.code, "HISTORY_UNAVAILABLE");
  const stats = await service.getDashboardStats({ clientGuildCount: null });
  assert.equal(stats.knownServers, null);
  assert.equal(stats.analyticsAvailable, false);
  assert.equal(stats.analytics.messages, null);
});

test("no secret field ever appears in history, audit or logs", async () => {
  const f = fixture();
  await f.service.activatePremium({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM });
  await f.service.revokePremiumForAbuse({ actorId: ADMIN_ID, guildId: GUILD_A, plan: EntitlementFeature.TICKET_PREMIUM, reason: "revoked" });
  const historyJson = JSON.stringify(f.historyRepository.entries);
  const auditJson = JSON.stringify(f.auditRepository.entries);
  const logsJson = JSON.stringify(f.logs);
  for (const forbidden of ["master_code", "transfer_code", "recovery_code", "token", "password", "smtp", "secret"]) {
    assert.ok(!historyJson.toLowerCase().includes(forbidden), `${forbidden} not in history`);
    assert.ok(!auditJson.toLowerCase().includes(forbidden), `${forbidden} not in audit`);
    assert.ok(!logsJson.toLowerCase().includes(forbidden), `${forbidden} not in logs`);
  }
  // Les entrées d'audit ne portent que les champs attendus.
  for (const entry of f.auditRepository.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ["action", "actorId", "created_at", "guildId", "newValue", "oldValue", "reason"].sort());
  }
});
