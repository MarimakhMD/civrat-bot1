"use strict";

const { PermissionName } = require("../../core/permissions");
const { AnalyticsConfigKey } = require("./configuration/analyticsConstants");
const { analyticsSettingsView } = require("./interactions/analyticsViews");

function registerAnalytics({ registry, configService, analyticsService, settingsHome = null }) {
  const permissionsManage = { allOf: [PermissionName.MANAGE_GUILD] };

  // Settings UI
  const renderSettings = async (context) => {
    const config = await configService.read(context.guildId);
    return context.envelope.transport.update({ view: analyticsSettingsView({ t: context.t, config }) });
  };

  registry.registerButton({ customId: "civrat:v1:analytics:section", permissions: permissionsManage, execute: renderSettings });
  registry.registerButton({
    customId: "civrat:v1:analytics:toggle",
    permissions: permissionsManage,
    execute: async (context) => {
      const config = await configService.read(context.guildId);
      await configService.update(context.guildId, { [AnalyticsConfigKey.ENABLED]: !config[AnalyticsConfigKey.ENABLED] });
      return renderSettings(context);
    },
  });
  registry.registerButton({ customId: "civrat:v1:analytics:back", permissions: permissionsManage, execute: settingsHome });

  // Commands
  const overviewCommand = {
    name: "analytics",
    description: "Show server analytics overview",
    permissions: permissionsManage,
    execute: async (context) => {
      await context.envelope.transport.deferReply?.({ ephemeral: true });
      const guildId = context.guildId;
      const stats = await analyticsService.getStats(guildId);
      const topXP = await analyticsService.getTopXP(guildId, 5);
      const topInvites = await analyticsService.getTopInvites(guildId, 5);
      const { analyticsView } = require("./interactions/analyticsViews");
      const view = analyticsView({ t: context.t, stats, topXP, topInvites });
      await context.envelope.transport.reply({ view, ephemeral: true });
      return { stats, topXP, topInvites };
    },
  };
  registry.registerCommand(overviewCommand);

  const xpCommand = {
    name: "analytics_xp",
    description: "Show XP leaderboard",
    permissions: null,
    execute: async (context) => {
      await context.envelope.transport.deferReply?.({ ephemeral: true });
      const topXP = await analyticsService.getTopXP(context.guildId, 10);
      const view = {
        title: context.t("analytics.xpTop"),
        content: topXP.length ? topXP.map((e, i) => `${i + 1}. <@${e.userId}> ${e.xp} XP`).join("\n") : context.t("analytics.noData"),
        components: [],
      };
      await context.envelope.transport.reply({ view, ephemeral: true });
      return { topXP };
    },
  };
  registry.registerCommand(xpCommand);

  const invitesCommand = {
    name: "analytics_invites",
    description: "Show invite leaderboard",
    permissions: null,
    execute: async (context) => {
      await context.envelope.transport.deferReply?.({ ephemeral: true });
      const topInvites = await analyticsService.getTopInvites(context.guildId, 10);
      const view = {
        title: context.t("analytics.invitesTop"),
        content: topInvites.length ? topInvites.map((e, i) => `${i + 1}. <@${e.userId}> ${e.current}`).join("\n") : context.t("analytics.noData"),
        components: [],
      };
      await context.envelope.transport.reply({ view, ephemeral: true });
      return { topInvites };
    },
  };
  registry.registerCommand(invitesCommand);

  return { commands: [overviewCommand, xpCommand, invitesCommand] };
}

module.exports = { registerAnalytics };
