"use strict";

const { PermissionName } = require("../../core/permissions");
const { prefix } = require("../../core/interactions/routeMatchers");
const { TicketComponentId: Id } = require("./configuration/ticketConstants");
const { ticketView } = require("./interactions/ticketViews");
const { toggleTickets, selectTicket, previewTickets } = require("./interactions/configureTickets");
const { handleTicketCreate, handleLegacyTicketCreate } = require("./interactions/ticketCreateRoute");
const {
  openTicketPanels,
  createTicketPanel,
  openPanelDetail,
  openPanelEditModal,
  submitPanelEdit,
  deleteTicketPanel,
} = require("./interactions/ticketPanelRoutes");
const { handleTicketClose } = require("./interactions/ticketCloseRoute");
const { handleTicketReopen } = require("./interactions/ticketReopenRoute");
const { handleTicketDelete } = require("./interactions/ticketDeleteRoute");
const { openTicketRename, handleTicketRename } = require("./interactions/ticketRenameRoute");
const { openMemberModal, handleMemberAccess } = require("./interactions/ticketMemberAccessRoute");
const { handleTicketClaim } = require("./interactions/ticketClaimRoute");
const { openPremiumPanel, openPremiumPanelModal, submitPremiumPanel, resetPremiumPanel, previewPremiumPanel, openPremiumWelcomeModal, submitPremiumWelcome, previewPremiumWelcome, selectPremiumTranscript, openPremiumFormatModal, submitPremiumFormat } = require("./interactions/premiumPanel");

function registerTickets({ registry, service, creationServiceFactory = null, settingsHome = null, premiumConfigResolver = null, panelRepository = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  registry.registerButton({ customId: Id.PANEL, permissions, execute: async (c) => c.envelope.transport.update({ view: ticketView({ t: c.t, config: await service.read(c.guildId) }) }) });
  registry.registerButton({ customId: Id.TOGGLE, permissions, execute: async (c) => toggleTickets({ ...c, service }) });
  registry.registerSelectMenu({ customId: Id.CATEGORY, permissions, execute: async (c) => selectTicket({ ...c, service }) });
  registry.registerSelectMenu({ customId: Id.SUPPORT_ROLE, permissions, execute: async (c) => selectTicket({ ...c, service }) });
  // P13 (B3) : sélecteur du salon de logs/transcripts Free.
  registry.registerSelectMenu({ customId: Id.LOG_CHANNEL, permissions, execute: async (c) => selectTicket({ ...c, service }) });
  registry.registerButton({ customId: Id.PREVIEW, permissions, execute: async (c) => previewTickets({ ...c, service }) });
  // ─────────────────────────────────────────────────────────────────────────
  // M8 — deux routes de création, qui coexistent.
  //
  // InteractionRegistry accepte un matcher `exact` ET un matcher `prefix` sur le
  // même préfixe : overlaps() renvoie false dans les deux sens, donc il n'y a
  // pas d'ambiguïté (vérifié par exécution).
  //
  //  · exact  civrat:v1:tickets:create
  //      → panels envoyés AVANT M8. Aucun message_id n'était stocké, donc ces
  //        panels sont irretrouvables : refus propre demandant de les recréer.
  //  · prefix civrat:v1:tickets:create:
  //      → civrat:v1:tickets:create:<panelId>:<buttonIndex>, panels M8.
  // ─────────────────────────────────────────────────────────────────────────
  registry.registerButton({ customId: Id.CREATE, permissions: { allOf: [] }, execute: async (c) => handleLegacyTicketCreate(c) });
  registry.registerButton({ matcher: prefix(Id.CREATE_PREFIX), permissions: { allOf: [] }, execute: async (c) => handleTicketCreate(c, creationServiceFactory, panelRepository) });
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
  // Phase 10.3 — contenu du ticket : mêmes garanties fail-closed que le panneau.
  registry.registerButton({ customId: Id.PREMIUM_EDIT_WELCOME, permissions, execute: async (c) => openPremiumWelcomeModal({ ...c, service, premiumConfigResolver }) });
  registry.registerModal({ customId: Id.PREMIUM_EDIT_WELCOME_SUBMIT, permissions, execute: async (c) => submitPremiumWelcome({ ...c, service, premiumConfigResolver }) });
  registry.registerButton({ customId: Id.PREMIUM_PREVIEW_WELCOME, permissions, execute: async (c) => previewPremiumWelcome({ ...c, service, premiumConfigResolver }) });
  registry.registerSelectMenu({ customId: Id.PREMIUM_TRANSCRIPT, permissions, execute: async (c) => selectPremiumTranscript({ ...c, service, premiumConfigResolver }) });
  // Phase 10.4 — format de nommage : mêmes garanties fail-closed.
  registry.registerButton({ customId: Id.PREMIUM_EDIT_FORMAT, permissions, execute: async (c) => openPremiumFormatModal({ ...c, service, premiumConfigResolver }) });
  registry.registerModal({ customId: Id.PREMIUM_EDIT_FORMAT_SUBMIT, permissions, execute: async (c) => submitPremiumFormat({ ...c, service, premiumConfigResolver }) });
  // ─────────────────────────────────────────────────────────────────────────
  // M8 — gestion des panels persistants (sous-vue de /settings).
  //
  // Toutes ces routes sont protégées par MANAGE_GUILD : créer, éditer ou
  // désactiver un panel est un acte d'administration. Seule l'OUVERTURE d'un
  // ticket (les deux routes ci-dessus) est publique.
  //
  // Les routes portant un panelId utilisent un matcher `prefix` : l'identifiant
  // est suffixé au customId, comme le font déjà admin-panel, giveaways,
  // suggestions et automod.
  // ─────────────────────────────────────────────────────────────────────────
  registry.registerButton({ customId: Id.PANELS_SECTION, permissions, execute: async (c) => openTicketPanels({ ...c, service, premiumConfigResolver, panelRepository }) });
  registry.registerSelectMenu({ customId: Id.PANELS_CREATE, permissions, execute: async (c) => createTicketPanel({ ...c, service, premiumConfigResolver, panelRepository }) });
  registry.registerButton({ matcher: prefix(Id.PANELS_DETAIL_PREFIX), permissions, execute: async (c) => openPanelDetail({ ...c, service, premiumConfigResolver, panelRepository }) });
  registry.registerButton({ matcher: prefix(Id.PANELS_EDIT_PREFIX), permissions, execute: async (c) => openPanelEditModal({ ...c, service, premiumConfigResolver, panelRepository }) });
  registry.registerModal({ matcher: prefix(Id.PANELS_EDIT_SUBMIT_PREFIX), permissions, execute: async (c) => submitPanelEdit({ ...c, service, premiumConfigResolver, panelRepository }) });
  registry.registerButton({ matcher: prefix(Id.PANELS_DELETE_PREFIX), permissions, execute: async (c) => deleteTicketPanel({ ...c, service, premiumConfigResolver, panelRepository }) });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });
  // premiumConfigResolver : injection Phase 10.1 (fondations Ticket Premium).
  // Conservé ici pour les phases 10.2+ (panneau personnalisé, accueil,
  // nommage) ; aucune route ci-dessus ne le consomme encore.
  return { id: Id.PANEL, permissions, premiumConfigResolver };
}

module.exports = { registerTickets };
