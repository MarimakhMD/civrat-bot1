"use strict";

const { PermissionName } = require("../../core/permissions");
const { XPConfigKey: Key } = require("./configuration/xpConstants");
const { XPComponentId: Id } = require("./configuration/xpConstants");
const { xpSettingsView } = require("./interactions/xpSettingsViews");

// A2 — intégration /settings du module XP : activation et retour au panneau via
// settingsHome. Le gain (xp_per_message) et le cooldown (xp_cooldown) sont lus
// et appliqués par XPService ; ils ne sont pas encore éditables ici.
//
// Le select-menu « restreindre l'XP à un salon » a été supprimé (DCA4) : il
// écrivait xp_channel_id, colonne inexistante en base, donc le réglage échouait
// silencieusement. Aucune écriture fantôme n'est conservée.
//
// Le gain XP lui-même (messageCreate → getXPRuntime) n'est pas modifié : il ne
// fait que lire la configuration déjà persistée.
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
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });
}

module.exports = { registerXPSettings };
