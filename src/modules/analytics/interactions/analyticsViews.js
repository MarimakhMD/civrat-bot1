"use strict";

function analyticsView({ t, stats, topXP, topInvites }) {
  // P10 — `members` est un comptage distinct obtenu par pagination bornée :
  // au plafond, c'est un PLANCHER, pas un total. Le suffixe « + » le dit
  // explicitement, aucun chiffre tronqué n'est présenté comme exact.
  // `messages` est un compteur exact (count=exact) et ne porte jamais « + ».
  const members = stats.membersTruncated ? `${stats.members}+` : stats.members;
  const lines = [
    t("analytics.messages", { count: stats.messages }),
    t("analytics.members", { count: members }),
    t("analytics.topXP") + ": " + (topXP.length ? topXP.map((e, i) => `${i + 1}. <@${e.userId}> ${e.xp || e.current} XP`).join(", ") : t("analytics.noData")),
    t("analytics.invitesTop") + ": " + (topInvites.length ? topInvites.map((e, i) => `${i + 1}. <@${e.userId}> ${e.current}`).join(", ") : t("analytics.noData")),
  ];
  return {
    title: t("analytics.title"),
    content: lines.join("\n"),
    components: [],
  };
}

function analyticsSettingsView({ t, config }) {
  const enabled = Boolean(config.analytics_enabled);
  return {
    title: t("analytics.title"),
    content: t(enabled ? "analytics.enabled" : "analytics.disabled"),
    components: [
      { type: "button", customId: "civrat:v1:analytics:toggle", label: t(enabled ? "analytics.disable" : "analytics.enable"), style: enabled ? "success" : "secondary" },
      { type: "button", customId: "civrat:v1:analytics:back", label: t("analytics.back"), style: "secondary" },
    ],
  };
}

module.exports = { analyticsView, analyticsSettingsView };
