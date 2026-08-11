"use strict";

const { PermissionName } = require("../../core/permissions");
const { InviteConfigKey: Key } = require("./configuration/inviteConstants");
const { inviteView } = require("./interactions/inviteViews");

function registerInvites({ registry, configService, inviteService, supabase }) {
  const command = {
    name: "invites",
    description: "Show invite statistics",
    permissions: null,
    options: [
      { type: "user", name: "user", description: "User to check", required: false },
      { type: "boolean", name: "leaderboard", description: "Show leaderboard", required: false },
    ],
    execute: async (context) => {
      const targetUser = context.envelope.options.getUser("user") || context.envelope.discordMember;
      const showLeaderboard = context.envelope.options.getBoolean("leaderboard") || false;
      const guildId = context.guildId;
      let stats = { current: 0 };
      let leaderboard = null;
      try {
        if (showLeaderboard && inviteService && inviteService.statsRepository) {
          // For leaderboard, we need to fetch top inviters - use repository if available
          const repo = inviteService.statsRepository;
          if (repo && typeof repo.getLeaderboard === "function") {
            leaderboard = await repo.getLeaderboard(guildId, 10);
          } else if (repo && repo.invites) {
            // InMemory fallback: collect from Map
            const entries = [];
            for (const [key, count] of repo.invites.entries()) {
              const [g, userId] = key.split(":");
              if (g === guildId) entries.push({ userId, current: count });
            }
            leaderboard = entries.sort((a, b) => b.current - a.current).slice(0, 10);
          }
        } else {
          stats = await inviteService.getInviteStats(targetUser.id, guildId);
        }
      } catch {}
      const view = inviteView({ t: context.t, stats, leaderboard });
      await context.envelope.transport.reply({ view, ephemeral: true });
      return { stats, leaderboard };
    },
  };
  registry.registerCommand(command);

  // Settings section for invites (optional V1)
  const { InviteComponentId: Id } = require("./configuration/inviteConstants");
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  const render = async (context) => {
    const config = await configService.read(context.guildId);
    const enabled = Boolean(config.invitations_enabled);
    const view = {
      title: context.t("invites.title"),
      content: context.t(enabled ? "invites.enabled" : "invites.disabled"),
      components: [
        { type: "button", customId: Id.TOGGLE, label: context.t(enabled ? "invites.disable" : "invites.enable"), style: enabled ? "success" : "secondary" },
        { type: "channel-select", customId: Id.LOG_CHANNEL, placeholder: context.t("invites.logChannel"), channelTypes: [0] },
        { type: "button", customId: Id.BACK, label: context.t("invites.back"), style: "secondary" },
      ],
    };
    return context.envelope.transport.update({ view });
  };
  registry.registerButton({ customId: Id.SECTION, permissions, execute: render });
  registry.registerButton({
    customId: Id.TOGGLE,
    permissions,
    execute: async (context) => {
      const config = await configService.read(context.guildId);
      await configService.update(context.guildId, { [Key.ENABLED]: !config[Key.ENABLED] });
      return render(context);
    },
  });
  registry.registerSelectMenu({
    customId: Id.LOG_CHANNEL,
    permissions,
    execute: async (context) => {
      const channelId = context.envelope.values && context.envelope.values[0] ? context.envelope.values[0] : null;
      await configService.update(context.guildId, { [Key.LOG_CHANNEL_ID]: channelId });
      return render(context);
    },
  });
  registry.registerButton({ customId: Id.BACK, permissions, execute: async (context) => context.envelope.transport.update({ view: require("../guild-settings/interactions/openSettingsPanel").settingsView(context.t, await require("../../core/i18n").resolveGuildLocale ? "fr" : "fr", []) }) });

  return { commands: [command] };
}

module.exports = { registerInvites };
