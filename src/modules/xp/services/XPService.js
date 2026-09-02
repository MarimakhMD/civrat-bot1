"use strict";

const { XP_DEFAULTS, XP_LIMITS } = require("../configuration/xpConstants");
const { LevelService } = require("./LevelService");

/**
 * A2 — normalisation défensive des entiers de configuration.
 *
 * Les colonnes xp_per_message et xp_cooldown arrivent de PostgREST telles
 * qu'elles sont stockées : potentiellement null, ou écrites hors bornes par un
 * appel direct. Une valeur invalide ne doit JAMAIS lever ni produire NaN :
 * elle retombe sur le défaut, puis est écrêtée dans les bornes de XP_LIMITS.
 *
 * null / undefined / "" / booléen / texte non numérique → défaut.
 * Nombre décimal → troncature (un gain ou un cooldown fractionnaire n'a pas de
 * sens, et Math.trunc évite les surprises d'arrondi sur les valeurs négatives).
 */
function normalizeConfiguredInteger(value, fallback, min, max) {
  // Seuls un nombre ou une chaîne sont interprétables. null, undefined,
  // booléen, tableau, objet et symbole retombent sur le défaut : en
  // particulier, un tableau ne doit JAMAIS être converti (Number([]) vaut 0,
  // ce qui désactiverait le cooldown en silence).
  if (typeof value !== "number" && typeof value !== "string") return fallback;

  let parsed;
  if (typeof value === "number") {
    parsed = value;
  } else {
    const trimmed = value.trim();
    // Une chaîne vide ou blanche n'est pas un zéro explicite : c'est une
    // absence de valeur.
    if (trimmed === "") return fallback;
    parsed = Number(trimmed);
  }

  if (!Number.isFinite(parsed)) return fallback;
  const truncated = Math.trunc(parsed);
  if (truncated < min) return min;
  if (truncated > max) return max;
  return truncated;
}

/** XP gagnés par message : gain FIXE (DCA3), jamais négatif. */
function resolveXpPerMessage(config) {
  return normalizeConfiguredInteger(
    config && config.xp_per_message,
    XP_DEFAULTS.xp_per_message,
    XP_LIMITS.PER_MESSAGE_MIN,
    Number.MAX_SAFE_INTEGER,
  );
}

/** Cooldown en SECONDES (DCA5) : 0 désactive, plafond 3600. */
function resolveXpCooldownSeconds(config) {
  return normalizeConfiguredInteger(
    config && config.xp_cooldown,
    XP_DEFAULTS.xp_cooldown,
    XP_LIMITS.COOLDOWN_SECONDS_MIN,
    XP_LIMITS.COOLDOWN_SECONDS_MAX,
  );
}

class XPService {
  constructor({ repository, levelService, cooldowns, clock } = {}) {
    if (!repository || typeof repository.findOne !== "function" || typeof repository.upsert !== "function") {
      throw new TypeError("XPService requires a repository with findOne/upsert");
    }
    this.repository = repository;
    this.levelService = levelService instanceof LevelService ? levelService : new LevelService();
    this.cooldowns = cooldowns instanceof Map ? cooldowns : new Map();
    this.clock = typeof clock === "function" ? clock : () => Date.now();
  }

  _cooldownKey(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  /**
   * Un cooldown de 0 seconde désactive la limitation : aucun message n'est
   * alors jamais bloqué (DCA5).
   */
  isOnCooldown(guildId, userId, cooldownSeconds) {
    const seconds = normalizeConfiguredInteger(
      cooldownSeconds,
      XP_DEFAULTS.xp_cooldown,
      XP_LIMITS.COOLDOWN_SECONDS_MIN,
      XP_LIMITS.COOLDOWN_SECONDS_MAX,
    );
    if (seconds <= 0) return false;
    const key = this._cooldownKey(guildId, userId);
    if (!this.cooldowns.has(key)) return false;
    const last = this.cooldowns.get(key);
    return this.clock() - last < seconds * 1000;
  }

  async handleMessage({ guildId, userId, isBot, config }) {
    if (!guildId || !userId || isBot) return { handled: false, code: "XP_IGNORED" };
    if (!config || !config.xp_enabled) return { handled: false, code: "XP_DISABLED" };

    const cooldownSeconds = resolveXpCooldownSeconds(config);
    const xpGain = resolveXpPerMessage(config);

    // Garde locale, NON AUTORITAIRE : elle évite un aller-retour en base pour
    // les messages manifestement en cooldown. Elle ne peut que BLOQUER à tort
    // (jamais accorder à tort) — l'autorité reste last_xp_at côté dépôt.
    if (this.isOnCooldown(guildId, userId, cooldownSeconds)) {
      return { handled: false, code: "XP_COOLDOWN" };
    }

    // ── B3 : chemin atomique ──
    // Le dépôt applique gain + cooldown + niveau en une opération sûre en
    // concurrence. Aucun read-modify-write côté service.
    if (typeof this.repository.applyGain === "function") {
      const outcome = await this.repository.applyGain({
        guildId,
        userId,
        gain: xpGain,
        cooldownSeconds,
        computeLevel: (xp) => this.levelService.levelForXp(xp),
        // Le service impose son « maintenant » : dépôt et garde locale doivent
        // raisonner sur le même instant. Sans cela un dépôt construit avec sa
        // propre horloge comparerait last_xp_at à un temps différent.
        now: this.clock(),
      });

      if (!outcome || !outcome.applied) {
        return { handled: false, code: (outcome && outcome.code) || "XP_COOLDOWN" };
      }

      if (cooldownSeconds > 0 && outcome.xpGain > 0) {
        this.cooldowns.set(this._cooldownKey(guildId, userId), this.clock());
      }

      const leveledUp = outcome.level > outcome.previousLevel;
      return {
        handled: true,
        code: leveledUp ? "XP_LEVELED_UP" : "XP_GAINED",
        xpGain: outcome.xpGain,
        xp: outcome.xp,
        level: outcome.level,
        previousLevel: outcome.previousLevel,
        leveledUp,
      };
    }

    // ── Chemin historique (dépôts sans applyGain, ex. Mongo) ──
    // Read-modify-write : conservé pour ne pas casser un dépôt existant, mais
    // il n'est PAS sûr en concurrence. Voir SupabaseXPRepository.
    const existing = await this.repository.findOne(guildId, userId);
    const currentXp = existing ? existing.xp : 0;
    const currentLevel = this.levelService.levelForXp(currentXp);
    const newXp = currentXp + xpGain;
    const newLevel = this.levelService.levelForXp(newXp);
    const leveledUp = newLevel > currentLevel;

    await this.repository.upsert(guildId, userId, newXp, newLevel);
    // Aucun cooldown à mémoriser quand il est désactivé, ni quand le gain est
    // nul : un gain de 0 ne doit jamais bloquer un gain réel ultérieur.
    if (cooldownSeconds > 0 && xpGain > 0) {
      this.cooldowns.set(this._cooldownKey(guildId, userId), this.clock());
    }

    return {
      handled: true,
      code: leveledUp ? "XP_LEVELED_UP" : "XP_GAINED",
      xpGain,
      xp: newXp,
      level: newLevel,
      previousLevel: currentLevel,
      leveledUp,
    };
  }

  clearCooldown(guildId, userId) {
    this.cooldowns.delete(this._cooldownKey(guildId, userId));
  }

  clearAllCooldowns() {
    this.cooldowns.clear();
  }
}

module.exports = { XPService, resolveXpPerMessage, resolveXpCooldownSeconds, normalizeConfiguredInteger };
