"use strict";

const { prefix } = require("../../core/interactions/routeMatchers");
const { AdminPanelComponentId: Id } = require("./configuration/adminPanelConstants");
const routes = require("./interactions/adminPanelRoutes");

// CIVRAT Admin Panel — enregistrement des routes opérationnelles.
// Toutes les routes sont OPEN côté registry (permissions { allOf: [] }) : la
// garde réelle est `requireOperationalAccess` re-vérifiée dans CHAQUE handler
// (Admin persistant OU Owner authentifié). Aucune route CIVRAT_OWNER ici :
// l'identité reste strictement gérée par le module owner-panel.
//
// Le runtime injecté (runtimeFactory) est le OwnerPanelRuntime partagé : il
// expose `identity` (isOwner/isAdmin), `panel` (session Owner) et `admin`
// (AdminPanelService).
function registerAdminPanel({ registry, runtimeFactory }) {
  const runtime = () => runtimeFactory();

  registry.registerButton({ customId: Id.HOME, permissions: { allOf: [] }, execute: (context) => routes.openDashboard(context, runtime()) });
  registry.registerButton({ customId: Id.REFRESH, permissions: { allOf: [] }, execute: (context) => routes.refresh(context, runtime()) });
  registry.registerButton({ customId: Id.PREMIUM, permissions: { allOf: [] }, execute: (context) => routes.openPremium(context, runtime()) });
  registry.registerButton({ customId: Id.SERVERS, permissions: { allOf: [] }, execute: (context) => routes.openServers(context, runtime()) });
  registry.registerButton({ customId: Id.AUDIT, permissions: { allOf: [] }, execute: (context) => routes.openAudit(context, runtime()) });
  registry.registerButton({ customId: Id.SEARCH, permissions: { allOf: [] }, execute: (context) => routes.openSearch(context, runtime()) });
  registry.registerButton({ customId: Id.ACTIVATE, permissions: { allOf: [] }, execute: (context) => routes.openActivate(context, runtime()) });
  registry.registerButton({ customId: Id.BACK, permissions: { allOf: [] }, execute: (context) => routes.back(context, runtime()) });
  registry.registerButton({ customId: Id.AUDIT_FILTER, permissions: { allOf: [] }, execute: (context) => routes.openAuditFilter(context, runtime()) });

  registry.registerModal({ customId: Id.SEARCH_SUBMIT, permissions: { allOf: [] }, execute: (context) => routes.submitSearch(context, runtime()) });
  registry.registerModal({ customId: Id.ACTIVATE_SUBMIT, permissions: { allOf: [] }, execute: (context) => routes.submitActivate(context, runtime()) });
  registry.registerModal({ customId: Id.REMOVE_SUBMIT, permissions: { allOf: [] }, execute: (context) => routes.submitDeactivate(context, runtime(), "remove") });
  registry.registerModal({ customId: Id.REVOKE_SUBMIT, permissions: { allOf: [] }, execute: (context) => routes.submitDeactivate(context, runtime(), "revoke") });
  registry.registerModal({ customId: Id.AUDIT_FILTER_SUBMIT, permissions: { allOf: [] }, execute: (context) => routes.submitAuditFilter(context, runtime()) });

  registry.registerSelectMenu({ customId: Id.PREMIUM_SELECT, permissions: { allOf: [] }, execute: (context) => routes.selectPremiumServer(context, runtime()) });

  // Routes dynamiques (guildId / page dans le customId).
  registry.registerButton({ matcher: prefix(Id.SERVER_PREFIX), permissions: { allOf: [] }, execute: (context) => routes.submitSearch(context, runtime()) });
  registry.registerButton({ matcher: prefix(Id.ACTIVATE_PREFIX), permissions: { allOf: [] }, execute: (context) => routes.openActivate(context, runtime(), context.envelope.customId.slice(Id.ACTIVATE_PREFIX.length)) });
  registry.registerButton({ matcher: prefix(Id.REMOVE_PREFIX), permissions: { allOf: [] }, execute: (context) => routes.openDeactivate(context, runtime(), context.envelope.customId.slice(Id.REMOVE_PREFIX.length), "remove") });
  registry.registerButton({ matcher: prefix(Id.REVOKE_PREFIX), permissions: { allOf: [] }, execute: (context) => routes.openDeactivate(context, runtime(), context.envelope.customId.slice(Id.REVOKE_PREFIX.length), "revoke") });
  registry.registerButton({ matcher: prefix(Id.HISTORY_PREFIX), permissions: { allOf: [] }, execute: (context) => routes.openHistory(context, runtime(), context.envelope.customId.slice(Id.HISTORY_PREFIX.length)) });
  registry.registerButton({ matcher: prefix(Id.PREMIUM_PREV_PREFIX), permissions: { allOf: [] }, execute: (context) => routes.openPremium(context, runtime(), pageFrom(context, Id.PREMIUM_PREV_PREFIX, -1)) });
  registry.registerButton({ matcher: prefix(Id.PREMIUM_NEXT_PREFIX), permissions: { allOf: [] }, execute: (context) => routes.openPremium(context, runtime(), pageFrom(context, Id.PREMIUM_NEXT_PREFIX, 1)) });
  registry.registerButton({ matcher: prefix(Id.AUDIT_PREV_PREFIX), permissions: { allOf: [] }, execute: (context) => routes.openAudit(context, runtime(), pageFrom(context, Id.AUDIT_PREV_PREFIX, -1)) });
  registry.registerButton({ matcher: prefix(Id.AUDIT_NEXT_PREFIX), permissions: { allOf: [] }, execute: (context) => routes.openAudit(context, runtime(), pageFrom(context, Id.AUDIT_NEXT_PREFIX, 1)) });

  return { routes };
}

function pageFrom(context, prefixId, delta) {
  const raw = context.envelope.customId.slice(prefixId.length);
  const page = Number.parseInt(raw, 10);
  return (Number.isInteger(page) ? page : 0) + delta;
}

module.exports = { registerAdminPanel };
