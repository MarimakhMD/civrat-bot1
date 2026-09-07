"use strict";

module.exports = {
  ...require("./register"),
  ...require("./services/TempVoiceConfigService"),
  ...require("./services/TempVoiceService"),
  ...require("./services/TempVoiceReconciliationService"),
  // B5-b — dépôts de persistance des salons temporaires (même convention que
  // src/modules/xp/index.js, qui expose ses implémentations).
  ...require("./persistence/TempVoiceRepository"),
  ...require("./persistence/SupabaseTempVoiceRepository"),
};
