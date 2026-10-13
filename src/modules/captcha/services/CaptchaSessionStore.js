"use strict";

/**
 * P-CAPT L1 — SessionStore CAPTCHA.
 *
 * • mémoire mono-process, source de vérité UNIQUE (le customId Discord n'est
 *   qu'un indice de routage) ;
 * • une session active par (guild, membre) — la clé d'isolation stricte porte
 *   les deux ;
 * • états : PENDING → CHALLENGE (L3) → SUCCESS | FAILED | BLOCKED | EXPIRED ;
 * • aucune expiration programmée : la purge est paresseuse, à l'accès (comme
 *   le rate-limit P6) — aucun timer, aucune fuite ;
 * • terminal (SUCCESS/EXPIRED) = supprimé de la carte par le flux : le rôle
 *   du membre reste la vérité du « déjà vérifié » ;
 * • redémarrage = cartes perdues : le membre recrée simplement une session
 *   au prochain clic (comportement validé dans le plan).
 */

const CaptchaSessionState = Object.freeze({
  PENDING: "PENDING",
  CHALLENGE: "CHALLENGE",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  EXPIRED: "EXPIRED",
});

class CaptchaSessionStore {
  /**
   * @param {{ clock?: () => number, maxKeys?: number }} [options]
   *   `clock` injectable pour les tests ; `maxKeys` borne la mémoire.
   */
  constructor({ clock = Date.now, maxKeys = 20000 } = {}) {
    if (typeof clock !== "function") {
      throw new TypeError("CaptchaSessionStore requires an injectable clock function");
    }
    this.clock = clock;
    this.maxKeys = Number.isInteger(maxKeys) && maxKeys > 0 ? maxKeys : 20000;
    /** @type {Map<string, object>} */
    this.entries = new Map();
  }

  /** Clé d'isolement stricte guild × membre. */
  static key(guildId, memberId) {
    if (typeof guildId !== "string" || guildId.length === 0) {
      throw new TypeError("CaptchaSessionStore: guildId must be a non-empty string");
    }
    if (typeof memberId !== "string" || memberId.length === 0) {
      throw new TypeError("CaptchaSessionStore: memberId must be a non-empty string");
    }
    return `${guildId}:${memberId}`;
  }

  get(guildId, memberId) {
    return this.entries.get(CaptchaSessionStore.key(guildId, memberId));
  }

  /** Crée (ou remplace) la session PENDING du (guild, membre). */
  create(guildId, memberId, { expiresAt }) {
    const key = CaptchaSessionStore.key(guildId, memberId);
    if (this.entries.size >= this.maxKeys) this._boundSize();
    const now = this.clock();
    const session = Object.freeze({
      guildId,
      memberId,
      challengeId: null,
      state: CaptchaSessionState.PENDING,
      createdAt: now,
      expiresAt,
      attempts: 0,
      nextAttemptAt: 0,
      blockedUntil: 0,
    });
    this.entries.set(key, session);
    return session;
  }

  /**
   * Remplace l'état d'une session existante (les sessions sont des objets
   * gelés : toute transition produit une nouvelle instance).
   */
  setState(guildId, memberId, patch) {
    const current = this.get(guildId, memberId);
    if (!current) return null;
    const next = Object.freeze({ ...current, ...patch });
    this.entries.set(CaptchaSessionStore.key(guildId, memberId), next);
    return next;
  }

  delete(guildId, memberId) {
    return this.entries.delete(CaptchaSessionStore.key(guildId, memberId));
  }

  get size() {
    return this.entries.size;
  }

  /** Balayage mémoire : retire les sessions terminales ou complètement closes. */
  _boundSize() {
    const now = this.clock();
    for (const [key, session] of this.entries) {
      const terminal = session.state === CaptchaSessionState.SUCCESS
        || session.state === CaptchaSessionState.EXPIRED;
      const closed = session.blockedUntil > 0 && session.blockedUntil < now && session.attempts === 0;
      if (terminal || closed) this.entries.delete(key);
    }
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

module.exports = { CaptchaSessionStore, CaptchaSessionState };
