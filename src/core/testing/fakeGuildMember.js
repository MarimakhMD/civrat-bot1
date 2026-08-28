"use strict";

/** Test-only transport adapter implementing the core member capability contract. */
function createFakeGuildMember({ permissions = [], roleIds = [], isGuildOwner = false } = {}) {
  const granted = new Set(permissions);
  const roles = new Set(roleIds);
  return Object.freeze({
    isGuildOwner,
    has: (permission) => granted.has(permission),
    hasRole: (roleId) => roles.has(roleId),
  });
}

module.exports = { createFakeGuildMember };
