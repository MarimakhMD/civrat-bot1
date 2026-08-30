"use strict";

/**
 * Deployment intent carried by transport-neutral command definitions.
 *
 * Runtime registration and Discord REST deployment remain separate concerns:
 * every command is registered in the interaction router, while the deployment
 * layer decides which Discord endpoint receives it from this metadata.
 */
const CommandDeploymentScope = Object.freeze({
  GLOBAL: "global",
  CIVRAT_ADMIN_GUILD: "civrat-admin-guild",
});

function resolveCommandDeploymentScope(value) {
  if (value === undefined || value === null) return CommandDeploymentScope.GLOBAL;
  if (!Object.values(CommandDeploymentScope).includes(value)) {
    throw new TypeError(`Unsupported command deployment scope: ${String(value)}`);
  }
  return value;
}

module.exports = { CommandDeploymentScope, resolveCommandDeploymentScope };
