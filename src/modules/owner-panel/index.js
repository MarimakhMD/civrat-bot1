"use strict";
module.exports = {
  ...require("./register"),
  ...require("./services/CivratIdentityService"),
  ...require("./services/OwnerPanelService"),
  ...require("./services/CivratIdentityOwnerProvider"),
  ...require("./persistence/SupabaseCivratIdentityRepository"),
  ...require("./configuration/ownerPanelConstants"),
};
