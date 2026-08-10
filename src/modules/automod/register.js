"use strict";

const { PermissionName } = require("../../core/permissions");
const { prefix } = require("../../core/interactions/routeMatchers");
const { AutoModComponentId: Id } = require("./configuration/automodConstants");
const { autoModView } = require("./interactions/automodViews");
const {
  toggleAutoModEnable,
  toggleAutoModDelete,
  toggleAutoModRule,
  openAutoModThresholds,
  submitAutoModThresholds,
  openAutoModBadWords,
  submitAutoModBadWords,
  selectAutoModEnforcement,
} = require("./interactions/configureAutoMod");

function registerAutoMod({ registry, service, settingsHome = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  const render = async (context) =>
    context.envelope.transport.update({ view: autoModView({ t: context.t, config: await service.read(context.guildId) }) });

  registry.registerButton({ customId: Id.SECTION, permissions, execute: render });
  registry.registerButton({
    customId: Id.TOGGLE,
    permissions,
    execute: async (context) => {
      await toggleAutoModEnable({ ...context, service });
      return render(context);
    },
  });
  registry.registerButton({
    customId: Id.DELETE_MESSAGE,
    permissions,
    execute: async (context) => {
      await toggleAutoModDelete({ ...context, service });
      return render(context);
    },
  });
  registry.registerButton({ customId: Id.THRESHOLDS_OPEN, permissions, execute: async (context) => openAutoModThresholds({ ...context, service }) });
  registry.registerButton({ customId: Id.BAD_WORDS_OPEN, permissions, execute: async (context) => openAutoModBadWords({ ...context, service }) });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });
  registry.registerButton({
    matcher: prefix(`${Id.TOGGLE_PREFIX}:`),
    permissions,
    execute: async (context) => {
      await toggleAutoModRule({ ...context, service });
      return render(context);
    },
  });
  registry.registerModal({
    matcher: prefix(Id.THRESHOLDS_MODAL),
    permissions,
    execute: async (context) => {
      await submitAutoModThresholds({ ...context, service });
      return render(context);
    },
  });
  registry.registerModal({
    matcher: prefix(Id.BAD_WORDS_MODAL),
    permissions,
    execute: async (context) => {
      await submitAutoModBadWords({ ...context, service });
      return render(context);
    },
  });
  registry.registerSelectMenu({
    customId: Id.ENFORCE_SELECT,
    permissions,
    execute: async (context) => {
      await selectAutoModEnforcement({ ...context, service });
      return render(context);
    },
  });

  const command = {
    name: "automod",
    description: "Open AutoMod settings",
    permissions,
    execute: async (context) => {
      await context.envelope.transport.reply({
        view: autoModView({ t: context.t, config: await service.read(context.guildId) }),
        ephemeral: true,
      });
    },
  };
  registry.registerCommand(command);

  return { id: Id.SECTION, permissions, commands: [command] };
}

module.exports = { registerAutoMod };
