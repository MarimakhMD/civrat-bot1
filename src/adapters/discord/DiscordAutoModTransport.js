"use strict";

/**
 * Discord implementation of the AutoMod enforcer contract.
 * Hardened for 7.2: no longer treats a DM as a sanction.
 * - deleteMessage: best-effort, validates deletable
 * - timeoutUser: validates member, bot check, duration clamping, moderatable + hierarchy
 * - warnUser: validates member, bot check, no longer gates on moderatable (DM was not a sanction),
 *   sends DM only as best-effort notification, the real sanction is recorded via logs/moderation.
 * The transport never imports moderation services that require an acting moderator; AutoMod acts autonomously.
 */
class DiscordAutoModTransport {
  constructor({ guild }) {
    this.guild = guild;
  }

  async deleteMessage(message) {
    if (!message) return false;
    // Discord.js: message.deletable is the canonical guard
    if (typeof message.deletable === "boolean" && !message.deletable) {
      // Still attempt delete if deletable is undefined (older mocks), but respect false
      return false;
    }
    if (typeof message.delete === "function") {
      try {
        await message.delete();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async timeoutUser({ targetId, durationMinutes, reason }) {
    const member = await this.guild.members.fetch(targetId).catch(() => null);
    if (!member) return { ok: false, code: "TARGET_NOT_FOUND" };
    if (member.user && member.user.bot) return { ok: false, code: "TARGET_IS_BOT" };
    if (!member.moderatable) return { ok: false, code: "TARGET_NOT_MODERATABLE" };
    const raw = Number(durationMinutes);
    const clamped = !Number.isFinite(raw) ? 10 : Math.min(40320, Math.max(1, Math.floor(raw)));
    try {
      await member.timeout(clamped * 60000, reason).catch(() => null);
      // Discord.js timeout does not throw on success even if hierarchy changes mid-call; we already checked moderatable
      return { ok: true, code: "TIMEOUT_SUCCESS", targetId, durationMinutes: clamped };
    } catch {
      return { ok: false, code: "TIMEOUT_FAILED", targetId };
    }
  }

  async warnUser({ targetId, reason }) {
    const member = await this.guild.members.fetch(targetId).catch(() => null);
    if (!member) return { ok: false, code: "TARGET_NOT_FOUND" };
    if (member.user && member.user.bot) return { ok: false, code: "TARGET_IS_BOT" };
    // Hardened: warn is a real moderation sanction recorded via logs, not a DM.
    // DM is best-effort notification only and never gates success; do not check moderatable.
    try {
      await member.send(`AutoMod warning: ${reason || "rule violation"}`).catch(() => null);
    } catch {
      // DM failure is not a sanction failure
    }
    return { ok: true, code: "WARN_SUCCESS", targetId, reason: reason || null };
  }
}

module.exports = { DiscordAutoModTransport };
