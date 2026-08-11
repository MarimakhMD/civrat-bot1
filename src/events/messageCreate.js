"use strict";

const { getAutoModRuntime } = require("../modules/automod/runtime/getAutoModRuntime");

module.exports = {
  name: "messageCreate",
  once: false,
  async execute(message) {
    // AutoMod (must never break message processing)
    try {
      if (!message || !message.guild || (message.author && message.author.bot)) return;
      await getAutoModRuntime().handleMessage(message);
    } catch {
      /* AutoMod failures must never break message processing */
    }
    // XP (must never break message processing, respects cooldown and config)
    try {
      if (!message || !message.guild || (message.author && message.author.bot)) return;
      await require("../modules/xp/runtime/getXPRuntime").getXPRuntime().handleMessage(message);
    } catch {
      /* XP failures must never break message processing */
    }
    // Analytics (must never break, isolated try/catch)
    try {
      if (!message || !message.guild || (message.author && message.author.bot)) return;
      await require("../modules/analytics/runtime/getAnalyticsRuntime").getAnalyticsRuntime().trackMessage(message);
    } catch {
      /* Analytics failures must never break message processing */
    }
  },
};
