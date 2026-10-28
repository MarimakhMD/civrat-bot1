"use strict";
const { matchesGuild } = require("./moderationAccess");
const { validReason, failure } = require("./sanctionReliability");
class TimeoutService {
  async apply({ guildId, actor, targetId, durationMinutes = 10, reason = null, transport }) {
    if (!matchesGuild(guildId, actor, transport) || !actor?.id) return { ok: false, code: "TIMEOUT_GUILD_MISMATCH" };
    if (typeof targetId !== "string" || !targetId) return { ok: false, code: "TIMEOUT_INVALID_TARGET" };
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 40320) return { ok: false, code: "TIMEOUT_INVALID_DURATION" };
    if (!validReason(reason)) return { ok: false, code: "TIMEOUT_INVALID_REASON" };
    try {
      const target = await transport.getMember(targetId);
      if (!target || target.user?.bot || target.bot) return { ok: false, code: "TIMEOUT_INVALID_TARGET" };
      if (!transport.canModerate(target, actor, "timeout")) return { ok: false, code: "TIMEOUT_TARGET_NOT_MODERATABLE" };
      await transport.timeout(target, durationMinutes * 60000, reason);
      return { ok: true, code: "TIMEOUT_SUCCESS", targetId, durationMinutes, reason };
    } catch (error) { return failure("TIMEOUT", error); }
  }
  async remove({ guildId, actor, targetId, transport }) {
    if (!matchesGuild(guildId, actor, transport) || !actor?.id) return { ok: false, code: "UNTIMEOUT_GUILD_MISMATCH" };
    if (typeof targetId !== "string" || !targetId) return { ok: false, code: "UNTIMEOUT_INVALID_TARGET" };
    try {
      const target = await transport.getMember(targetId);
      if (!target || target.user?.bot || target.bot) return { ok: false, code: "UNTIMEOUT_INVALID_TARGET" };
      if (!transport.canModerate(target, actor, "timeout")) return { ok: false, code: "UNTIMEOUT_TARGET_NOT_MODERATABLE" };
      if (!transport.isTimedOut(target)) return { ok: false, code: "UNTIMEOUT_NOT_TIMED_OUT" };
      await transport.untimeout(target, "CIVRAT untimeout");
      return { ok: true, code: "UNTIMEOUT_SUCCESS", targetId };
    } catch (error) { return failure("UNTIMEOUT", error); }
  }
}
module.exports = { TimeoutService };
