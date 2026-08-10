"use strict";

module.exports = {
  ...require("./register"),
  ...require("./services/SecurityConfigService"),
  ...require("./services/SecurityRaidService"),
  ...require("./services/SecurityBotService"),
  ...require("./services/SecurityNukeService"),
};
