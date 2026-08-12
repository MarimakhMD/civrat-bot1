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
const { handleTicketClaim } = require("./interactions/ticketClaimRoute");
const { openPremiumPanel, openPremiumPanelModal, submitPremiumPanel, resetPremiumPanel, previewPremiumPanel } = require("./interactions/premiumPanel");

function registerTickets({ registry, service, creationServiceFactory = null, settingsHome = null, premiumConfigResolver = null }) {
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
  registry.registerButton({ customId: Id.CLAIM, permissions: { allOf: [] }, execute: async (c) => handleTicketClaim(c, creationServiceFactory) });
  registry.registerModal({ customId: Id.RENAME_SUBMIT, permissions: { allOf: [] }, execute: async (c) => handleTicketRename(c, creationServiceFactory) });
  registry.registerButton({ customId: Id.ADD_MEMBER, permissions: { allOf: [] }, execute: openMemberModal("add") });
  registry.registerButton({ customId: Id.REMOVE_MEMBER, permissions: { allOf: [] }, execute: openMemberModal("remove") });
  registry.registerModal({ customId: Id.ADD_MEMBER_SUBMIT, permissions: { allOf: [] }, execute: async (c) => handleMemberAccess(c, creationServiceFactory, "add") });
  registry.registerModal({ customId: Id.REMOVE_MEMBER_SUBMIT, permissions: { allOf: [] }, execute: async (c) => handleMemberAccess(c, creationServiceFactory, "remove") });
  // Phase 10.2 — sous-vue « Personnalisation Premium » du panneau. Toutes ces
  // routes revérifient l'entitlement TICKET_PREMIUM à l'exécution : sans
  // resolver injecté ou sans entitlement actif, seule la vue verrouillée
  // s'affiche et aucune écriture Premium n'a lieu.
  registry.registerButton({ customId: Id.PREMIUM_SECTION, permissions, execute: async (c) => openPremiumPanel({ ...c, service, premiumConfigResolver }) });
  registry.registerButton({ customId: Id.PREMIUM_EDIT, permissions, execute: async (c) => openPremiumPanelModal({ ...c, service, premiumConfigResolver }) });
  registry.registerModal({ customId: Id.PREMIUM_EDIT_SUBMIT, permissions, execute: async (c) => submitPremiumPanel({ ...c, service, premiumConfigResolver }) });
  registry.registerButton({ customId: Id.PREMIUM_RESET, permissions, execute: async (c) => resetPremiumPanel({ ...c, service, premiumConfigResolver }) });
  registry.registerButton({ customId: Id.PREMIUM_PREVIEW, permissions, execute: async (c) => previewPremiumPanel({ ...c, service, premiumConfigResolver }) });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });
  // premiumConfigResolver : injection Phase 10.1 (fondations Ticket Premium).
  // Conservé ici pour les phases 10.2+ (panneau personnalisé, accueil,
  // nommage) ; aucune route ci-dessus ne le consomme encore.
  return { id: Id.PANEL, permissions, premiumConfigResolver };
}

module.exports = { registerTickets };
