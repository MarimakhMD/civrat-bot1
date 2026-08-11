"use strict";

function inviteView({ t, stats, leaderboard }) {
  if (leaderboard) {
    const lines = leaderboard.map((entry, index) => `${index + 1}. <@${entry.userId}> — ${entry.current} invites`).join("\n");
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

module.exports = { inviteView };
