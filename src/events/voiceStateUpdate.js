"use strict";

module.exports = {
  name: "voiceStateUpdate",
  once: false,
  async execute(oldState, newState) {
    try {
      await require("../modules/tempvoice/runtime/getTempVoiceRuntime").getTempVoiceRuntime().handleVoiceStateUpdate(oldState, newState);
    } catch {}
  },
};
