"use strict";

const { PermissionName } = require("../../core/permissions");
const { TempVoiceComponentId: Id } = require("./configuration/tempVoiceConstants");
const { tempVoiceView } = require("./interactions/tempVoiceViews");
const { toggleTempVoice, selectTempVoiceChannel } = require("./interactions/configureTempVoice");

function registerTempVoice({ registry, service, settingsHome = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  const render = async (context) => context.envelope.transport.update({ view: tempVoiceView({ t: context.t, config: await service.read(context.guildId) }) });

  registry.registerButton({ customId: Id.SECTION, permissions, execute: render });
  registry.registerButton({
    customId: Id.TOGGLE,
    permissions,
    execute: async (context) => {
      await toggleTempVoice({ ...context, service });
      return render(context);
    },
  });
  registry.registerSelectMenu({ customId: Id.LOBBY_CHANNEL, permissions, execute: async (context) => { await selectTempVoiceChannel({ ...context, service, customId: Id.LOBBY_CHANNEL, values: context.envelope.values }); return render(context); } });
  registry.registerSelectMenu({ customId: Id.CATEGORY_CHANNEL, permissions, execute: async (context) => { await selectTempVoiceChannel({ ...context, service, customId: Id.CATEGORY_CHANNEL, values: context.envelope.values }); return render(context); } });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });

  return { id: Id.SECTION, permissions };
}

module.exports = { registerTempVoice };
