"use strict";

const { InviteComponentId: Id } = require("../configuration/inviteConstants");

function inviteView({ t, stats, leaderboard }) {
  if (leaderboard) {
    const lines = leaderboard.map((entry, index) => t("invites.leaderboardEntry", { rank: index + 1, userId: entry.userId, count: entry.current })).join("\n");
    return {
      title: t("invites.leaderboardTitle"),
      content: lines || t("invites.noInvites"),
      components: [],
    };
  }
  return {
    title: t("invites.title"),
    content: t("invites.count", { count: stats.current }),
    components: [],
  };
}

// Phase 11 — sous-vue /settings « Invites ». Le canal de log des invitations
// se configure déjà dans /settings → Logs (catégorie invitations) : pas de
// select en double ici.
function inviteSettingsView({ t, config }) {
  const enabled = Boolean(config.invitations_enabled);
  return {
    title: t("invites.title"),
    content: t(enabled ? "invites.enabled" : "invites.disabled"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(enabled ? "invites.disable" : "invites.enable"), style: enabled ? "success" : "secondary" },
      { type: "button", customId: Id.BACK, label: t("invites.back"), style: "secondary" },
    ],
  };
}

module.exports = { inviteView, inviteSettingsView };
