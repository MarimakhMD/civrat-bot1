"use strict";

const { AdminPanelComponentId: Id, AdminPanelFieldId: Field, AdminPanelPolicy } = require("../configuration/adminPanelConstants");

function fmtDate(value, t) {
  if (!value) return t("adminpanel.notAvailable");
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return t("adminpanel.notAvailable");
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function statusLabel(server, t) {
  if (server.permanent) return t("adminpanel.statusPermanent");
  if (server.active) return t("adminpanel.statusActive");
  if (server.expired) return t("adminpanel.statusExpired");
  if (server.status === "revoked") return t("adminpanel.statusRevoked");
  if (server.status === "inactive") return t("adminpanel.statusInactive");
  return t("adminpanel.notAvailable");
}

function truncate(value, max = 90) {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function guildLabel(server, t) {
  const name = server.name ? server.name : t("adminpanel.notAvailable");
  return `\`${server.guildId}\` (${truncate(name, 60)})`;
}

function navButton(customId, label, style = "secondary") {
  return { type: "button", customId, label, style };
}

// ---------- Dashboard ----------
function dashboardView(t, stats, recentActions, { viewerIsOwner = false, ownerAuthenticated = false } = {}) {
  const line = (label, value) => `${label}: ${value === null || value === undefined ? t("adminpanel.notAvailable") : value}`;
  const recent = recentActions.length
    ? recentActions.map((entry) => `- \`${String(entry.created_at || "").slice(0, 19).replace("T", " ")}\` ${entry.action}${entry.guild_id ? ` → \`${entry.guild_id}\`` : ""}`).join("\n")
    : t("adminpanel.noRecentActions");
  const content = [
    t("adminpanel.dashboardDescription"),
    line(t("adminpanel.statKnownServers"), stats.knownServers),
    line(t("adminpanel.statPremiumServers"), stats.premiumTotal),
    line(t("adminpanel.statFreeServers"), stats.freeServers),
    line(t("adminpanel.statPremiumActive"), stats.premiumActive),
    line(t("adminpanel.statPremiumExpired"), stats.premiumExpired),
    line(t("adminpanel.statPremiumInactive"), stats.premiumInactive),
    line(t("adminpanel.statMessages"), stats.analytics.messages),
    // P10 — `members` global est un comptage distinct paginé : au plafond
    // c'est un plancher, signalé par « + ». `messages` est exact (count=exact).
    line(t("adminpanel.statMembers"), stats.analytics.truncated ? `${stats.analytics.members}+` : stats.analytics.members),
    !stats.premiumAvailable ? `⚠️ ${t("adminpanel.premiumUnavailable")}` : null,
    !stats.analyticsAvailable ? `⚠️ ${t("adminpanel.analyticsUnavailable")}` : null,
    "",
    `${t("adminpanel.recentActions")}\n${recent}`,
  ].filter((entry) => entry !== null).join("\n");
  const components = [
    navButton(Id.SERVERS, t("adminpanel.navServers"), "primary"),
    navButton(Id.DIAGNOSTICS, t("adminpanel.navDiagnostics")),
    navButton(Id.CONFIGURATION, t("adminpanel.navConfiguration")),
    navButton(Id.PREMIUM, t("adminpanel.navPremium")),
    navButton(Id.AUDIT, t("adminpanel.navAudit")),
    navButton(Id.RECOVERY, t("adminpanel.navRecovery")),
    navButton(Id.REFRESH, t("adminpanel.refresh")),
  ];
  if (viewerIsOwner) {
    components.push(navButton(Id.OWNER, t(ownerAuthenticated ? "adminpanel.navOwnerOpen" : "adminpanel.navOwnerUnlock"), "danger"));
  }
  return { title: t("adminpanel.dashboardTitle"), content, components };
}

// ---------- Premium ----------
function premiumView(t, list) {
  const items = list.items.map((server) => `- ${guildLabel(server, t)} — ${server.plan || t("adminpanel.notAvailable")} — ${statusLabel(server, t)} — ${fmtDate(server.endsAt, t)}`);
  const content = [
    t("adminpanel.premiumTitle"),
    list.ok ? `${t("adminpanel.premiumTotal")}: ${list.total}` : `⚠️ ${t("adminpanel.premiumUnavailable")}`,
    list.ok ? `${t("adminpanel.premiumPage")}: ${list.page + 1}` : null,
    list.ok && items.length === 0 ? t("adminpanel.noPremium") : null,
    ...items,
  ].filter(Boolean).join("\n");
  const components = [];
  if (list.items.length > 0) {
    components.push({
      type: "select",
      customId: Id.PREMIUM_SELECT,
      placeholder: t("adminpanel.premiumSelectPlaceholder"),
      options: list.items.map((server) => ({
        label: truncate(`${server.guildId} (${server.name || t("adminpanel.notAvailable")})`, 100),
        value: server.guildId,
        description: truncate(`${server.plan || ""} · ${statusLabel(server, t)}`, 100),
      })),
    });
  }
  components.push(
    navButton(Id.SEARCH, t("adminpanel.search"), "primary"),
    navButton(Id.ACTIVATE, t("adminpanel.activate"), "success"),
    navButton(Id.BACK, t("adminpanel.back")),
  );
  if (list.ok) {
    components.push(
      navButton(`${Id.PREMIUM_PREV_PREFIX}${list.page}`, t("adminpanel.prev")),
      navButton(`${Id.PREMIUM_NEXT_PREFIX}${list.page}`, t("adminpanel.next")),
    );
  }
  return { title: t("adminpanel.premiumTitle"), content, components };
}

// ---------- Installations / diagnostics / configuration ----------
function serversView(t, installed) {
  const entries = installed.guilds.slice(0, 10).map((guild) => (
    `- \`${guild.id}\` — ${truncate(guild.name || t("adminpanel.notAvailable"), 50)} — ${guild.memberCount ?? t("adminpanel.notAvailable")} ${t("adminpanel.members")}`
  ));
  const content = installed.available
    ? [
        t("adminpanel.serversHint"),
        `${t("adminpanel.statKnownServers")}: ${installed.total}`,
        ...(entries.length ? entries : [t("adminpanel.noInstalledServers")]),
        installed.guilds.length > entries.length ? t("adminpanel.installedServersTruncated") : null,
      ].filter(Boolean).join("\n")
    : `⚠️ ${t("adminpanel.installationsUnavailable")}`;
  return {
    title: t("adminpanel.serversTitle"),
    content,
    components: [
      navButton(Id.SEARCH, t("adminpanel.search"), "primary"),
      navButton(Id.PREMIUM, t("adminpanel.navPremium")),
      navButton(Id.BACK, t("adminpanel.back")),
    ],
  };
}

