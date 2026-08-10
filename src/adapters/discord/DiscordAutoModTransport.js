"use strict";

/**
 * Discord implementation of the AutoMod enforcer contract. It only depends on
 * the Discord.js guild/member API and never imports moderation services that
 * require an acting moderator, because AutoMod acts autonomously.
 */
class DiscordAutoModTransport {
  constructor({ guild }) {
    this.guild = guild;
  }

  async deleteMessage(message) {
    if (message && typeof message.delete === "function") {
      await message.delete();
      return true;
    }
    return false;
  }

  async timeoutUser({ targetId, durationMinutes, reason }) {
    const member = await this.guild.members.fetch(targetId).catch(() => null);
    if (!member) return { ok: false, code: "TARGET_NOT_FOUND" };
    if (!member.moderatable) return { ok: false, code: "TARGET_NOT_MODERATABLE" };
    await member.timeout(durationMinutes * 60000, reason).catch(() => null);
    return { ok: true, code: "TIMEOUT_SUCCESS", targetId, durationMinutes };
  }

  async warnUser({ targetId, reason }) {
    const member = await this.guild.members.fetch(targetId).catch(() => null);
    if (!member) return { ok: false, code: "TARGET_NOT_FOUND" };
    if (!member.moderatable) return { ok: false, code: "TARGET_NOT_MODERATABLE" };
    await member.send(`AutoMod warning: ${reason || "rule violation"}`).catch(() => null);
    return { ok: true, code: "WARN_SUCCESS", targetId };
  }
}

module.exports = { DiscordAutoModTransport };
