"use strict";

const { CivratOwnerProvider } = require("./CivratOwnerProvider");

/** Safe default used until the dedicated PostgreSQL Owner Panel phase. */
class DisabledCivratOwnerProvider extends CivratOwnerProvider {
  async isOwner(_userId) {
    return false;
  }
}

module.exports = { DisabledCivratOwnerProvider };
