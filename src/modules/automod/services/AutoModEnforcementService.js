"use strict";

/**
 * Applies the configured punishment when a message violates an AutoMod rule.
 * It is transport-neutral: the actual Discord effects (deleting a message,
 * timing out or warning a member) are delegated to an injected `enforcer`
 * object so the service stays unit-testable.
 */
class AutoModEnforcementService {
  constructor() {}

  decidePunishment(config) {
    const punishment = config.automod_punishment;
    if (punishment === "warn" || punishment === "timeout") {
      return { type: punishment, durationMinutes: Number(config.automod_timeout_minutes) || 10 };
    }
    return { type: "none" };
  }

  async enforce({ message, detection, config, enforcer, logsRuntimeFactory }) {
    const actions = { deleted: false, punishment: null };

    if (config.automod_delete_message && enforcer && typeof enforcer.deleteMessage === "function") {
      try {
        await enforcer.deleteMessage(message);
        actions.deleted = true;
      } catch {
        actions.deleted = false;
      }
    }

    const decision = this.decidePunishment(config);
    if (decision.type !== "none" && message.author && message.author.id && enforcer) {
      const reason = `AutoMod: ${detection.code}`;
      try {
        if (decision.type === "timeout") {
          actions.punishment = await enforcer.timeoutUser({
            guildId: message.guild && message.guild.id,
            targetId: message.author.id,
            durationMinutes: decision.durationMinutes,
            reason,
          });
        } else if (decision.type === "warn") {
          actions.punishment = await enforcer.warnUser({
            guildId: message.guild && message.guild.id,
            targetId: message.author.id,
            reason,
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
          await logs.handleModerationEvent({ guild: message.guild, action: "automod", targetId: message.author && message.author.id });
        }
      } catch {
        /* logging is best-effort */
      }
    }

    return actions;
  }
}

module.exports = { AutoModEnforcementService };
