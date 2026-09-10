"use strict";

const { PermissionName } = require("../../core/permissions");
const { prefix } = require("../../core/interactions/routeMatchers");
const { LogsComponentId: Id } = require("./configuration/logsConstants");
const { logsView } = require("./interactions/logsViews");
const {
  toggleLogs,
  selectLogsCategory,
  selectLogsChannel,
  disableLogsCategory,
  previewLogs,
  backToLogs,
} = require("./interactions/configureLogs");

// `mapper` et `delivery` peuvent être des objets (utilisés tels quels) ou des
// factories `(context) => ...` résolues à la demande — nécessaire quand la
// livraison dépend de la guilde de l'interaction (DiscordLogsTransport).
function resolve(dep, context) {
  return typeof dep === "function" ? dep(context) : dep;
}

function registerLogs({ registry, service, mapper, delivery, settingsHome = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  const context = (c) => ({ ...c, service, mapper: resolve(mapper, c), delivery: resolve(delivery, c) });

  registry.registerButton({ customId: Id.SECTION, permissions, execute: async (c) => c.envelope.transport.update({ view: logsView({ t: c.t, config: await service.read(c.guildId) }) }) });
  registry.registerButton({ customId: Id.TOGGLE, permissions, execute: async (c) => toggleLogs(context(c)) });
  registry.registerSelectMenu({ customId: Id.CATEGORY, permissions, execute: async (c) => selectLogsCategory(context(c)) });
  registry.registerSelectMenu({ matcher: prefix(`${Id.CHANNEL_PREFIX}:`), permissions, execute: async (c) => selectLogsChannel(context(c)) });
  registry.registerButton({ matcher: prefix(`${Id.DISABLE_PREFIX}:`), permissions, execute: async (c) => disableLogsCategory(context(c)) });
  registry.registerButton({ customId: Id.PREVIEW, permissions, execute: async (c) => previewLogs(context(c)) });
  registry.registerButton({ customId: Id.BACK, permissions, execute: async (c) => backToLogs(context(c)) });
  if (settingsHome) registry.registerButton({ customId: Id.HOME, permissions, execute: settingsHome });
  return { id: Id.SECTION, permissions };
}

module.exports = { registerLogs };
