"use strict";

module.exports = {
  ...require("./commands/adminCommand"),
  ...require("./register"),
  ...require("./services/AdminPanelService"),
  ...require("./services/AdminSystemService"),
  ...require("./services/TechnicalAdminProvider"),
};
