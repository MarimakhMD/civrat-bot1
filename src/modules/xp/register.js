"use strict";

const { PermissionName } = require("../../core/permissions");
const { XPConfigKey: Key } = require("./configuration/xpConstants");
const { XPComponentId: Id } = require("./configuration/xpConstants");
const { xpSettingsView } = require("./interactions/xpSettingsViews");

// Phase 11 — intégration /settings du module XP : activation, salon restreint
// (filtre déjà appliqué par createXPRuntime.handleMessage) et retour au panneau
// via settingsHome. Le gain XP lui-même (messageCreate → getXPRuntime) n'est
// pas modifié : il ne fait que lire la config déjà persistée ici.
function registerXPSettings({ registry, configService, settingsHome = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };

  const renderSettings = async (context) => {
    const config = await configService.read(context.guildId);
    return context.envelope.transport.update({ view: xpSettingsView({ t: context.t, config }) });
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
  registry.registerSelectMenu({
    customId: Id.CHANNEL,
    permissions,
    execute: async (context) => {
      const channelId = context.envelope.values && context.envelope.values[0] ? context.envelope.values[0] : null;
      await configService.update(context.guildId, { [Key.CHANNEL_ID]: channelId });
      return renderSettings(context);
    },
  });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });
}

module.exports = { registerXPSettings };
