"use strict";

const { EntitlementFeature } = require("../../../core/entitlements");
const { AdminPanelComponentId: Id, AdminPanelFieldId: Field, AdminPanelPolicy } = require("../configuration/adminPanelConstants");
const views = require("./adminPanelViews");

// CIVRAT Admin Panel — routes opérationnelles (Premium / Serveurs / Stats /
// Audit). Modèle d'accès (jamais déroger) :
//   1. chaque handler re-vérifie l'accès en direct : Admin CIVRAT (statut
//      persistant, sans session ni code) OU Owner authentifié (session 24 h) ;
//   2. tout le reste reçoit le refus générique éphémère (aucune fuite oracle) ;
//   3. aucune mutation d'identité ici : ADD_ADMIN / REMOVE_ADMIN / TRANSFER /
//      Recovery restent des routes Owner-only du module owner-panel.
// Aucun secret ne transite par ces routes (que des ids, plans, dates, raisons).

function suffixAfter(customId, prefix) {
  return typeof customId === "string" && customId.startsWith(prefix) ? customId.slice(prefix.length) : null;
}

async function isOwner(context, runtime) {
  return runtime.identity.isOwner(context.userId);
}

async function isAdmin(context, runtime) {
  return runtime.identity.isAdmin(context.userId);
}

async function requireOperationalAccess(context, runtime) {
  const userId = context.userId;
  if (await isAdmin(context, runtime)) return true;
  if ((await isOwner(context, runtime)) && runtime.panel.authenticate(userId)) return true;
  await context.envelope.transport.reply({ view: views.refusedView(context.t), ephemeral: true });
  return false;
}

async function replyRefused(context) {
  return context.envelope.transport.reply({ view: views.refusedView(context.t), ephemeral: true });
}

function guildNameResolver(context) {
  return (guildId) => {
    const client = context.envelope.discordClient || null;
    return client?.guilds?.cache?.get?.(guildId)?.name || null;
  };
}

function clientGuildCount(context) {
  const client = context.envelope.discordClient || null;
  const size = client?.guilds?.cache?.size;
  return Number.isInteger(size) ? size : null;
}

function readField(context, fieldId) {
  const values = context.envelope.modalValues || {};
  const value = values[fieldId];
  return typeof value === "string" ? value.trim() : "";
}

// ---------- Dashboard ----------
async function openDashboard(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const [stats, recent] = await Promise.all([
    runtime.admin.getDashboardStats({ clientGuildCount: clientGuildCount(context) }),
    runtime.admin.getRecentActions({ limit: 5 }),
  ]);
  await context.envelope.transport.reply({ view: views.dashboardView(context.t, stats, recent), ephemeral: true });
  return { stats };
}

async function refresh(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const [stats, recent] = await Promise.all([
    runtime.admin.getDashboardStats({ clientGuildCount: clientGuildCount(context) }),
    runtime.admin.getRecentActions({ limit: 5 }),
  ]);
  await context.envelope.transport.update({ view: views.dashboardView(context.t, stats, recent) });
  return { stats };
}

// ---------- Premium ----------
async function openPremium(context, runtime, page = 0) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const list = await runtime.admin.listPremiumServers({ page, pageSize: AdminPanelPolicy.PAGE_SIZE, guildNameResolver: guildNameResolver(context) });
  await context.envelope.transport.reply({ view: views.premiumView(context.t, list), ephemeral: true });
  return list;
}

async function openServers(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  await context.envelope.transport.reply({ view: views.serversView(context.t), ephemeral: true });
  return null;
}

async function openSearch(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  await context.envelope.transport.showModal(views.searchModal(context.t));
  return null;
}

async function submitSearch(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const guildId = readField(context, Field.GUILD_ID);
  const info = await runtime.admin.getServerInfo(guildId, { guildNameResolver: guildNameResolver(context) });
  if (!info.ok) return replyRefused(context);
  await context.envelope.transport.reply({ view: views.serverView(context.t, info.server), ephemeral: true });
  return info;
}

