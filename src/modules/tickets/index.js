"use strict";
module.exports = {
  ...require("./register"),
  ...require("./services/TicketConfigService"),
  ...require("./services/TicketService"),
  ...require("./services/TicketWelcomeService"),
  ...require("./services/TicketPermissionService"),
  ...require("./services/TicketTranscriptService"),
  ...require("./services/TicketPremiumConfigResolver"),
  ...require("./services/TicketChannelNamingService"),
  ...require("./services/TicketPlaceholderRenderer"),
  ...require("./persistence/TicketCounterRepository"),
  ...require("./persistence/SupabaseTicketCounterRepository"),
  ...require("./persistence/InMemoryTicketCounterRepository"),
  ...require("./configuration/ticketPremiumConstants"),
  ...require("./configuration/ticketPremiumDefaults"),
  ...require("./configuration/ticketPremiumConfigSchema"),
  ...require("./configuration/ticketPremiumValidation"),
};
