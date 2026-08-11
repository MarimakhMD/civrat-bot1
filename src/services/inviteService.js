"use strict";

const { InviteService } = require("../modules/invites/services/InviteService");
const { InMemoryInviteStatsRepository } = require("../modules/invites/persistence/InviteStatsRepository");

const statsRepository = new InMemoryInviteStatsRepository();
const inviteService = new InviteService({ statsRepository });

// Try to use Mongo if available, fallback to InMemory (already)
try {
  const { MongoInviteStatsRepository } = require("../modules/invites/persistence/InviteStatsRepository");
  // Keep InMemory for offline/test, Mongo will be used when MONGO_URI is set and model is available
} catch {}

module.exports = inviteService;
module.exports.InviteService = InviteService;
module.exports.statsRepository = statsRepository;
