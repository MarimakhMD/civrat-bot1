"use strict";
const { matchesGuild } = require("./moderationAccess");
const { failure } = require("./sanctionReliability");
class ChannelModerationService {
  async purge({ guildId, count, transport }) {
    if (!matchesGuild(guildId, null, transport)) return { ok: false, code: "PURGE_GUILD_MISMATCH" };
    if (!Number.isInteger(count) || count < 1 || count > 100) return { ok: false, code: "PURGE_INVALID_COUNT" };
    try {
      const deleted = await transport.bulkDelete(count);
      // Never substitute the requested number for an unconfirmed API result.
      if (!Number.isInteger(deleted) || deleted < 0 || deleted > count) {
        return { ok: false, code: "PURGE_UNCONFIRMED", requestedCount: count };
      }
      return {
        ok: deleted > 0,
        code: deleted === 0 ? "PURGE_NONE" : deleted < count ? "PURGE_PARTIAL" : "PURGE_SUCCESS",
        requestedCount: count,
        count: deleted,
      };
    } catch (error) { return { ...failure("PURGE", error), requestedCount: count }; }
  }
  async slowmode({ guildId, seconds, transport }) {
    if (!matchesGuild(guildId, null, transport)) return { ok: false, code: "SLOWMODE_GUILD_MISMATCH" };
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) return { ok: false, code: "SLOWMODE_INVALID_SECONDS" };
    try {
      await transport.setSlowmode(seconds);
      return { ok: true, code: "SLOWMODE_SUCCESS", seconds };
    } catch (error) { return failure("SLOWMODE", error); }
  }
}
module.exports = { ChannelModerationService };
