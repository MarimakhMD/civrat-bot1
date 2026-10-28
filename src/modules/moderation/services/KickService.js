"use strict";
const { matchesGuild } = require("./moderationAccess");
const { validReason, failure } = require("./sanctionReliability");
class KickService {
  async kick({ guildId, actor, targetId, reason = null, transport }) {
    if (!matchesGuild(guildId, actor, transport) || !actor?.id) return { ok: false, code: "KICK_GUILD_MISMATCH" };
    if (typeof targetId !== "string" || !targetId) return { ok: false, code: "KICK_INVALID_TARGET" };
    if (!validReason(reason)) return { ok: false, code: "KICK_INVALID_REASON" };
    try {
      const target = await transport.getMember(targetId);
      if (!target) return { ok: false, code: "KICK_INVALID_TARGET" };
      if (!transport.canModerate(target, actor, "kick") || !target.kickable) return { ok: false, code: "KICK_TARGET_NOT_KICKABLE" };
      await transport.kick(target, reason);
      return { ok: true, code: "KICK_SUCCESS", targetId, reason };
    } catch (error) { return failure("KICK", error); }
  }
}
module.exports = { KickService };
