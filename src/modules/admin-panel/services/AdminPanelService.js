"use strict";

const { EntitlementFeature } = require("../../../core/entitlements");
const { AdminPanelPolicy, AdminPanelEntitlementStatus } = require("../configuration/adminPanelConstants");

const GENERIC_REFUSED = Object.freeze({ ok: false, code: "ADMIN_ACTION_REFUSED" });

function isDiscordId(value) {
  return typeof value === "string" && AdminPanelPolicy.DISCORD_ID_PATTERN.test(value.trim());
}

function normalizeReason(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > AdminPanelPolicy.MAX_REASON_LENGTH ? trimmed.slice(0, AdminPanelPolicy.MAX_REASON_LENGTH) : trimmed;
}

// Orchestration opérationnelle du CIVRAT Admin Panel. Réutilise le core
// EntitlementService (le SEUL système Premium) + deux journaux append-only
// (historique Premium et audit Admin). Jamais de secret : uniquement des ids,
// statuts, dates et raisons. Fail-closed partout (aucune exception ne remonte).
class AdminPanelService {
  constructor({ entitlementService, historyRepository = null, auditRepository = null, analyticsReader = null, logger = null, now = () => Date.now() }) {
    if (!entitlementService) throw new TypeError("AdminPanelService requires an entitlementService.");
    this.entitlementService = entitlementService;
    this.historyRepository = historyRepository;
    this.auditRepository = auditRepository;
    this.analyticsReader = analyticsReader;
    this.logger = logger;
    this.now = now;
  }

  log(event, details = {}) {
    this.logger?.info?.("admin_panel_event", { event, ...details });
  }

  // ---------- Dashboard / statistiques ----------
  async getDashboardStats({ clientGuildCount = null } = {}) {
    let premiumAvailable = true;
    let premiumTotal = null;
    let premiumActive = null;
    let premiumExpired = null;
    let premiumInactive = null;
    try {
      const servers = await this.entitlementService.listPremiumServers();
      premiumTotal = servers.length;
      premiumActive = servers.filter((s) => s.active).length;
      premiumExpired = servers.filter((s) => s.expired).length;
      premiumInactive = servers.filter((s) => s.status && s.status !== "active").length;
    } catch (error) {
      premiumAvailable = false;
      this.log("premium_stats_unavailable", { error: error.message });
    }

    let analyticsAvailable = false;
    let analytics = { messages: null, members: null, servers: null };
    try {
      if (this.analyticsReader && typeof this.analyticsReader.getGlobalStats === "function") {
        analytics = (await this.analyticsReader.getGlobalStats()) || analytics;
        analyticsAvailable = true;
      }
    } catch (error) {
      this.log("analytics_stats_unavailable", { error: error.message });
    }

    const knownServers = Number.isInteger(clientGuildCount) ? clientGuildCount : null;
    const freeServers = knownServers === null || premiumActive === null
      ? null
      : Math.max(0, knownServers - premiumActive);

    return {
      knownServers,
      freeServers,
      premiumAvailable,
      premiumTotal,
      premiumActive,
      premiumExpired,
      premiumInactive,
      analyticsAvailable,
      analytics,
    };
  }

  async getRecentActions({ limit = 5 } = {}) {
    if (!this.auditRepository) return [];
    try {
      return await this.auditRepository.list({ limit });
    } catch (error) {
      this.log("recent_actions_unavailable", { error: error.message });
      return [];
    }
  }

  // ---------- Premium : liste / recherche / détail ----------
  async listPremiumServers({ page = 0, pageSize = AdminPanelPolicy.PAGE_SIZE, guildNameResolver = null } = {}) {
    try {
      const servers = await this.entitlementService.listPremiumServers();
      const total = servers.length;
      const start = page * pageSize;
      const items = servers.slice(start, start + pageSize).map((server) => ({
        ...server,
        name: guildNameResolver ? guildNameResolver(server.guildId) || null : null,
      }));
      return { ok: true, code: "PREMIUM_LISTED", items, total, page, pageSize, hasMore: start + pageSize < total };
    } catch (error) {
      this.log("premium_list_failed", { error: error.message });
      return { ok: false, code: "PREMIUM_LIST_UNAVAILABLE", items: [], total: 0, page, pageSize, hasMore: false };
    }
  }

