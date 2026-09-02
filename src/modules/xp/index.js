"use strict";

module.exports = {
  ...require("./register"),
  ...require("./services/XPConfigService"),
  ...require("./services/XPService"),
  ...require("./services/LevelService"),
  // B3 — dépôts XP. Même convention que src/modules/tickets/index.js, qui
  // expose ses implémentations de persistence.
  ...require("./persistence/XPRepository"),
  ...require("./persistence/SupabaseXPRepository"),
};
