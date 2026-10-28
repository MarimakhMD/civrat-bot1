"use strict";
const { matchesGuild } = require("./moderationAccess");
const { validUserId, validReason, failure } = require("./sanctionReliability");
class BanService {
  async ban({ guildId, actor, targetId, reason = null, transport }) {
    if (!matchesGuild(guildId, actor, transport) || !actor?.id) return { ok: false, code: "BAN_GUILD_MISMATCH" };
    if (typeof targetId !== "string" || !targetId) return { ok: false, code: "BAN_INVALID_TARGET" };
    if (!validReason(reason)) return { ok: false, code: "BAN_INVALID_REASON" };
    try {
      const target = await transport.getMember(targetId);
      if (!target) return { ok: false, code: "BAN_INVALID_TARGET" };
      if (!transport.canModerate(target, actor, "ban") || !target.bannable) return { ok: false, code: "BAN_TARGET_NOT_BANNABLE" };
      await transport.ban(target, reason);
      return { ok: true, code: "BAN_SUCCESS", targetId, reason };
    } catch (error) { return failure("BAN", error); }
  }
  async unban({ guildId, userId, transport }) {
    if (!matchesGuild(guildId, null, transport) || !validUserId(userId)) return { ok: false, code: "UNBAN_INVALID_TARGET" };
    if (transport.isProtectedTarget?.(userId)) return { ok: false, code: "UNBAN_INVALID_TARGET" };
    try {
      if (!await transport.getBan(userId)) return { ok: false, code: "UNBAN_NOT_BANNED" };
      await transport.unban(userId, "CIVRAT unban");
      return { ok: true, code: "UNBAN_SUCCESS", targetId: userId };
    } catch (error) { return failure("UNBAN", error); }
  }
}
module.exports = { BanService };
