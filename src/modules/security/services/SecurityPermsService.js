"use strict";

/**
 * P2-B — compteur dédié « permissions », STRICTEMENT alert-only.
 *
 * Deux compteurs indépendants, chacun isolé par `guild_id` :
 *
 *  • `channelPerms` — rafale d'overwrites de salon : N salons DISTINCTS
 *    modifiés (clé `permissions` de `channelChanges`) sur une fenêtre glissante.
 *  • `rolePerms` — rafale de modifications de permissions de rôle : N rôles
 *    DISTINCTS sur une fenêtre glissante.
 *
 * RÈGLES
 *  • Un même salon/rôle répété ne compte qu'UNE fois (ensemble de cibles).
 *  • Une alerte est déclenchée UNE seule fois par fenêtre (`alerted`) : le
 *    6e événement de la même fenêtre ne produit pas de spam ; une fenêtre
 *    réellement expirée réarme le compteur.
 *  • Isolation totale par guild : la clé est `${guildId}:${kind}`.
 *
 * AUCUNE réutilisation de `SecurityRaidService` (compteur de joins, polluerait
 * ses décomptes) et AUCUNE modification de `SecurityNukeService` — ces services
 * et leurs seuils (10/12/30/32) restent strictement intacts. Les seuils de ce
 * service sont dédiés (5 / 3) et injectables pour les tests.
 *
 * Store et horloge injectables pour des tests déterministes.
 */

const { SecurityPermsDefaults } = require("../configuration/securityConstants");

class SecurityPermsService {
  constructor({ store, clock, windowMs, thresholds } = {}) {
    this.store = store instanceof Map ? store : new Map();
    this.clock = typeof clock === "function" ? clock : () => Date.now();
    this.windowMs = Number.isFinite(windowMs) ? windowMs : SecurityPermsDefaults.WINDOW_MS;
    this.thresholds = {
      channelPerms: SecurityPermsDefaults.CHANNEL_DISTINCT_THRESHOLD,
      rolePerms: SecurityPermsDefaults.ROLE_DISTINCT_THRESHOLD,
      ...(thresholds || {}),
    };
  }

  clear(guildId) {
    if (!guildId) {
      this.store.clear();
      return;
    }
    for (const key of [...this.store.keys()]) {
      if (key === guildId || key.startsWith(`${guildId}:`)) this.store.delete(key);
    }
  }

  /** Rafale d'overwrites : enregistre un salon modifié, renvoie l'état du seuil. */
  recordChannelPermissions({ guildId, channelId } = {}) {
    return this._record(guildId, "channelPerms", channelId);
  }

  /** Rafale de rôles : enregistre un rôle dont les permissions ont bougé. */
  recordRolePermissions({ guildId, roleId } = {}) {
    return this._record(guildId, "rolePerms", roleId);
  }

  _record(guildId, kind, targetId) {
    const threshold = Number.isFinite(this.thresholds[kind]) ? this.thresholds[kind] : 0;
    if (!guildId || !targetId || threshold <= 0) {
      return { triggered: false, distinct: 0, threshold, windowMs: this.windowMs, kind };
    }

    const now = this.clock();
    const key = `${guildId}:${kind}`;
    let bucket = this.store.get(key);

    // Fenêtre expirée (ou première occurrence) : compteur réarmé à zéro.
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      bucket = { ids: new Set(), windowStart: now, alerted: false };
      this.store.set(key, bucket);
    }

    bucket.ids.add(String(targetId));
    const distinct = bucket.ids.size;
    const triggered = distinct >= threshold && !bucket.alerted;
    if (triggered) bucket.alerted = true;

    return { triggered, distinct, threshold, windowMs: this.windowMs, kind };
  }
}

const SENSITIVE_PERMISSIONS = new Set(SecurityPermsDefaults.SENSITIVE_PERMISSIONS);

/**
 * P2-B — signal fort N1 : permissions sensibles GAGNÉES par un rôle.
 *
 * Travaille sur l'entrée `permissions` produite par `roleChanges` (tableaux
 * avant/après de noms de permissions). Une PERTE n'est jamais un signal, et
 * toute structure illisible → `[]` (fail-closed, jamais d'invention).
 *
 * @param {Array<{key:string,before:*,after:*}>} changes
 * @returns {string[]} noms de permissions sensibles ajoutées
 */
function gainedSensitivePermissions(changes) {
  if (!Array.isArray(changes)) return [];
  const change = changes.find((entry) => entry && entry.key === "permissions");
  if (!change || !Array.isArray(change.before) || !Array.isArray(change.after)) return [];
  const before = new Set(change.before);
  return change.after.filter((name) => SENSITIVE_PERMISSIONS.has(name) && !before.has(name));
}

module.exports = { SecurityPermsService, gainedSensitivePermissions };
