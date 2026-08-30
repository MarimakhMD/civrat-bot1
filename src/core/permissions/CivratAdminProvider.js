"use strict";

/**
 * Transport-neutral authority for CIVRAT's technical administration context.
 * Implementations decide from the normalized interaction context whether the
 * configured guild, channel, and Discord role requirements are all satisfied.
 */
class CivratAdminProvider {
  async isAdmin(_context) {
    throw new Error("CivratAdminProvider.isAdmin must be implemented.");
  }
}

module.exports = { CivratAdminProvider };
