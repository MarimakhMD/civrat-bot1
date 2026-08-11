"use strict";

class InviteService {
  constructor({ cache, statsRepository } = {}) {
    this.cache = cache instanceof Map ? cache : new Map(); // guildId -> Map<code, uses>
    this.statsRepository = statsRepository;
  }

  hasCachedGuild(guildId) {
    return this.cache.has(guildId);
  }

  cacheGuildInvites(guildId, invites) {
    const map = new Map();
    if (invites) {
      for (const invite of invites.values ? invites.values() : Object.values(invites)) {
        map.set(invite.code, invite.uses);
      }
    }
    this.cache.set(guildId, map);
  }

  async refreshGuildInvites(guild) {
    try {
      const invites = await guild.invites.fetch().catch(() => null);
      if (invites) this.cacheGuildInvites(guild.id, invites);
    } catch {}
  }

  findUsedInvite(guildId, newInvites) {
    const oldCache = this.cache.get(guildId);
    if (!oldCache) return null;
    if (!newInvites) return null;
    for (const invite of newInvites.values ? newInvites.values() : Object.values(newInvites)) {
      const oldUses = oldCache.get(invite.code) || 0;
      if (invite.uses > oldUses) {
        return { code: invite.code, inviter: invite.inviter ? invite.inviter.id : null, uses: invite.uses };
      }
    }
    return null;
  }

  async addInvite(userId, guildId) {
    if (!this.statsRepository) return;
    await this.statsRepository.addInvite(userId, guildId);
  }

  async removeInvite(userId, guildId) {
    if (!this.statsRepository) return;
    await this.statsRepository.removeInvite(userId, guildId);
  }

  async setInvitedBy(memberId, guildId, inviterId) {
    if (!this.statsRepository) return;
    await this.statsRepository.setInvitedBy(memberId, guildId, inviterId);
  }

  async getInviteStats(userId, guildId) {
    if (!this.statsRepository) return { userId, guildId, current: 0 };
    return this.statsRepository.getInviteStats(userId, guildId);
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = { InviteService };
