"use strict";
module.exports = {
  ...require("./register"),
  ...require("./services/TicketConfigService"),
  ...require("./services/TicketService"),
  ...require("./services/TicketWelcomeService"),
  ...require("./services/TicketPermissionService"),
  ...require("./services/TicketTranscriptService"),
  ...require("./services/TicketPremiumConfigResolver"),
  ...require("./configuration/ticketPremiumConstants"),
  ...require("./configuration/ticketPremiumDefaults"),
  ...require("./configuration/ticketPremiumConfigSchema"),
  ...require("./configuration/ticketPremiumValidation"),
};
