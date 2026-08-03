const tempVoiceService = require("../services/tempVoiceService");
module.exports = { name: "voiceStateUpdate", once: false, async execute(oldState, newState) { await tempVoiceService.handleVoiceState(oldState, newState); } };
