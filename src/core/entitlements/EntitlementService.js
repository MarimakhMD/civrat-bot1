"use strict";

const { EntitlementDecision } = require("./entitlementDecisions");
const {
  PremiumMutationAuthority,
  PremiumMutationOperation,
  PremiumMutationPolicy,
} = require("./PremiumMutationPolicy");
const { EntitlementFeatureList } = require("./entitlementFeatures");

function describeRecord(record, now = new Date()) {
  const permanent = Boolean(record?.permanent);
  const status = permanent ? "active" : record?.status ?? null;
  const endsAt = permanent ? null : record?.ends_at ?? null;
  const active = permanent || (status === "active" && (!endsAt || new Date(endsAt) > now));
  const expired = !permanent && status === "active" && Boolean(endsAt) && new Date(endsAt) <= now;
  return {
    feature: record?.feature_key ?? null,
    status,
    plan: record?.plan ?? record?.feature_key ?? null,
    startsAt: record?.starts_at ?? null,
    endsAt,
    active,
    expired,
    permanent,
    protected: Boolean(record?.protected),
    source: record?.source ?? null,
  };
}

class EntitlementService {
  constructor({ repository, now = () => new Date(), mutationPolicy = null }) {
    this.repository = repository;
    this.now = now;
    Object.defineProperty(this, "mutationPolicy", {
      value: mutationPolicy || new PremiumMutationPolicy(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }

  configurePremiumOwnerAuthorization(ownerAuthorization) {
    this.mutationPolicy.configureOwnerAuthorization(ownerAuthorization);
    return this;
  }

  isTechnicalPremiumGuild(guildId) {
    return this.mutationPolicy.isTechnicalGuild(guildId);
  }

  getPremiumProtection(guildId) {
    return this.mutationPolicy.describeProtection(guildId);
  }

  async getMutationAccess({
    guildId,
    feature = null,
    operation = PremiumMutationOperation.ACTIVATE,
    actorId = null,
    authority = PremiumMutationAuthority.ADMIN,
  }) {
    return this.mutationPolicy.evaluateMutation({ guildId, feature, operation, actorId, authority });
  }

  async hasFeature({ guildId, feature }) {
    if (this.mutationPolicy.isPermanentPremiumGuild(guildId)) return true;
    const record = await this.repository.findFeature(guildId, feature);
    return Boolean(record && record.status === "active" && (!record.ends_at || new Date(record.ends_at) > this.now()));
  }

  async requireFeature({ guildId, feature }) {
    if (this.mutationPolicy.isPermanentPremiumGuild(guildId)) {
      return { ok: true, granted: true, code: EntitlementDecision.GRANTED };
    }
    if (!this.repository) {
      return { ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE };
    }
    try {
      const granted = await this.hasFeature({ guildId, feature });
      return {
        ok: true,
        granted,
        code: granted ? EntitlementDecision.GRANTED : EntitlementDecision.PREMIUM_REQUIRED,
      };
    } catch {
      return { ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE };
    }
  }

  async findFeature(guildId, feature) {
    if (this.mutationPolicy.isPermanentPremiumGuild(guildId)) {
      return this.mutationPolicy.permanentRecord(feature);
    }
    return this.repository.findFeature(guildId, feature);
  }

  async getGuildStatus(guildId) {
    if (this.mutationPolicy.isPermanentPremiumGuild(guildId)) {
      return EntitlementFeatureList.map((feature) => (
        describeRecord(this.mutationPolicy.permanentRecord(feature), this.now())
      ));
    }
    const rows = await this.repository.listFeatures(guildId);
    return rows.map((row) => describeRecord(row, this.now()));
  }

  async listPremiumServers() {
    const rows = await this.repository.listAll();
    const servers = rows
      .filter((row) => !this.mutationPolicy.isTechnicalGuild(row?.guild_id))
      .map((row) => ({
        guildId: row.guild_id,
        ...describeRecord(row, this.now()),
      }));

    const representativeFeature = EntitlementFeatureList[0] || "PREMIUM";
    servers.push({
      guildId: this.mutationPolicy.technicalGuildId,
      ...describeRecord(this.mutationPolicy.permanentRecord(representativeFeature), this.now()),
    });
    return servers;
  }

  async countActive(feature = null) {
    const servers = await this.listPremiumServers();
    return servers.filter((server) => server.active && (!feature || server.feature === feature)).length;
  }

  async countExpired(feature = null) {
    const servers = await this.listPremiumServers();
    return servers.filter((server) => server.expired && (!feature || server.feature === feature)).length;
  }

  async countInactive(feature = null) {
    const servers = await this.listPremiumServers();
    return servers.filter((server) => server.status && server.status !== "active" && (!feature || server.feature === feature)).length;
  }

  async grantPremium({
    guildId,
    feature,
    plan = null,
    endsAt = null,
    startsAt = null,
    actorId = null,
    authority = PremiumMutationAuthority.ADMIN,
  }) {
    const permit = await this.mutationPolicy.authorizeMutation({
      guildId,
      feature,
      operation: PremiumMutationOperation.ACTIVATE,
      actorId,
      authority,
    });

    await this.repository.activate({
      guild_id: guildId,
      feature_key: feature,
      status: "active",
      starts_at: startsAt || new Date(this.now()).toISOString(),
      ends_at: endsAt || null,
      plan: plan || feature,
    }, permit);
    return this.findFeature(guildId, feature);
  }

  async revokePremium({
    guildId,
    feature,
    status = "revoked",
    actorId = null,
    authority = PremiumMutationAuthority.ADMIN,
  }) {
    const permit = await this.mutationPolicy.authorizeMutation({
      guildId,
      feature,
      operation: PremiumMutationOperation.SET_STATUS,
      actorId,
      authority,
    });

    await this.repository.setStatus(guildId, feature, status, permit);
    return this.findFeature(guildId, feature);
  }
}

function premiumRequiredView(t, {
  decision = EntitlementDecision.PREMIUM_REQUIRED,
  unavailable = false,
  components = [],
} = {}) {
  const backendUnavailable = unavailable || decision === EntitlementDecision.UNAVAILABLE;
  return {
    title: t("errors.premiumRequiredTitle"),
    content: backendUnavailable ? t("errors.entitlementUnavailable") : t("errors.premiumRequired"),
    components,
  };
}

module.exports = { EntitlementService, describeRecord, premiumRequiredView };
