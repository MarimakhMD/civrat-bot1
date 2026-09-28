"use strict";

const { SecurityRaidDefaults } = require("../configuration/securityConstants");

/**
 * PHASE 1 — anti-spam des alertes Security.
 *
 * Une détection de raid ou de nuke est un ÉTAT, pas un événement : tant que le
 * seuil est dépassé, `SecurityRaidService.record()` renvoie `isRaid: true` pour
 * CHAQUE arrivée suivante. Sans suppression, un raid de 20 membres produisait
 * 16 embeds rigoureusement identiques pour une seule situation.
 *
 * Règle retenue : une seule alerte par `(guild_id, action)` pendant la durée de
 * la fenêtre de détection. La clé inclut le `guild_id`, donc deux serveurs ne
 * s'influencent jamais, et une fenêtre réellement distincte — la précédente
 * étant expirée — redonne droit à une alerte.
 *
 * Le store et l'horloge sont injectables pour des tests déterministes.
 */
class SecurityAlertSuppression {
  constructor({ store, clock, cooldownMs } = {}) {
    this.store = store instanceof Map ? store : new Map();
    this.clock = typeof clock === "function" ? clock : () => Date.now();
    this.cooldownMs = Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : SecurityRaidDefaults.WINDOW_MS;
  }

  /**
   * Décide si une alerte doit être émise, et mémorise la décision.
   *
   * @param {string} key identifiant de situation, typiquement `${guildId}:${action}`
   * @param {number} [cooldownMs] durée de suppression propre à cette situation
   * @returns {boolean} `true` si l'alerte doit être émise maintenant
   */
  shouldAlert(key, cooldownMs) {
    if (!key) return false;
    const cooldown = Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : this.cooldownMs;
    const now = this.clock();
    const last = this.store.get(key);
    if (last !== undefined && now - last < cooldown) return false;
    this.store.set(key, now);
    return true;
  }

  /** Oublie une situation précise (ou tout, sans argument). */
  reset(key) {
    if (key) this.store.delete(key);
    else this.store.clear();
  }

  /** Purge les situations dont la suppression est expirée (bornage mémoire). */
  prune(cooldownMs) {
    const cooldown = Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : this.cooldownMs;
    const now = this.clock();
    for (const [key, last] of this.store) {
      if (now - last >= cooldown) this.store.delete(key);
    }
  }
}

module.exports = { SecurityAlertSuppression };
