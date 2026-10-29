"use strict";

const { SECURITY_DEFAULTS, SecurityConfigKey, sanitizeWhitelistEntries } = require("../configuration/securityConstants");

/**
 * Reads and writes Security guild configuration through the module-facing
 * GuildConfigResolver contract. Missing keys are merged with safe defaults so
 * the detection services always receive a complete contract.
 */
class SecurityConfigService {
  constructor({ guildConfigResolver }) {
    if (!guildConfigResolver || typeof guildConfigResolver.get !== "function") {
      throw new TypeError("SecurityConfigService requires a guildConfigResolver.");
    }
    this.config = guildConfigResolver;
  }

  async read(guildId) {
    const stored = (await this.config.get(guildId)) || {};
    const merged = { ...SECURITY_DEFAULTS, ...stored };
    // P9 — lecture défensive de la whitelist UNIQUEMENT : null / scalaire /
    // junk / doublons / dépassement de plafond sont neutralisés en mémoire,
    // sans appel réseau supplémentaire et sans toucher aux autres clés
    // Security. Une liste déjà propre ressort identique (même contenu,
    // même ordre).
    merged[SecurityConfigKey.WHITELIST] = sanitizeWhitelistEntries(merged[SecurityConfigKey.WHITELIST]);
    return merged;
  }

  async update(guildId, updates) {
    return this.config.update(guildId, updates);
  }
}

module.exports = { SecurityConfigService, SECURITY_DEFAULTS };
