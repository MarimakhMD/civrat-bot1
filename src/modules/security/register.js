"use strict";

const { PermissionName } = require("../../core/permissions");
const { prefix } = require("../../core/interactions/routeMatchers");
const { SecurityComponentId: Id, SecurityConfigKey: Key } = require("./configuration/securityConstants");
const { securityView } = require("./interactions/securityViews");
const { toggleSecurity, toggleRule, openWhitelist, submitWhitelist } = require("./interactions/configureSecurity");

function registerSecurity({ registry, service, settingsHome = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  const render = async (context) => context.envelope.transport.update({ view: securityView({ t: context.t, config: await service.read(context.guildId) }) });

  registry.registerButton({ customId: Id.SECTION, permissions, execute: render });
  registry.registerButton({
    customId: Id.TOGGLE,
    permissions,
    execute: async (context) => {
      await toggleSecurity({ ...context, service });
      return render(context);
    },
  });
  registry.registerButton({
    customId: Id.ANTI_RAID,
    permissions,
    execute: async (context) => {
      await toggleRule({ service, guildId: context.guildId, key: Key.ANTI_RAID });
      return render(context);
    },
  });
  registry.registerButton({
    customId: Id.ANTI_BOT,
    permissions,
    execute: async (context) => {
      await toggleRule({ service, guildId: context.guildId, key: Key.ANTI_BOT });
      return render(context);
    },
  });
  registry.registerButton({
    customId: Id.ANTI_NUKE,
    permissions,
    execute: async (context) => {
      await toggleRule({ service, guildId: context.guildId, key: Key.ANTI_NUKE });
      return render(context);
    },
  });
  registry.registerButton({ customId: Id.WHITELIST_OPEN, permissions, execute: async (context) => openWhitelist({ ...context, service }) });
  registry.registerModal({
    matcher: prefix(Id.WHITELIST_MODAL),
    permissions,
    execute: async (context) => {
      await submitWhitelist({ ...context, service });
      return render(context);
    },
  });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });

  return { id: Id.SECTION, permissions };
}

module.exports = { registerSecurity };
