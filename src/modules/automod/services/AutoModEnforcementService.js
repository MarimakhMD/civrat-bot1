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
  constructor({ decisionService, logger = null } = {}) {
    this.decisionService = decisionService instanceof AutoModDecisionService ? decisionService : new AutoModDecisionService();
    // 4F-1 — observabilité : logger injectable pour les tests ; en production,
    // on retombe sur le logger partagé (aucun changement de composition).
    this.logger = logger || require("../../../utils/logger");
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

    const guildId = message?.guild?.id || null;
    const targetId = message?.author?.id || null;

    if (decision.deleteMessage && enforcer && typeof enforcer.deleteMessage === "function") {
      try {
        await enforcer.deleteMessage(message);
        actions.deleted = true;
      } catch (error) {
        actions.deleted = false;
        // 4F-1 — observabilité : l'échec de suppression reste non bloquant,
        // mais il est désormais journalisé.
        this.logger.warn("AutoMod message deletion failed", {
          operation: "automod_delete",
          rule: decision.rule || null,
          guildId,
          targetId,
          error: error?.message || String(error),
        });
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
      } catch (error) {
        actions.punishment = null;
        // 4F-1 — observabilité : l'échec de sanction reste non bloquant,
        // mais il est désormais journalisé.
        this.logger.warn("AutoMod punishment failed", {
          operation: "automod_punish",
          type: decision.type,
          rule: decision.rule || null,
          guildId,
          targetId,
          error: error?.message || String(error),
        });
      }
    }

    if (typeof logsRuntimeFactory === "function") {
      try {
        const logs = logsRuntimeFactory();
        if (logs && !logs.disabled) {
          await logs.handleModerationEvent({
            guild: message.guild,
            action: "automod",
            targetId: message.author && message.author.id,
            reason: decision.reason,
            rule: decision.rule,
            rules: decision.rules,
          });
        }
      } catch (error) {
        // 4F-1 — observabilité : logging is best-effort, désormais visible.
        this.logger.warn("AutoMod log event failed", {
          operation: "automod_log",
          rule: decision.rule || null,
          guildId,
          error: error?.message || String(error),
        });
      }
    }

    return actions;
  }
}

module.exports = { AutoModEnforcementService };
