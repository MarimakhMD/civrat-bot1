"use strict";
class EntitlementService { constructor({ repository }) { this.repository = repository; } async hasFeature({ guildId, feature }) { const record = await this.repository.findFeature(guildId, feature); return Boolean(record && record.status === "active" && (!record.ends_at || new Date(record.ends_at) > new Date())); } }
module.exports = { EntitlementService };
