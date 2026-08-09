"use strict";

/** Stable permission vocabulary used by CIVRAT modules. */
const PermissionName = Object.freeze({
  ADMINISTRATOR: "ADMINISTRATOR",
  MANAGE_GUILD: "MANAGE_GUILD",
  MANAGE_ROLES: "MANAGE_ROLES",
  MANAGE_CHANNELS: "MANAGE_CHANNELS",
  MODERATE_MEMBERS: "MODERATE_MEMBERS",
  GUILD_OWNER: "GUILD_OWNER",
  CIVRAT_OWNER: "CIVRAT_OWNER",
});

module.exports = { PermissionName };
