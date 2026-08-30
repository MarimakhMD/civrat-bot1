"use strict";

const { CivratAdminProvider } = require("./CivratAdminProvider");

/** Safe default: technical administration is unavailable until configured. */
class DisabledCivratAdminProvider extends CivratAdminProvider {
  async isAdmin(_context) {
    return false;
  }
}

module.exports = { DisabledCivratAdminProvider };
