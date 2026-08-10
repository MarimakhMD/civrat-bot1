"use strict";

const SecurityBotReason = Object.freeze({
  NONE: null,
  NOT_A_BOT: "NOT_A_BOT",
  ANTI_BOT_DISABLED: "ANTI_BOT_DISABLED",
  BOT_WHITELISTED: "BOT_WHITELISTED",
  BOT_NOT_WHITELISTED: "BOT_NOT_WHITELISTED",
});

/**
 * Transport-neutral bot whitelist check.
 * Pure, no Discord, no store.
 */
class SecurityBotService {
  check({ isBot, userId, config }) {
    if (!isBot) {
      return { allowed: true, reason: SecurityBotReason.NOT_A_BOT };
    }
    if (!config || !config.security_anti_bot) {
      return { allowed: true, reason: SecurityBotReason.ANTI_BOT_DISABLED };
    }
    const whitelist = Array.isArray(config.security_whitelist) ? config.security_whitelist : [];
    const normalized = whitelist.map((id) => String(id));
    if (userId && normalized.includes(String(userId))) {
      return { allowed: true, reason: SecurityBotReason.BOT_WHITELISTED };
    }
    return { allowed: false, reason: SecurityBotReason.BOT_NOT_WHITELISTED };
  }
}

module.exports = { SecurityBotService, SecurityBotReason };
