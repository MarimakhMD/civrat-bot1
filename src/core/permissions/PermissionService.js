"use strict";

const { AuthorizationError, ValidationError } = require("../errors");
const { DisabledCivratAdminProvider } = require("./DisabledCivratAdminProvider");
const { DisabledCivratOwnerProvider } = require("./DisabledCivratOwnerProvider");
const { PermissionName } = require("./permissionNames");

/**
 * Evaluates CIVRAT's transport-agnostic permission vocabulary. A member adapter
 * only needs a `has(permissionName)` capability and an optional `isGuildOwner`.
 */
class PermissionService {
  constructor({
    civratAdminProvider = new DisabledCivratAdminProvider(),
    civratOwnerProvider = new DisabledCivratOwnerProvider(),
    logger = null,
  } = {}) {
    this.civratAdminProvider = civratAdminProvider;
    this.civratOwnerProvider = civratOwnerProvider;
    this.logger = logger;
  }

  async evaluate(context, requirement = {}) {
    const allOf = normalizeRequirements(requirement.allOf, "allOf");
    const anyOf = normalizeRequirements(requirement.anyOf, "anyOf");
    const allGranted = await Promise.all(allOf.map((permission) => this.#has(context, permission)));
    const anyGranted = await Promise.all(anyOf.map((permission) => this.#has(context, permission)));

    const granted = allGranted.every(Boolean) && (anyOf.length === 0 || anyGranted.some(Boolean));
    return Object.freeze({ granted, allOf, anyOf, allGranted, anyGranted });
  }

  async require(context, requirement = {}) {
    const result = await this.evaluate(context, requirement);
    if (!result.granted) {
      this.logger?.warn?.("Core permission denied", {
        guildId: context.guildId || null,
        userId: context.userId || null,
        allOf: result.allOf,
        anyOf: result.anyOf,
      });
      throw new AuthorizationError({ allOf: result.allOf, anyOf: result.anyOf });
    }
    return result;
  }

  async #has(context, permission) {
    if (permission === PermissionName.CIVRAT_ADMIN) {
      return this.civratAdminProvider.isAdmin(context);
    }
    if (permission === PermissionName.CIVRAT_OWNER) {
      return Boolean(context.userId) && this.civratOwnerProvider.isOwner(context.userId);
    }
    if (permission === PermissionName.GUILD_OWNER) return Boolean(context.member?.isGuildOwner);
    return Boolean(context.member?.has?.(permission));
  }
}

function normalizeRequirements(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((permission) => !Object.values(PermissionName).includes(permission))) {
    throw new ValidationError({ field: name, reason: "invalid_permission_requirement" });
  }
  return [...new Set(value)];
}

module.exports = { PermissionService, normalizeRequirements };
