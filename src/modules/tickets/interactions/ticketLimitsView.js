"use strict";
const { TicketComponentId: Id } = require("../configuration/ticketConstants");

function ticketLimitsView({ t, config, globalLimit }) {
  const limit = globalLimit ?? config.ticket_global_limit ?? config.global_limit ?? 1;
  return {
    title: t("tickets.limitsTitle"),
    content: `${t("tickets.limitsDescription")}\n${t("tickets.globalLimit")}: ${limit}\n${t("tickets.globalLimitHelp")}`,
    components: [
      { type: "string-select", customId: Id.GLOBAL_LIMIT, placeholder: t("tickets.globalLimit"), options: [1,2,3,4,5].map(n => ({ label: `${n} ticket${n>1?"s":""}`, value: String(n), default: Number(limit)===n })) },
      { type: "button", customId: Id.PANEL, label: t("tickets.back"), style: "secondary" },
    ],
  };
}

module.exports = { ticketLimitsView };