async function selectPremiumServer(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const guildId = context.envelope.values?.[0] || null;
  const info = await runtime.admin.getServerInfo(guildId, { guildNameResolver: guildNameResolver(context) });
  if (!info.ok) return replyRefused(context);
  await context.envelope.transport.update({ view: views.serverView(context.t, info.server) });
  return info;
}

// ---------- Activation ----------
async function openActivate(context, runtime, guildId = "") {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  await context.envelope.transport.showModal(views.activateModal(context.t, { guildId }));
  return null;
}

async function submitActivate(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const guildId = readField(context, Field.GUILD_ID);
  const plan = readField(context, Field.PLAN) || EntitlementFeature.TICKET_PREMIUM;
  const expiresRaw = readField(context, Field.EXPIRES_IN_DAYS);
  const expiresInDays = expiresRaw === "" ? null : Number(expiresRaw);
  const result = await runtime.admin.activatePremium({ actorId: context.userId, guildId, plan, expiresInDays, reason: null });
  if (!result.ok) return replyRefused(context);
  await context.envelope.transport.reply({ view: views.resultView(context.t, "adminpanel.premiumActivated"), ephemeral: true });
  return result;
}

// ---------- Désactivation / révocation ----------
async function openDeactivate(context, runtime, guildId, kind) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const info = await runtime.admin.getServerInfo(guildId, { guildNameResolver: guildNameResolver(context) });
  const plan = pickPlan(info.ok ? info.server.status : []);
  await context.envelope.transport.showModal(views.deactivateModal(context.t, { guildId, plan, titleKey: kind === "revoke" ? "adminpanel.revokePremium" : "adminpanel.removePremium" }));
  return null;
}

async function submitDeactivate(context, runtime, kind) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const guildId = readField(context, Field.GUILD_ID);
  const plan = readField(context, Field.PLAN);
  const reason = readField(context, Field.REASON) || null;
  const result = kind === "revoke"
    ? await runtime.admin.revokePremiumForAbuse({ actorId: context.userId, guildId, plan, reason })
    : await runtime.admin.removePremium({ actorId: context.userId, guildId, plan, reason });
  if (!result.ok) return replyRefused(context);
  await context.envelope.transport.reply({ view: views.resultView(context.t, kind === "revoke" ? "adminpanel.premiumRevoked" : "adminpanel.premiumRemoved"), ephemeral: true });
  return result;
}

function pickPlan(status) {
  const features = (status || []).map((s) => s.feature).filter(Boolean);
  if (features.includes(EntitlementFeature.TICKET_PREMIUM)) return EntitlementFeature.TICKET_PREMIUM;
  if (features.includes(EntitlementFeature.WELCOME_IMAGE)) return EntitlementFeature.WELCOME_IMAGE;
  return EntitlementFeature.TICKET_PREMIUM;
}

// ---------- Historique serveur ----------
async function openHistory(context, runtime, guildId, page = 0) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const history = await runtime.admin.getHistory(guildId, { page, pageSize: AdminPanelPolicy.PAGE_SIZE });
  if (!history.ok) return replyRefused(context);
  await context.envelope.transport.reply({ view: views.historyView(context.t, guildId, history), ephemeral: true });
  return history;
}

// ---------- Audit ----------
async function openAudit(context, runtime, page = 0, guildId = null) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const audit = await runtime.admin.listAudit({ page, pageSize: AdminPanelPolicy.PAGE_SIZE, guildId });
  await context.envelope.transport.reply({ view: views.auditView(context.t, audit, guildId), ephemeral: true });
  return audit;
}

async function openAuditFilter(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  await context.envelope.transport.showModal(views.auditFilterModal(context.t));
  return null;
}

async function submitAuditFilter(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const guildId = readField(context, Field.GUILD_ID);
  return openAudit(context, runtime, 0, guildId);
}

async function back(context, runtime) {
  return openDashboard(context, runtime);
}

module.exports = {
  openDashboard,
  refresh,
  openPremium,
  openServers,
  openSearch,
  submitSearch,
  selectPremiumServer,
  openActivate,
  submitActivate,
  openDeactivate,
  submitDeactivate,
  openHistory,
  openAudit,
  openAuditFilter,
  submitAuditFilter,
  back,
  pickPlan,
  requireOperationalAccess,
};
