"use strict";

module.exports = {
  ...require("./register"),
  ...require("./services/TempVoiceConfigService"),
  ...require("./services/TempVoiceService"),
};
