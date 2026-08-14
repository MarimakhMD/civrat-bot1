"use strict";

// Normalise un enregistrement d'entitlement en un objet exploitable par l'UI,
// avec rétrocompatibilité : starts_at / plan absents sur les anciennes lignes
// sont exposés comme null (jamais une erreur).
function describeRecord(record, now = new Date()) {
  const status = record?.status ?? null;
  const endsAt = record?.ends_at ?? null;
  const active = status === "active" && (!endsAt || new Date(endsAt) > now);
  const expired = status === "active" && Boolean(endsAt) && new Date(endsAt) <= now;
  return {
    feature: record?.feature_key ?? null,
    status,
    plan: record?.plan ?? record?.feature_key ?? null,
    startsAt: record?.starts_at ?? null,
    endsAt,
    active,
    expired,
  };
}

class EntitlementService {
  constructor({ repository, now = () => new Date() }) {
    this.repository = repository;
    this.now = now;
  }

  async hasFeature({ guildId, feature }) {
    const record = await this.repository.findFeature(guildId, feature);
    return Boolean(record && record.status === "active" && (!record.ends_at || new Date(record.ends_at) > this.now()));
  }

  async findFeature(guildId, feature) {
    return this.repository.findFeature(guildId, feature);
  }

  // Statut complet d'une guilde : toutes ses lignes d'entitlement normalisées.
  async getGuildStatus(guildId) {
    const rows = await this.repository.listFeatures(guildId);
    return rows.map((row) => describeRecord(row, this.now()));
  }

  async listPremiumServers() {
    const rows = await this.repository.listAll();
    return rows.map((row) => ({
      guildId: row.guild_id,
      ...describeRecord(row, this.now()),
    }));
  }

  async countActive(feature = null) {
    const servers = await this.listPremiumServers();
    return servers.filter((s) => s.active && (!feature || s.feature === feature)).length;
  }

  async countExpired(feature = null) {
    const servers = await this.listPremiumServers();
    return servers.filter((s) => s.expired && (!feature || s.feature === feature)).length;
  }

  async countInactive(feature = null) {
    const servers = await this.listPremiumServers();
    return servers.filter((s) => s.status && s.status !== "active" && (!feature || s.feature === feature)).length;
  }

  // Activation (upsert). starts_at par défaut = maintenant ; ends_at null =
  // sans expiration ; plan par défaut = feature_key (rétrocompatible).
  async grantPremium({ guildId, feature, plan = null, endsAt = null, startsAt = null }) {
    await this.repository.activate({
      guild_id: guildId,
      feature_key: feature,
      status: "active",
      starts_at: startsAt || new Date(this.now()).toISOString(),
      ends_at: endsAt || null,
      plan: plan || feature,
    });
    return this.repository.findFeature(guildId, feature);
  }

  // Désactivation NON destructrice : conserve la ligne, ne change que le statut.
  async revokePremium({ guildId, feature, status = "revoked" }) {
    await this.repository.setStatus(guildId, feature, status);
    return this.repository.findFeature(guildId, feature);
  }
}

module.exports = { EntitlementService, describeRecord };
