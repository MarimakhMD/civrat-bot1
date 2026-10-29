"use strict";
const { failure } = require("./sanctionReliability");
const { above, matchesGuild } = require("./moderationAccess");
class NicknameService {
  async set({ guildId, actor, targetId, nickname, transport }) {
    if (!matchesGuild(guildId, actor, transport)) return { ok: false, code: "NICKNAME_GUILD_MISMATCH" };
    if (typeof targetId !== "string" || !targetId) return { ok: false, code: "NICKNAME_INVALID_TARGET" };
    if (!actor?.id) return { ok: false, code: "NICKNAME_GUILD_MISMATCH" };
    if (nickname !== null && (typeof nickname !== "string" || nickname.length > 32
        || (nickname.length > 0 && nickname.trim().length === 0))) {
      return { ok: false, code: "NICKNAME_INVALID_NICKNAME" };
    }
    // Discord accepts null to reset. Treat an explicit empty string identically.
    const value = nickname === "" ? null : nickname;
    try {
      const target = await transport.getMember(targetId);
      if (!target) return { ok: false, code: "NICKNAME_INVALID_TARGET" };
      const guild = actor.guild || { id: guildId };
      if (!above(actor, target, guild, { allowSelf: true }) || !target.manageable
          || (transport.canSetNickname && !transport.canSetNickname(target, actor))) {
        return { ok: false, code: "NICKNAME_NOT_MANAGEABLE" };
      }
      await transport.setNickname(target, value);
      return { ok: true, code: value === null ? "NICKNAME_RESET_SUCCESS" : "NICKNAME_SUCCESS" };
    } catch (error) {
      return failure("NICKNAME", error);
    }
  }
}
module.exports = { NicknameService };