  async getServerInfo(guildId, { guildNameResolver = null } = {}) {
    if (!isDiscordId(guildId)) return { ok: false, code: "INVALID_GUILD_ID" };
    const name = guildNameResolver ? guildNameResolver(guildId) || null : null;

    let status = null;
    try {
      status = await this.entitlementService.getGuildStatus(guildId);
    } catch (error) {
      this.log("server_status_unavailable", { guildId, error: error.message });
    }

    let history = [];
    try {
      if (this.historyRepository) history = await this.historyRepository.listByGuild(guildId, { limit: AdminPanelPolicy.HISTORY_LIMIT });
    } catch (error) {
      this.log("server_history_unavailable", { guildId, error: error.message });
    }

    let analytics = null;
    try {
      if (this.analyticsReader && typeof this.analyticsReader.getServerStats === "function") {
        analytics = await this.analyticsReader.getServerStats(guildId);
      }
    } catch (error) {
      this.log("server_analytics_unavailable", { guildId, error: error.message });
    }

    return {
      ok: true,
      code: "SERVER_FOUND",
      server: { guildId, name, status, statusUnavailable: status === null, history, analytics },
    };
  }

  async getHistory(guildId, { page = 0, pageSize = AdminPanelPolicy.PAGE_SIZE } = {}) {
    if (!isDiscordId(guildId)) return { ok: false, code: "INVALID_GUILD_ID" };
    if (!this.historyRepository) return { ok: false, code: "HISTORY_UNAVAILABLE", entries: [], total: 0, page, pageSize, hasMore: false };
    try {
      const offset = page * pageSize;
      const entries = await this.historyRepository.listByGuild(guildId, { limit: pageSize, offset });
      const total = entries.length; // approximation : total réel inconnu sans count (affichage page courante)
      return { ok: true, code: "HISTORY_LISTED", entries, total, page, pageSize, hasMore: entries.length === pageSize };
    } catch (error) {
      this.log("history_list_failed", { guildId, error: error.message });
      return { ok: false, code: "HISTORY_UNAVAILABLE", entries: [], total: 0, page, pageSize, hasMore: false };
    }
  }

  // ---------- Audit ----------
  async listAudit({ page = 0, pageSize = AdminPanelPolicy.PAGE_SIZE, guildId = null } = {}) {
    if (!this.auditRepository) return { ok: false, code: "AUDIT_UNAVAILABLE", entries: [], total: 0, page, pageSize, hasMore: false };
    try {
      const limit = pageSize;
      const offset = page * pageSize;
      const [entries, total] = await Promise.all([
        this.auditRepository.list({ limit, offset, guildId }),
        this.auditRepository.count({ guildId }),
      ]);
      return { ok: true, code: "AUDIT_LISTED", entries, total, page, pageSize, hasMore: offset + entries.length < total };
    } catch (error) {
      this.log("audit_list_failed", { error: error.message });
      return { ok: false, code: "AUDIT_UNAVAILABLE", entries: [], total: 0, page, pageSize, hasMore: false };
    }
  }

