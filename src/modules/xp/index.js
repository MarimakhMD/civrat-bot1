"use strict";

module.exports = {
  ...require("./register"),
  ...require("./services/XPConfigService"),
  ...require("./services/XPService"),
  ...require("./services/LevelService"),
};
