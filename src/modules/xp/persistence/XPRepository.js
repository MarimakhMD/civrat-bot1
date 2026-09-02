"use strict";

class XPRepository {
  async findOne(guildId, userId) {
    throw new Error("XPRepository.findOne must be implemented");
  }

  async upsert(guildId, userId, xp, level) {
    throw new Error("XPRepository.upsert must be implemented");
  }

  // Phase 11 : contrat du classement XP consommé par Analytics (/analytics,
  // /analytics_xp). Retourne [{ userId, xp, level }] trié du plus haut XP au
  // plus bas, limité à `limit` entrées, isolé par guilde.
  async getLeaderboard(_guildId, _limit = 10) {
    throw new Error("XPRepository.getLeaderboard must be implemented");
  }
}

class InMemoryXPRepository extends XPRepository {
  constructor({ clock } = {}) {
    super();
    this.store = new Map(); // key: guildId:userId -> {guildId, userId, xp, level}
    this.clock = typeof clock === "function" ? clock : () => Date.now();
  }

  _key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  async findOne(guildId, userId) {
    return this.store.get(this._key(guildId, userId)) || null;
  }

  async upsert(guildId, userId, xp, level) {
    const key = this._key(guildId, userId);
    const previous = this.store.get(key);
    const record = {
      guildId,
      userId,
      xp,
      level,
      lastXpAt: previous ? previous.lastXpAt : null,
      updatedAt: Date.now(),
    };
    this.store.set(key, record);
    return record;
  }

  /**
   * B3 — même sémantique que SupabaseXPRepository.applyGain.
   *
   * Le repli InMemory doit se comporter EXACTEMENT comme le dépôt de
   * production (cooldown via lastXpAt, gain fixe, niveau recalculé), sinon les
   * tests valideraient un chemin que la production n'emprunte jamais.
   *
   * Ici l'atomicité est triviale : JavaScript est mono-thread et cette méthode
   * ne contient aucun await entre la lecture et l'écriture.
   */
  async applyGain({ guildId, userId, gain, cooldownSeconds, computeLevel, now }) {
    const safeGain = Number.isFinite(gain) && gain > 0 ? Math.trunc(gain) : 0;
    const cooldownMs = Number.isFinite(cooldownSeconds) && cooldownSeconds > 0
      ? Math.trunc(cooldownSeconds) * 1000
      : 0;

    const key = this._key(guildId, userId);
    const current = this.store.get(key) || null;
    // L'appelant (XPService) fournit l'instant de référence ; à défaut, horloge
    // du dépôt.
    const effectiveNow = Number.isFinite(now) ? now : this.clock();

    if (cooldownMs > 0 && current && current.lastXpAt) {
      const last = Date.parse(current.lastXpAt);
      if (Number.isFinite(last) && effectiveNow - last < cooldownMs) {
        return { applied: false, code: "XP_COOLDOWN" };
      }
    }

    const previousXp = current ? current.xp : 0;
    const previousLevel = current && typeof computeLevel === "function"
      ? computeLevel(previousXp)
      : 0;
    const newXp = previousXp + safeGain;
    const newLevel = typeof computeLevel === "function" ? computeLevel(newXp) : 0;
    const nowIso = new Date(effectiveNow).toISOString();
    // Un gain nul n'est pas un gain : il ne pose pas d'horodatage et ne peut
    // donc pas déclencher un cooldown qui bloquerait un gain réel ultérieur.
    // Un horodatage déjà présent est PRÉSERVÉ, jamais effacé.
    const lastXpAt = safeGain > 0 ? nowIso : (current ? current.lastXpAt : null);

    this.store.set(key, {
      guildId,
      userId,
      xp: newXp,
      level: newLevel,
      lastXpAt,
      updatedAt: effectiveNow,
    });

    return { applied: true, xpGain: safeGain, xp: newXp, level: newLevel, previousXp, previousLevel };
  }

  async getLeaderboard(guildId, limit = 10) {
    const entries = [];
    for (const record of this.store.values()) {
      if (record.guildId === guildId) entries.push({ userId: record.userId, xp: record.xp, level: record.level });
    }
    return entries.sort((a, b) => b.xp - a.xp || b.level - a.level).slice(0, limit);
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { XPRepository, InMemoryXPRepository };