  // ---------- Mutations Premium (auditées + historisées) ----------
  async activatePremium({ actorId, guildId, plan = EntitlementFeature.TICKET_PREMIUM, expiresInDays = null, reason = null }) {
    if (!isDiscordId(guildId)) return { ok: false, code: "INVALID_GUILD_ID" };
    if (!Object.values(EntitlementFeature).includes(plan)) return { ok: false, code: "INVALID_PLAN" };
    const endsAt = this.#endsAtFromDays(expiresInDays);
    if (expiresInDays !== null && endsAt === null) return { ok: false, code: "INVALID_EXPIRES_IN_DAYS" };
    const reasonText = normalizeReason(reason);

    try {
      const before = (await this.entitlementService.getGuildStatus(guildId)).find((s) => s.feature === plan) || null;
      const record = await this.entitlementService.grantPremium({ guildId, feature: plan, plan, endsAt });
      const newEndsAt = record?.ends_at ?? endsAt ?? null;
      await this.#appendHistory({
        guildId, feature: plan, action: "activate", actorId,
        oldStatus: before?.status ?? null, newStatus: "active",
        oldEndsAt: before?.endsAt ?? null, newEndsAt, plan, reason: reasonText,
      });
      await this.#appendAudit({
        actorId, guildId, action: "premium.activate", reason: reasonText,
        oldValue: before ? JSON.stringify({ status: before.status, endsAt: before.endsAt, plan: before.plan }) : null,
        newValue: JSON.stringify({ status: "active", endsAt: newEndsAt, plan }),
      });
      this.log("premium_activated", { actorId, guildId, feature: plan });
      return { ok: true, code: "PREMIUM_ACTIVATED", feature: plan, endsAt: newEndsAt, startsAt: record?.starts_at ?? null };
    } catch (error) {
      this.log("premium_activate_failed", { actorId, guildId, error: error.message });
      return { ok: false, code: "PREMIUM_UNAVAILABLE" };
    }
  }

  async removePremium({ actorId, guildId, plan, reason = null }) {
    return this.#deactivate({ actorId, guildId, plan, status: AdminPanelEntitlementStatus.INACTIVE, action: "deactivate", auditAction: "premium.remove", reason });
  }

  async revokePremiumForAbuse({ actorId, guildId, plan, reason = null }) {
    return this.#deactivate({ actorId, guildId, plan, status: AdminPanelEntitlementStatus.REVOKED, action: "revoke_abuse", auditAction: "premium.revoke_abuse", reason });
  }

  async #deactivate({ actorId, guildId, plan, status, action, auditAction, reason }) {
    if (!isDiscordId(guildId)) return { ok: false, code: "INVALID_GUILD_ID" };
    if (!Object.values(EntitlementFeature).includes(plan)) return { ok: false, code: "INVALID_PLAN" };
    const reasonText = normalizeReason(reason);

    try {
      const before = (await this.entitlementService.getGuildStatus(guildId)).find((s) => s.feature === plan) || null;
      if (!before) return { ok: false, code: "PREMIUM_NOT_FOUND" };
      const record = await this.entitlementService.revokePremium({ guildId, feature: plan, status });
      await this.#appendHistory({
        guildId, feature: plan, action, actorId,
        oldStatus: before?.status ?? null, newStatus: status,
        oldEndsAt: before?.endsAt ?? null, newEndsAt: record?.ends_at ?? before?.endsAt ?? null, plan, reason: reasonText,
      });
      await this.#appendAudit({
        actorId, guildId, action: auditAction, reason: reasonText,
        oldValue: before ? JSON.stringify({ status: before.status, endsAt: before.endsAt, plan: before.plan }) : null,
        newValue: JSON.stringify({ status }),
      });
      this.log("premium_deactivated", { actorId, guildId, feature: plan, status });
      return { ok: true, code: status === AdminPanelEntitlementStatus.REVOKED ? "PREMIUM_REVOKED" : "PREMIUM_REMOVED", feature: plan, status };
    } catch (error) {
      this.log("premium_deactivate_failed", { actorId, guildId, error: error.message });
      return { ok: false, code: "PREMIUM_UNAVAILABLE" };
    }
  }

  // ---------- Internes ----------
  async #appendHistory(entry) {
    if (!this.historyRepository) return;
    try {
      await this.historyRepository.append(entry);
    } catch (error) {
      this.log("premium_history_append_failed", { error: error.message });
    }
  }

  async #appendAudit(entry) {
    if (!this.auditRepository) return;
    try {
      await this.auditRepository.append(entry);
    } catch (error) {
      this.log("admin_audit_append_failed", { error: error.message });
    }
  }

  #endsAtFromDays(days) {
    if (days === null || days === undefined || days === "") return null;
    const value = Number(days);
    if (!Number.isInteger(value) || value < 0 || value > AdminPanelPolicy.MAX_EXPIRES_IN_DAYS) return null;
    return new Date(this.now() + value * 24 * 60 * 60 * 1000).toISOString();
  }
}

module.exports = { AdminPanelService, isDiscordId, normalizeReason, GENERIC_REFUSED };
