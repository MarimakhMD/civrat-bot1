"use strict";

module.exports = {
  ...require("./register"),
  ...require("./services/AnalyticsConfigService"),
  ...require("./services/AnalyticsService"),
};
