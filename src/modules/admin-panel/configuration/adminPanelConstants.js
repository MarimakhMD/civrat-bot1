"use strict";

const {
  EntitlementFeature,
  TECHNICAL_PREMIUM_GUILD_ID,
} = require("../../../core/entitlements");

// CIVRAT Admin Panel — ids de composants, ids de champs et limites de
// politique. AUCUNE valeur secrète ici (que des ids et des limites).
const AdminPanelComponentId = Object.freeze({
  HOME: "adminpanel:home",
  REFRESH: "adminpanel:refresh",
  PREMIUM: "adminpanel:premium",
  SERVERS: "adminpanel:servers",
  DIAGNOSTICS: "adminpanel:diagnostics",
  CONFIGURATION: "adminpanel:configuration",
  OWNER: "adminpanel:owner",
  RECOVERY: "adminpanel:recovery",
  AUDIT: "adminpanel:audit",
  SEARCH: "adminpanel:search",
  SEARCH_SUBMIT: "adminpanel:search:submit",
  ACTIVATE: "adminpanel:activate",
  ACTIVATE_PREFIX: "adminpanel:activate:",
  ACTIVATE_SUBMIT: "adminpanel:activate:submit",
  REMOVE_PREFIX: "adminpanel:remove:",
  REMOVE_SUBMIT: "adminpanel:remove:submit",
  REVOKE_PREFIX: "adminpanel:revoke:",
  REVOKE_SUBMIT: "adminpanel:revoke:submit",
  SERVER_PREFIX: "adminpanel:server:",
  HISTORY_PREFIX: "adminpanel:history:",
  PREMIUM_SELECT: "adminpanel:premium:select",
  PREMIUM_PREV_PREFIX: "adminpanel:list:prev:",
  PREMIUM_NEXT_PREFIX: "adminpanel:list:next:",
  AUDIT_PREV_PREFIX: "adminpanel:audit:prev:",
  AUDIT_NEXT_PREFIX: "adminpanel:audit:next:",
  AUDIT_FILTER: "adminpanel:audit:filter",
  AUDIT_FILTER_SUBMIT: "adminpanel:audit:filter:submit",
  BACK: "adminpanel:back",
});

const AdminPanelFieldId = Object.freeze({
  GUILD_ID: "admin_guild_id",
  PLAN: "admin_plan",
  EXPIRES_IN_DAYS: "admin_expires_in_days",
  REASON: "admin_reason",
});

const AdminPanelPolicy = Object.freeze({
  PAGE_SIZE: 5,
  DISCORD_ID_PATTERN: /^\d{16,20}$/,
  MAX_REASON_LENGTH: 500,
  MAX_EXPIRES_IN_DAYS: 3650, // 10 ans max (anti-typo)
  HISTORY_LIMIT: 10, // historique Premium affiché par serveur
});

// Plans gérables par le panneau : toutes les features entitlement connues.
const ADMIN_PLANS = Object.freeze([EntitlementFeature.TICKET_PREMIUM, EntitlementFeature.WELCOME_IMAGE]);

// Statuts d'entitlement utilisés par les désactivations.
const AdminPanelEntitlementStatus = Object.freeze({
  INACTIVE: "inactive",
  REVOKED: "revoked",
});

module.exports = {
  AdminPanelComponentId,
  AdminPanelFieldId,
  AdminPanelPolicy,
  AdminPanelEntitlementStatus,
  ADMIN_PLANS,
  TECHNICAL_PREMIUM_GUILD_ID,
};
