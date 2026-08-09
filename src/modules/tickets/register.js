"use strict";

const { PermissionName } = require("../../core/permissions");
const { TicketComponentId: Id } = require("./configuration/ticketConstants");
const { ticketView } = require("./interactions/ticketViews");
const { toggleTickets, selectTicket, previewTickets } = require("./interactions/configureTickets");
const { handleTicketCreate } = require("./interactions/ticketCreateRoute");
const { handleTicketClose } = require("./interactions/ticketCloseRoute");
const { handleTicketReopen } = require("./interactions/ticketReopenRoute");
const { handleTicketDelete } = require("./interactions/ticketDeleteRoute");
const { openTicketRename, handleTicketRename } = require("./interactions/ticketRenameRoute");
const { openMemberModal, handleMemberAccess } = require("./interactions/ticketMemberAccessRoute");

function registerTickets({ registry, service, creationServiceFactory = null, settingsHome = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  registry.registerButton({ customId: Id.PANEL, permissions, execute: async (c) => c.envelope.transport.update({ view: ticketView({ t: c.t, config: await service.read(c.guildId) }) }) });
  registry.registerButton({ customId: Id.TOGGLE, permissions, execute: async (c) => toggleTickets({ ...c, service }) });
  registry.registerSelectMenu({ customId: Id.CATEGORY, permissions, execute: async (c) => selectTicket({ ...c, service }) });
  registry.registerSelectMenu({ customId: Id.SUPPORT_ROLE, permissions, execute: async (c) => selectTicket({ ...c, service }) });
  registry.registerButton({ customId: Id.PREVIEW, permissions, execute: async (c) => previewTickets({ ...c, service }) });
  registry.registerButton({ customId: Id.CREATE, permissions: { allOf: [] }, execute: async (c) => handleTicketCreate(c, creationServiceFactory) });
  registry.registerButton({ customId: Id.CLOSE, permissions: { allOf: [] }, execute: async (c) => handleTicketClose(c, creationServiceFactory) });
  registry.registerButton({ customId: Id.REOPEN, permissions: { allOf: [] }, execute: async (c) => handleTicketReopen(c, creationServiceFactory) });
  registry.registerButton({ customId: Id.DELETE, permissions: { allOf: [] }, execute: async (c) => handleTicketDelete(c, creationServiceFactory) });
  registry.registerButton({ customId: Id.RENAME, permissions: { allOf: [] }, execute: openTicketRename });
  registry.registerModal({ customId: Id.RENAME_SUBMIT, permissions: { allOf: [] }, execute: async (c) => handleTicketRename(c, creationServiceFactory) });
  registry.registerButton({ customId: Id.ADD_MEMBER, permissions: { allOf: [] }, execute: openMemberModal("add") });
  registry.registerButton({ customId: Id.REMOVE_MEMBER, permissions: { allOf: [] }, execute: openMemberModal("remove") });
  registry.registerModal({ customId: Id.ADD_MEMBER_SUBMIT, permissions: { allOf: [] }, execute: async (c) => handleMemberAccess(c, creationServiceFactory, "add") });
  registry.registerModal({ customId: Id.REMOVE_MEMBER_SUBMIT, permissions: { allOf: [] }, execute: async (c) => handleMemberAccess(c, creationServiceFactory, "remove") });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });
  return { id: Id.PANEL, permissions };
}

module.exports = { registerTickets };
