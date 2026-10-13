"use strict";

/**
 * P5 — compteur dédié « updates », STRICTEMENT alert-only.
 *
 * Deux compteurs indépendants, chacun isolé par `guild_id` :
 *
 *  • `channelUpdate` — rafale de salons DISTINCTS dont au moins UNE clé
 *    NON-permission de `channelChanges` a bougé (name, topic, position,
 *    parent, slowmode, nsfw, bitrate, userLimit) sur une fenêtre glissante.
 *  • `roleUpdate` — rafale de rôles DISTINCTS dont au moins UNE clé
 *    NON-permission de `roleChanges` (name, color, hoist, mentionable) OU la
 *    position (comparaison locale dans roleUpdate) a bougé.
 *
 * RÈGLES (miroir SecurityPermsService) :
 *  • une même cible répétée ne compte qu'UNE fois (ensemble de cibles) ;
 *  • une alerte est déclenchée UNE seule fois par fenêtre (`alerted`) ;
 *  • isolation stricte par guild : clé `${guildId}:${kind}` ;
 *  • store et horloge injectables pour des tests déterministes.
 *
 * AUCUNE dépendance à SecurityRaidService et AUCUNE modification des seuils
 * existants : SecurityNukeDefaults (10/12/30/32), SecurityRaidDefaults et
 * SecurityPermsDefaults (5/3) restent intacts. Les seuils de ce service sont
 * dédiés (10 salons / 6 rôles) et injectables.
 *
 * P2-B reste responsable des modifications de PERMISSIONS : ce service ne
 * voit QUE les clés non-permissions.
 */

const { SecurityUpdateDefaults } = require("../configuration/securityConstants");

class SecurityUpdateService {
  constructor({ store, clock, windowMs, thresholds } = {}) {
    this.store = store instanceof Map ? store : new Map();
    this.clock = typeof clock === "function" ? clock : () => Date.now();
    this.windowMs = Number.isFinite(windowMs) ? windowMs : SecurityUpdateDefaults.WINDOW_MS;
    this.thresholds = {
      channelUpdate: SecurityUpdateDefaults.CHANNEL_DISTINCT_THRESHOLD,
      roleUpdate: SecurityUpdateDefaults.ROLE_DISTINCT_THRESHOLD,
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

  /** Rafale de salons non-permission : enregistre un salon modifié. */
  recordChannelContent({ guildId, channelId } = {}) {
    return this._record(guildId, "channelUpdate", channelId);
  }

  /** Rafale de rôles non-permission (champs OU position) : enregistre un rôle. */
  recordRoleContent({ guildId, roleId } = {}) {
    return this._record(guildId, "roleUpdate", roleId);
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

module.exports = { SecurityUpdateService };
