"use strict";

const AutoModPunishment = Object.freeze({
  NONE: "none",
  WARN: "warn",
  TIMEOUT: "timeout",
});

/**
 * Centralizes the AutoMod sanction decision.
 * Transport-neutral and pure: no Discord, no Supabase, no side effects.
 * Conserves the Detection Engine contract and prepares Security.
 */
class AutoModDecisionService {
  decide({ detection, config }) {
    if (!detection || !detection.matched) {
      return {
        type: AutoModPunishment.NONE,
        reason: null,
        rule: null,
        rules: [],
        deleteMessage: Boolean(config && config.automod_delete_message),
      };
    }

    const rawPunishment = config && config.automod_punishment;
    const type = rawPunishment === AutoModPunishment.WARN || rawPunishment === AutoModPunishment.TIMEOUT ? rawPunishment : AutoModPunishment.NONE;

    const durationMinutes = type === AutoModPunishment.TIMEOUT ? this._resolveTimeoutMinutes(config) : null;
    const reason = `AutoMod: ${detection.code}`;
    return {
      type,
      durationMinutes,
      reason,
      rule: detection.code,
      rules: Array.isArray(detection.rules) ? [...detection.rules] : [detection.code],
      deleteMessage: Boolean(config && config.automod_delete_message),
    };
  }

  _resolveTimeoutMinutes(config) {
    const raw = Number(config && config.automod_timeout_minutes);
    if (!Number.isFinite(raw)) return 10;
    // Discord timeout limits: 1 minute to 28 days (40320 minutes)
    if (raw < 1) return 1;
    if (raw > 40320) return 40320;
    return Math.floor(raw);
  }
}

module.exports = { AutoModDecisionService, AutoModPunishment };
