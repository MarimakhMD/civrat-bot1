"use strict";
class WelcomeGoodbyeLogService { constructor({ logger = null }) { this.logger = logger; } delivery(event) { this.logger?.info?.("Welcome & Goodbye delivery", event); return event; } failure(event) { this.logger?.warn?.("Welcome & Goodbye delivery failed", event); return event; } }
module.exports = { WelcomeGoodbyeLogService };
