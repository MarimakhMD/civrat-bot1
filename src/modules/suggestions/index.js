"use strict";

module.exports = {
  ...require("./register"),
  ...require("./services/SuggestionConfigService"),
  ...require("./services/SuggestionService"),
};