function availability(t, value) {
  return t(value ? "adminpanel.available" : "adminpanel.unavailable");
}

function diagnosticsView(t, diagnostics) {
  const content = [
    `${t("adminpanel.runtimeUptime")}: ${diagnostics.runtime.uptimeSeconds}s`,
    `${t("adminpanel.discordStatus")}: ${availability(t, diagnostics.discord.available)}`,
    `${t("adminpanel.discordReady")}: ${diagnostics.discord.ready === null ? t("adminpanel.notAvailable") : availability(t, diagnostics.discord.ready)}`,
    `${t("adminpanel.statKnownServers")}: ${diagnostics.discord.installedGuilds ?? t("adminpanel.notAvailable")}`,
    `${t("adminpanel.configurationBackend")}: ${availability(t, diagnostics.configuration.available)} (${diagnostics.configuration.source})`,
    `${t("adminpanel.entitlementsBackend")}: ${availability(t, diagnostics.entitlements.available)}`,
    `${t("adminpanel.entitlementRecords")}: ${diagnostics.entitlements.records ?? t("adminpanel.notAvailable")}`,
  ].join("\n");
  return {
    title: t("adminpanel.diagnosticsTitle"),
    content,
    components: [navButton(Id.BACK, t("adminpanel.back"))],
  };
}

