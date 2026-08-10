"use strict";

/** Test-only transport adapter implementing the core member capability contract. */
function createFakeGuildMember({ permissions = [], isGuildOwner = false } = {}) {
  const granted = new Set(permissions);
  return Object.freeze({
    isGuildOwner,
    has: (permission) => granted.has(permission),
  });
}

module.exports = { createFakeGuildMember };
