"use strict";
module.exports = {
  ...require("./register"),
  ...require("./services/AutoModConfigService"),
  ...require("./services/AutoModDecisionService"),
  ...require("./services/AutoModEnforcementService"),
};
