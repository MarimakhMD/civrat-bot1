"use strict";

const {
  SETTINGS_CATALOG,
  evaluateSettingsFeature,
} = require("../../guild-settings/configuration/settingsCatalog");

function guildCache(client) {
  const cache = client?.guilds?.cache;
  if (!cache || typeof cache.values !== "function") return null;
  return cache;
}

class AdminSystemService {
  constructor({
    technicalConfig,
    configurationReader,
    entitlementService,
    logger = null,
    now = () => Date.now(),
    startedAt = Date.now(),
  } = {}) {
    if (!technicalConfig) throw new Error("AdminSystemService requires technicalConfig");
    if (typeof configurationReader !== "function") {
      throw new Error("AdminSystemService requires configurationReader");
    }
    this.technicalConfig = Object.freeze({
      guildId: technicalConfig.guildId,
      channelId: technicalConfig.channelId,
      roleId: technicalConfig.roleId,
    });
    this.configurationReader = configurationReader;
    this.entitlementService = entitlementService || null;
    this.logger = logger;
    this.now = now;
    this.startedAt = startedAt;
  }

  listInstalledGuilds(client) {
    const cache = guildCache(client);
    if (!cache) return { available: false, guilds: [], total: null };
    const guilds = [...cache.values()]
      .map((guild) => ({
        id: guild?.id || null,
        name: guild?.name || null,
        memberCount: Number.isInteger(guild?.memberCount) ? guild.memberCount : null,
      }))
      .filter(({ id }) => Boolean(id))
      .sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id)));
    return { available: true, guilds, total: guilds.length };
  }

  async getGuildConfiguration(guildId) {
    const snapshot = await this.configurationReader(guildId);
    const config = snapshot?.config && typeof snapshot.config === "object" ? snapshot.config : {};
    const features = SETTINGS_CATALOG.flatMap((category) => category.features.map((definition) => ({
      id: definition.id,
      state: evaluateSettingsFeature(definition, config),
    })));
    return {
      available: Boolean(snapshot?.available),
      found: Boolean(snapshot?.found),
      source: snapshot?.source || "unavailable",
      language: typeof config.language === "string" ? config.language : null,
      features,
    };
  }

  async getTechnicalConfiguration() {
    return {
      technical: this.technicalConfig,
      guild: await this.getGuildConfiguration(this.technicalConfig.guildId),
    };
  }

  async getDiagnostics(client) {
    const installed = this.listInstalledGuilds(client);
    const configuration = await this.configurationReader(this.technicalConfig.guildId);
    let entitlements = { available: false, records: null };
    if (this.entitlementService && typeof this.entitlementService.listPremiumServers === "function") {
      try {
        const records = await this.entitlementService.listPremiumServers();
        entitlements = { available: true, records: records.length };
      } catch (error) {
        this.logger?.warn?.("admin_diagnostics_entitlements_unavailable", {
          code: error?.code || error?.name || "UNKNOWN",
        });
        entitlements = { available: false, records: null };
      }
    }
    return {
      runtime: {
        uptimeSeconds: Math.max(0, Math.floor((this.now() - this.startedAt) / 1000)),
      },
      discord: {
        available: Boolean(client),
        ready: typeof client?.isReady === "function" ? client.isReady() : null,
        installedGuilds: installed.total,
      },
      configuration: {
        available: Boolean(configuration?.available),
        source: configuration?.source || "unavailable",
      },
      entitlements,
    };
  }
}

module.exports = { AdminSystemService };
