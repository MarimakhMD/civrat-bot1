"use strict";

const { PermissionName } = require("../../core/permissions");
const { InviteConfigKey: Key } = require("./configuration/inviteConstants");
const { InviteComponentId: Id } = require("./configuration/inviteConstants");
const { inviteView, inviteSettingsView } = require("./interactions/inviteViews");

// Phase 11 — câblage V1 du module Invites : commande publique /invites
// (stats par membre + classement, lecture du MÊME stockage que le tracking
// legacy) + sous-vue /settings (toggle invitations, Back rendu par la
// composition — plus de vue codée en dur).
function registerInvites({ registry, configService, inviteService, settingsHome = null }) {
  const command = {
    name: "invites",
    description: "Show invite statistics",
    permissions: null,
    options: [
      { type: "user", name: "user", description: "User to check", required: false },
      { type: "boolean", name: "leaderboard", description: "Show leaderboard", required: false },
    ],
    execute: async (context) => {
      const targetUser = (context.envelope.options && typeof context.envelope.options.getUser === "function" ? context.envelope.options.getUser("user") : null) || context.envelope.discordMember;
      const showLeaderboard = Boolean(context.envelope.options && typeof context.envelope.options.getBoolean === "function" ? context.envelope.options.getBoolean("leaderboard") : false);
      const guildId = context.guildId;
      let stats = { current: 0 };
      let leaderboard = null;
      try {
        if (showLeaderboard && inviteService && inviteService.statsRepository && typeof inviteService.statsRepository.getLeaderboard === "function") {
          leaderboard = await inviteService.statsRepository.getLeaderboard(guildId, 10);
        } else if (inviteService && typeof inviteService.getInviteStats === "function") {
          stats = (await inviteService.getInviteStats(targetUser.id, guildId)) || stats;
        }
      } catch {}
      const view = inviteView({ t: context.t, stats, leaderboard });
      await context.envelope.transport.reply({ view, ephemeral: true });
      return { stats, leaderboard };
    },
  };
  registry.registerCommand(command);

  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  const renderSettings = async (context) => {
    const config = await configService.read(context.guildId);
    return context.envelope.transport.update({ view: inviteSettingsView({ t: context.t, config }) });
  };
  registry.registerButton({ customId: Id.SECTION, permissions, execute: renderSettings });
  registry.registerButton({
    customId: Id.TOGGLE,
    permissions,
    execute: async (context) => {
      const config = await configService.read(context.guildId);
      await configService.update(context.guildId, { [Key.ENABLED]: !config[Key.ENABLED] });
      return renderSettings(context);
    },
  });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });

  return { commands: [command] };
}

module.exports = { registerInvites };
