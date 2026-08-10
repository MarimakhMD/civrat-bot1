"use strict";

const { AutoModDecisionService } = require("./AutoModDecisionService");

/**
 * Applies the configured punishment when a message violates an AutoMod rule.
 * Transport-neutral: the actual Discord effects (deleting a message,
 * timing out or warning a member) are delegated to an injected `enforcer`
 * object so the service stays unit-testable.
 * Decision is now centralized in AutoModDecisionService.
 */
class AutoModEnforcementService {
  constructor({ decisionService } = {}) {
    this.decisionService = decisionService instanceof AutoModDecisionService ? decisionService : new AutoModDecisionService();
  }

  decidePunishment(config) {
    // Backward compatibility for existing tests / callers.
    const decision = this.decisionService.decide({ detection: { matched: true, code: "UNKNOWN", rules: [] }, config });
    if (decision.type === "warn" || decision.type === "timeout") {
      return { type: decision.type, durationMinutes: decision.durationMinutes };
    }
    return { type: "none" };
  }

  async enforce({ message, detection, config, enforcer, logsRuntimeFactory }) {
    const actions = { deleted: false, punishment: null, decision: null };

    const decision = this.decisionService.decide({ detection, config });
    actions.decision = decision;

    if (decision.deleteMessage && enforcer && typeof enforcer.deleteMessage === "function") {
      try {
        await enforcer.deleteMessage(message);
        actions.deleted = true;
      } catch {
        actions.deleted = false;
      }
    }

    if (decision.type !== "none" && message.author && message.author.id && enforcer) {
      try {
        if (decision.type === "timeout") {
          actions.punishment = await enforcer.timeoutUser({
            guildId: message.guild && message.guild.id,
            targetId: message.author.id,
            durationMinutes: decision.durationMinutes,
            reason: decision.reason,
          });
        } else if (decision.type === "warn") {
          actions.punishment = await enforcer.warnUser({
            guildId: message.guild && message.guild.id,
            targetId: message.author.id,
            reason: decision.reason,
          });
        }
      } catch {
        actions.punishment = null;
      }
    }

    if (typeof logsRuntimeFactory === "function") {
      try {
        const logs = logsRuntimeFactory();
        if (logs && !logs.disabled) {
          await logs.handleModerationEvent({ guild: message.guild, action: "automod", targetId: message.author && message.author.id, reason: decision.reason, rule: decision.rule });
        }
      } catch {
        /* logging is best-effort */
      }
    }

    return actions;
  }
}

module.exports = { AutoModEnforcementService };
