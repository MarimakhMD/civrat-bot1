"use strict";

const logger = require("../utils/logger");

module.exports = {
  name: "voiceStateUpdate",
  once: false,
  async execute(oldState, newState) {
    try {
      await require("../modules/tempvoice/runtime/getTempVoiceRuntime").getTempVoiceRuntime().handleVoiceStateUpdate(oldState, newState);
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("tempvoice voiceStateUpdate handling failed", { event: "tempvoice_failed", guildId: newState?.guild?.id || oldState?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
