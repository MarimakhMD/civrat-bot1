"use strict";

const { CommandDeploymentScope } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");

const adminCommand = Object.freeze({
  name: "admin",
  description: "Administration technique CIVRAT",
  permissions: { allOf: [PermissionName.CIVRAT_ADMIN] },
  deploymentScope: CommandDeploymentScope.CIVRAT_ADMIN_GUILD,
  contexts: ["guild"],
  integrationTypes: ["guildInstall"],
  options: [],
});

module.exports = { adminCommand };
