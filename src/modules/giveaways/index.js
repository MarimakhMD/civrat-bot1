"use strict";

module.exports = {
  ...require("./register"),
  ...require("./services/GiveawayConfigService"),
  ...require("./services/GiveawayService"),
};
