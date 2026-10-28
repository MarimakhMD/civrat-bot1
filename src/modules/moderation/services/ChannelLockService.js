"use strict";
const { failure } = require("./sanctionReliability");
class ChannelLockService {
  async lock({ guildId, channel, transport }) {
    if (!guildId || !channel) return { ok: false, code: "LOCK_FAILED" };
    try {
      // V1 only patches @everyone.SendMessages. No snapshot or global lock.
      await transport.lock(channel, guildId);
      return { ok: true, code: "LOCK_SUCCESS" };
    } catch (error) { return failure("LOCK", error); }
  }
  async unlock({ guildId, channel, transport }) {
    if (!guildId || !channel) return { ok: false, code: "UNLOCK_FAILED" };
    try {
      // Reset this bit to inheritance, never force allow or restore an old value.
      await transport.unlock(channel, guildId);
      return { ok: true, code: "UNLOCK_SUCCESS" };
    } catch (error) { return failure("UNLOCK", error); }
  }
}
module.exports = { ChannelLockService };
