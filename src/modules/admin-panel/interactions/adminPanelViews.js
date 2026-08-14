"use strict";

const { AdminPanelComponentId: Id, AdminPanelFieldId: Field, AdminPanelPolicy } = require("../configuration/adminPanelConstants");

function fmtDate(value, t) {
  if (!value) return t("adminpanel.notAvailable");
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return t("adminpanel.notAvailable");
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function statusLabel(server, t) {
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
function dashboardView(t, stats, recentActions) {
  const line = (label, value) => `${label}: ${value === null || value === undefined ? t("adminpanel.notAvailable") : value}`;
  const recent = recentActions.length
    ? recentActions.map((entry) => `- \`${String(entry.created_at || "").slice(0, 19).replace("T", " ")}\` ${entry.action}${entry.guild_id ? ` → \`${entry.guild_id}\`` : ""}`).join("\n")
    : t("adminpanel.noRecentActions");
  const content = [
    t("adminpanel.dashboardTitle"),
    line(t("adminpanel.statKnownServers"), stats.knownServers),
    line(t("adminpanel.statPremiumServers"), stats.premiumTotal),
    line(t("adminpanel.statFreeServers"), stats.freeServers),
    line(t("adminpanel.statPremiumActive"), stats.premiumActive),
    line(t("adminpanel.statPremiumExpired"), stats.premiumExpired),
    line(t("adminpanel.statPremiumInactive"), stats.premiumInactive),
    line(t("adminpanel.statMessages"), stats.analytics.messages),
    line(t("adminpanel.statMembers"), stats.analytics.members),
    "",
    `${t("adminpanel.recentActions")}\n${recent}`,
  ].join("\n");
  return {
    title: t("adminpanel.dashboardTitle"),
    content,
    components: [
      navButton(Id.PREMIUM, t("adminpanel.navPremium"), "primary"),
      navButton(Id.SERVERS, t("adminpanel.navServers")),
      navButton(Id.AUDIT, t("adminpanel.navAudit")),
      navButton(Id.REFRESH, t("adminpanel.refresh")),
    ],
  };
}

// ---------- Premium ----------
function premiumView(t, list) {
  const items = list.items.map((server) => `- ${guildLabel(server, t)} — ${server.plan || t("adminpanel.notAvailable")} — ${statusLabel(server, t)} — ${fmtDate(server.endsAt, t)}`);
  const content = [
    t("adminpanel.premiumTitle"),
    `${t("adminpanel.premiumTotal")}: ${list.total}`,
    `${t("adminpanel.premiumPage")}: ${list.page + 1}`,
    ...items,
  ].join("\n");
  const components = [
    {
      type: "select",
      customId: Id.PREMIUM_SELECT,
      placeholder: t("adminpanel.premiumSelectPlaceholder"),
      options: list.items.map((server) => ({
        label: truncate(`${server.guildId} (${server.name || t("adminpanel.notAvailable")})`, 100),
        value: server.guildId,
        description: truncate(`${server.plan || ""} · ${statusLabel(server, t)}`, 100),
      })),
    },
    navButton(Id.SEARCH, t("adminpanel.search"), "primary"),
    navButton(Id.ACTIVATE, t("adminpanel.activate"), "success"),
    navButton(Id.BACK, t("adminpanel.back")),
    navButton(`${Id.PREMIUM_PREV_PREFIX}${list.page}`, t("adminpanel.prev")),
    navButton(`${Id.PREMIUM_NEXT_PREFIX}${list.page}`, t("adminpanel.next")),
  ];
  return { title: t("adminpanel.premiumTitle"), content, components };
}

// ---------- Serveurs (recherche) ----------
function serversView(t) {
  return {
    title: t("adminpanel.serversTitle"),
    content: t("adminpanel.serversHint"),
    components: [
      navButton(Id.SEARCH, t("adminpanel.search"), "primary"),
      navButton(Id.PREMIUM, t("adminpanel.navPremium")),
      navButton(Id.BACK, t("adminpanel.back")),
    ],
  };
}

// ---------- Détail serveur ----------
function serverView(t, server) {
  const features = server.status && server.status.length
    ? server.status.map((s) => `- ${s.feature} (${s.plan || t("adminpanel.notAvailable")}): ${statusLabel(s, t)} — ${t("adminpanel.startsAt")} ${fmtDate(s.startsAt, t)} — ${t("adminpanel.endsAt")} ${fmtDate(s.endsAt, t)}`).join("\n")
    : t("adminpanel.noPremium");
  const history = server.history.length
    ? server.history.slice(0, 3).map((h) => `- ${String(h.created_at || "").slice(0, 19).replace("T", " ")} ${h.action} (${h.new_status || "?"})`).join("\n")
    : t("adminpanel.noHistory");
  const analytics = server.analytics
    ? `${t("adminpanel.statMessages")}: ${server.analytics.messages ?? t("adminpanel.notAvailable")} · ${t("adminpanel.statMembers")}: ${server.analytics.members ?? t("adminpanel.notAvailable")}`
    : t("adminpanel.noAnalytics");
  const content = [
    t("adminpanel.serverTitle", { id: server.guildId }),
    `${t("adminpanel.serverName")}: ${server.name || t("adminpanel.notAvailable")}`,
    t("adminpanel.premiumFeatures"),
    features,
    analytics,
    `${t("adminpanel.history")}\n${history}`,
  ].join("\n");
  return {
    title: t("adminpanel.serverTitle", { id: server.guildId }),
    content,
    components: [
      navButton(`${Id.ACTIVATE_PREFIX}${server.guildId}`, t("adminpanel.activate"), "success"),
      navButton(`${Id.REMOVE_PREFIX}${server.guildId}`, t("adminpanel.removePremium"), "danger"),
      navButton(`${Id.REVOKE_PREFIX}${server.guildId}`, t("adminpanel.revokePremium"), "danger"),
      navButton(`${Id.HISTORY_PREFIX}${server.guildId}`, t("adminpanel.history")),
      navButton(Id.BACK, t("adminpanel.back")),
    ],
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