function configurationView(t, snapshot) {
  const featureLines = snapshot.guild.features.map(({ id, state }) => (
    `- ${id}: ${state.enabled ? t("adminpanel.enabled") : t("adminpanel.disabled")}${state.enabled && !state.configured ? ` — ${t("adminpanel.incomplete")}` : ""}`
  ));
  const content = [
    `${t("adminpanel.technicalGuild")}: \`${snapshot.technical.guildId}\``,
    `${t("adminpanel.technicalChannel")}: <#${snapshot.technical.channelId}> (\`${snapshot.technical.channelId}\`)`,
    `${t("adminpanel.technicalRole")}: <@&${snapshot.technical.roleId}> (\`${snapshot.technical.roleId}\`)`,
    `${t("adminpanel.configurationBackend")}: ${availability(t, snapshot.guild.available)} (${snapshot.guild.source})`,
    `${t("adminpanel.configurationFound")}: ${snapshot.guild.found ? t("adminpanel.yes") : t("adminpanel.no")}`,
    `${t("adminpanel.configurationLanguage")}: ${snapshot.guild.language || t("adminpanel.notAvailable")}`,
    "",
    t("adminpanel.featureStates"),
    ...featureLines,
  ].join("\n");
  return {
    title: t("adminpanel.configurationTitle"),
    content,
    components: [navButton(Id.BACK, t("adminpanel.back"))],
  };
}

// ---------- Détail serveur ----------
function serverView(t, server) {
  const features = server.statusUnavailable
    ? `⚠️ ${t("adminpanel.premiumUnavailable")}`
    : server.status && server.status.length
      ? server.status.map((status) => `- ${status.feature} (${status.plan || t("adminpanel.notAvailable")}): ${statusLabel(status, t)} — ${t("adminpanel.startsAt")} ${fmtDate(status.startsAt, t)} — ${t("adminpanel.endsAt")} ${status.permanent ? t("adminpanel.neverExpires") : fmtDate(status.endsAt, t)}`).join("\n")
      : t("adminpanel.noPremium");
  const history = server.history.length
    ? server.history.slice(0, 3).map((entry) => `- ${String(entry.created_at || "").slice(0, 19).replace("T", " ")} ${entry.action} (${entry.new_status || "?"})`).join("\n")
    : t("adminpanel.noHistory");
  // P10 — le comptage distinct `members` est paginé : au plafond il devient un
  // plancher et reçoit le suffixe « + ». `messages` est un compteur exact.
  const serverMembers = server.analytics?.members;
  const serverMembersLabel = serverMembers === null || serverMembers === undefined
    ? t("adminpanel.notAvailable")
    : (server.analytics.membersTruncated ? `${serverMembers}+` : serverMembers);
  const analytics = server.analytics
    ? `${t("adminpanel.statMessages")}: ${server.analytics.messages ?? t("adminpanel.notAvailable")} · ${t("adminpanel.statMembers")}: ${serverMembersLabel}`
    : t("adminpanel.noAnalytics");
  const protectedPremium = Boolean(server.premiumProtection?.protected);
  const canMutatePremium = !protectedPremium || server.premiumMutationAccess?.allowed === true;
  const protectionNotice = protectedPremium
    ? `🔒 ${t(canMutatePremium ? "adminpanel.technicalPremiumOwnerWritable" : "adminpanel.technicalPremiumReadOnly")}`
    : null;
  const content = [
    t("adminpanel.serverTitle", { id: server.guildId }),
    `${t("adminpanel.serverName")}: ${server.name || t("adminpanel.notAvailable")}`,
    protectionNotice,
    t("adminpanel.premiumFeatures"),
    features,
    analytics,
    `${t("adminpanel.history")}\n${history}`,
  ].filter(Boolean).join("\n");
  const components = [];
  if (canMutatePremium) {
    components.push(
      navButton(`${Id.ACTIVATE_PREFIX}${server.guildId}`, t("adminpanel.activate"), "success"),
      navButton(`${Id.REMOVE_PREFIX}${server.guildId}`, t("adminpanel.removePremium"), "danger"),
      navButton(`${Id.REVOKE_PREFIX}${server.guildId}`, t("adminpanel.revokePremium"), "danger"),
    );
  }
  components.push(
    navButton(`${Id.HISTORY_PREFIX}${server.guildId}`, t("adminpanel.history")),
    navButton(Id.BACK, t("adminpanel.back")),
  );
  return {
    title: t("adminpanel.serverTitle", { id: server.guildId }),
    content,
    components,
  };
}

// ---------- Historique serveur ----------
function historyView(t, guildId, history) {
  const content = [
    t("adminpanel.historyTitle", { id: guildId }),
    history.entries.length
      ? history.entries.map((h) => `- ${String(h.created_at || "").slice(0, 19).replace("T", " ")} ${h.action}: ${h.old_status || "—"} → ${h.new_status || "—"}${h.reason ? ` (${h.reason})` : ""}`).join("\n")
      : t("adminpanel.noHistory"),
  ].join("\n");
  return {
    title: t("adminpanel.historyTitle", { id: guildId }),
    content,
    components: [
      navButton(Id.BACK, t("adminpanel.back")),
    ],
  };
}

