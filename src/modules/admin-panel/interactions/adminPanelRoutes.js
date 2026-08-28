"use strict";

const { EntitlementFeature } = require("../../../core/entitlements");
const { AdminPanelComponentId: Id, AdminPanelFieldId: Field, AdminPanelPolicy } = require("../configuration/adminPanelConstants");
const { OwnerPanelFieldId } = require("../../owner-panel/configuration/ownerPanelConstants");
const { RecoveryFieldId } = require("../../recovery/configuration/recoveryConstants");
const ownerViews = require("../../owner-panel/interactions/ownerPanelViews");
const recoveryViews = require("../../recovery/interactions/recoveryViews");
const views = require("./adminPanelViews");

// Toutes les routes revalident la garde technique guilde + salon + rôle, même
// si le router applique déjà CIVRAT_ADMIN. La section Owner exige en plus
// l'identité Owner existante et une session créée par comparaison env-only du
// Master Code. Tous les refus utilisent une réponse générique éphémère.

async function isOwner(context, runtime) {
  return runtime.identity.isOwner(context.userId);
}

async function requireOperationalAccess(context, runtime) {
  const granted = await runtime.technicalAdminProvider?.isAdmin?.(context);
  if (granted) return true;
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
async function dashboardData(context, runtime) {
  const [stats, recent, viewerIsOwner] = await Promise.all([
    runtime.admin.getDashboardStats({ clientGuildCount: clientGuildCount(context) }),
    runtime.admin.getRecentActions({ limit: 5 }),
    isOwner(context, runtime),
  ]);
  return {
    stats,
    recent,
    viewerIsOwner,
    ownerAuthenticated: viewerIsOwner && runtime.panel.authenticate(context.userId),
  };
}

function dashboard(context, data) {
  return views.dashboardView(context.t, data.stats, data.recent, {
    viewerIsOwner: data.viewerIsOwner,
    ownerAuthenticated: data.ownerAuthenticated,
  });
}

async function openDashboard(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const data = await dashboardData(context, runtime);
  await context.envelope.transport.reply({ view: dashboard(context, data), ephemeral: true });
  return { stats: data.stats };
}

async function refresh(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const data = await dashboardData(context, runtime);
  await context.envelope.transport.update({ view: dashboard(context, data) });
  return { stats: data.stats };
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
  const installed = runtime.system.listInstalledGuilds(context.envelope.discordClient || null);
  await context.envelope.transport.reply({ view: views.serversView(context.t, installed), ephemeral: true });
  return installed;
}

async function openDiagnostics(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const diagnostics = await runtime.system.getDiagnostics(context.envelope.discordClient || null);
  await context.envelope.transport.reply({ view: views.diagnosticsView(context.t, diagnostics), ephemeral: true });
  return diagnostics;
}

async function openConfiguration(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const configuration = await runtime.system.getTechnicalConfiguration();
  await context.envelope.transport.reply({ view: views.configurationView(context.t, configuration), ephemeral: true });
  return configuration;
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

// ---------- Owner (véritable Owner uniquement) ----------
async function buildOwnerView(context, runtime) {
  const [ownerId, adminIds] = await Promise.all([
    runtime.identity.getOwnerId(),
    runtime.identity.listAdminIds(),
  ]);
  return ownerViews.panelView(context.t, {
    viewerIsOwner: true,
    ownerId,
    adminIds,
  });
}

async function openOwner(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  if (!(await isOwner(context, runtime))) return replyRefused(context);
  if (!runtime.panel.authenticate(context.userId)) {
    return context.envelope.transport.showModal(ownerViews.masterModal(context.t));
  }
  return context.envelope.transport.update({ view: await buildOwnerView(context, runtime) });
}

async function submitOwnerMaster(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  if (!(await isOwner(context, runtime))) return replyRefused(context);
  const result = runtime.panel.tryAuthenticate(
    context.userId,
    readField(context, OwnerPanelFieldId.MASTER),
    { isOwner: true },
  );
  if (!result.ok) return replyRefused(context);
  return context.envelope.transport.reply({ view: await buildOwnerView(context, runtime), ephemeral: true });
}

// ---------- Recovery intégrée (double facteur existant) ----------
async function openRecovery(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  return context.envelope.transport.showModal(recoveryViews.masterModal(context.t));
}

async function submitRecoveryMaster(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  await runtime.recoveryServiceFactory(context).requestRecovery({
    guildId: context.guildId,
    userId: context.userId,
    masterCode: readField(context, RecoveryFieldId.MASTER),
  });
  return context.envelope.transport.reply({ view: recoveryViews.enterCodeReplyView(context.t), ephemeral: true });
}

async function openRecoveryCode(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  return context.envelope.transport.showModal(recoveryViews.codeModal(context.t));
}

async function submitRecoveryCode(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const result = await runtime.recoveryServiceFactory(context).verifyRecovery({
    guildId: context.guildId,
    userId: context.userId,
    code: readField(context, RecoveryFieldId.TEMP_CODE),
  });
  const view = result.recovered
    ? ownerViews.recoveryView(context.t)
    : recoveryViews.resultReplyView(context.t, "recovery.codeRefused");
  await context.envelope.transport.reply({ view, ephemeral: true });
  return result;
}

async function back(context, runtime) {
  if (!(await requireOperationalAccess(context, runtime))) return null;
  const data = await dashboardData(context, runtime);
  return context.envelope.transport.update({ view: dashboard(context, data) });
}

module.exports = {
  openDashboard,
  refresh,
  openPremium,
  openServers,
  openDiagnostics,
  openConfiguration,
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
  openOwner,
  submitOwnerMaster,
  openRecovery,
  submitRecoveryMaster,
  openRecoveryCode,
  submitRecoveryCode,
  back,
  pickPlan,
  requireOperationalAccess,
};
