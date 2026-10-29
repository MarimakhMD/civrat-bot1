"use strict";

/**
 * Registre FAIBLE de toutes les instances vivantes.
 *
 * Indispensable à la cohérence : la production compose DEUX runtimes
 * indépendants, chacun avec son propre cache —
 *   - le panneau d'administration (`createGuildSettingsRuntime`) ;
 *   - la livraison réelle des cartes Welcome (`createWelcomeGoodbyeRuntime`).
 *
 * La clé d'objet d'une image Welcome est CONSTANTE par guilde
 * (`{guildId}/welcome.png`) : l'image A et son remplacement B occupent donc la
 * MÊME entrée de cache. Une invalidation limitée au cache du panneau
 * laisserait la livraison servir l'ancienne image pendant toute la durée du
 * TTL. L'invalidation doit donc être diffusée à toutes les instances.
 *
 * Les références sont faibles : un cache abandonné (tests, composition jetée)
 * reste collectable et ne fuit pas dans ce registre.
 * @type {Set<WeakRef<WelcomeResourceCache>>}
 */
const LIVE = new Set();

function pruneDead() {
  for (const ref of LIVE) {
    if (ref.deref() === undefined) LIVE.delete(ref);
  }
}

class WelcomeResourceCache {
  constructor({ ttlMs = 300000, maxEntries = 100 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.values = new Map();
    LIVE.add(new WeakRef(this));
  }

  get(key) {
    const v = this.values.get(key);
    if (!v || Date.now() - v.at > this.ttlMs) {
      this.values.delete(key);
      return null;
    }
    return v.value;
  }

  set(key, value) {
    if (this.values.size >= this.maxEntries) this.values.delete(this.values.keys().next().value);
    this.values.set(key, { value, at: Date.now() });
    return value;
  }

  invalidate(key) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }

  /** Nombre d'instances vivantes dans le processus. */
  static get liveCount() {
    pruneDead();
    return LIVE.size;
  }

  /**
   * Invalide `key` dans TOUTES les instances vivantes du processus.
   * @returns {number} nombre d'instances qui contenaient effectivement la clé.
   */
  static invalidateEverywhere(key) {
    pruneDead();
    let touched = 0;
    for (const ref of LIVE) {
      const cache = ref.deref();
      if (!cache) continue;
      if (cache.values.has(key)) touched++;
      cache.invalidate(key);
    }
    return touched;
  }
}

module.exports = { WelcomeResourceCache };