// ---------- Audit ----------
function auditView(t, audit, filterGuildId = null) {
  const filterLine = filterGuildId ? `${t("adminpanel.auditFiltered")}: \`${filterGuildId}\`` : null;
  const entries = audit.entries.length
    ? audit.entries.map((e) => `- \`${String(e.created_at || "").slice(0, 19).replace("T", " ")}\` ${e.action} — ${t("adminpanel.auditActor")} \`${e.actor_id}\`${e.guild_id ? ` — ${t("adminpanel.auditGuild")} \`${e.guild_id}\`` : ""}${e.reason ? ` — ${e.reason}` : ""}`).join("\n")
    : t("adminpanel.noAudit");
  const content = [filterLine, t("adminpanel.auditTitle"), `${t("adminpanel.auditTotal")}: ${audit.total}`, `${t("adminpanel.premiumPage")}: ${audit.page + 1}`, entries].filter(Boolean).join("\n");
  return {
    title: t("adminpanel.auditTitle"),
    content,
    components: [
      navButton(Id.AUDIT_FILTER, t("adminpanel.auditFilter"), "primary"),
      navButton(`${Id.AUDIT_PREV_PREFIX}${audit.page}`, t("adminpanel.prev")),
      navButton(`${Id.AUDIT_NEXT_PREFIX}${audit.page}`, t("adminpanel.next")),
      navButton(Id.BACK, t("adminpanel.back")),
    ],
  };
}

// ---------- Modales ----------
function searchModal(t) {
  return {
    customId: Id.SEARCH_SUBMIT,
    title: t("adminpanel.searchModalTitle"),
    fields: [{ id: Field.GUILD_ID, label: t("adminpanel.guildIdField"), value: "", required: true, style: "short" }],
  };
}

function activateModal(t, { guildId = "" } = {}) {
  return {
    customId: Id.ACTIVATE_SUBMIT,
    title: t("adminpanel.activateModalTitle"),
    fields: [
      { id: Field.GUILD_ID, label: t("adminpanel.guildIdField"), value: guildId, required: true, style: "short" },
      { id: Field.PLAN, label: t("adminpanel.planField"), value: "TICKET_PREMIUM", required: true, style: "short" },
      { id: Field.EXPIRES_IN_DAYS, label: t("adminpanel.expiresInDaysField"), value: "", required: false, style: "short" },
    ],
  };
}

function deactivateModal(t, { guildId = "", plan = "TICKET_PREMIUM", titleKey }) {
  return {
    customId: titleKey === "adminpanel.revokePremium" ? Id.REVOKE_SUBMIT : Id.REMOVE_SUBMIT,
    title: t(titleKey === "adminpanel.revokePremium" ? "adminpanel.revokeModalTitle" : "adminpanel.removeModalTitle"),
    fields: [
      { id: Field.GUILD_ID, label: t("adminpanel.guildIdField"), value: guildId, required: true, style: "short" },
      { id: Field.PLAN, label: t("adminpanel.planField"), value: plan, required: true, style: "short" },
      { id: Field.REASON, label: t("adminpanel.reasonField"), value: "", required: false, style: "short" },
    ],
  };
}

function auditFilterModal(t) {
  return {
    customId: Id.AUDIT_FILTER_SUBMIT,
    title: t("adminpanel.auditFilterModalTitle"),
    fields: [{ id: Field.GUILD_ID, label: t("adminpanel.guildIdField"), value: "", required: true, style: "short" }],
  };
}

// ---------- Réponses simples ----------
function refusedView(t) {
  return { title: t("adminpanel.title"), content: t("adminpanel.refused"), components: [] };
}

function resultView(t, i18nKey) {
  return { title: t("adminpanel.title"), content: t(i18nKey), components: [navButton(Id.BACK, t("adminpanel.back"))] };
}

module.exports = {
  fmtDate,
  statusLabel,
  dashboardView,
  premiumView,
  serversView,
  diagnosticsView,
  configurationView,
  serverView,
  historyView,
  auditView,
  searchModal,
  activateModal,
  deactivateModal,
  auditFilterModal,
  refusedView,
  resultView,
};
