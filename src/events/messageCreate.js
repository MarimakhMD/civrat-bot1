"use strict";

const { getAutoModRuntime } = require("../modules/automod/runtime/getAutoModRuntime");
const logger = require("../utils/logger");

module.exports = {
  name: "messageCreate",
  once: false,
  async execute(message) {
    // AutoMod (must never break message processing)
    try {
      if (!message || !message.guild || (message.author && message.author.bot)) return;
      await getAutoModRuntime().handleMessage(message);
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé, l'échec est désormais visible.
      logger.warn("AutoMod processing failed", {
        event: "automod_failed",
        guildId: message?.guild?.id || null,
        error: error?.message || String(error),
      });
    }
    // XP (must never break message processing, respects cooldown and config)
    try {
      if (!message || !message.guild || (message.author && message.author.bot)) return;
      await require("../modules/xp/runtime/getXPRuntime").getXPRuntime().handleMessage(message);
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé, l'échec est désormais visible.
      logger.warn("XP processing failed", {
        event: "xp_failed",
        guildId: message?.guild?.id || null,
        error: error?.message || String(error),
      });
    }
    // Analytics (must never break, isolated try/catch)
    try {
      if (!message || !message.guild || (message.author && message.author.bot)) return;
      await require("../modules/analytics/runtime/getAnalyticsRuntime").getAnalyticsRuntime().trackMessage(message);
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé, l'échec est désormais visible.
      logger.warn("Analytics processing failed", {
        event: "analytics_failed",
        guildId: message?.guild?.id || null,
        error: error?.message || String(error),
      });
    }
  },
};
