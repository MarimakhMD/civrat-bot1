"use strict";
const { classifyDiscordError } = require("./discordErrorClassifier");
const { AuthorizationError } = require("../../core/errors");
const { has, canAct, protectedTarget } = require("../../modules/moderation/services/moderationAccess");

class DiscordModerationTransport {
  constructor({ guild, actor = null }) { this.guild = guild; this.actor = actor; }
  async getMember(id) { try { return await this.guild.members.fetch(id); }
    catch (error) { if (classifyDiscordError(error).discordCode === 10007) return null; throw error; } }
  canModerate(member, actor, action = "timeout") { return canAct(this.guild, actor, member, action); }
  isProtectedTarget(id) { return protectedTarget(this.guild, id); }
  canSetNickname(member, actor) { return canAct(this.guild, actor, member, "nickname"); }
  assertAllowed(allowed) { if (!allowed) throw new AuthorizationError({ resource: "moderation" }); }
  assertMember(member, action) { this.assertAllowed(canAct(this.guild, this.actor, member, action)); }
  assertChannel(channel, actorPermission, botPermissions) {
    const guildId = channel?.guildId || channel?.guild?.id;
    this.assertAllowed(Boolean(this.guild?.id && guildId === this.guild.id && this.actor?.guild?.id === this.guild.id));
    const check = (member, permission) => {
      try { return Boolean(member && channel.permissionsFor?.(member)?.has(permission)); }
      catch { return false; }
    };
    this.assertAllowed(check(this.actor, actorPermission) && botPermissions.every(p => check(this.guild.members?.me, p)));
  }
  async sendWarning(member, { reason, actor, t }) {
    this.assertAllowed(canAct(this.guild, actor, member, "warn"));
    const tr = typeof t === "function" ? t : key => key;
    await member.user.send(tr("moderation.warnDm", { guild: this.guild.name, reason: reason === null || reason === undefined || reason === "" ? tr("moderation.noReason") : reason, moderator: actor.user.tag }));
  }
  async timeout(member, duration, reason) { this.assertMember(member, "timeout"); await member.timeout(duration, reason); }
  async untimeout(member, reason) { this.assertMember(member, "timeout"); await member.timeout(null, reason); }
  isTimedOut(member) { return member.isCommunicationDisabled(); }
  async bulkDelete(channel, count) {
    this.assertChannel(channel, "ManageMessages", ["ViewChannel", "ReadMessageHistory", "ManageMessages"]);
    const deleted = await channel.bulkDelete(count, true); return deleted.size;
  }
  async setSlowmode(channel, seconds) {
    this.assertChannel(channel, "ManageChannels", ["ViewChannel", "ManageChannels"]);
    await channel.setRateLimitPerUser(seconds);
  }
  async lock(channel, guildId) {
    this.assertAllowed(guildId === this.guild.id);
    this.assertChannel(channel, "ManageChannels", ["ViewChannel", "ManageRoles"]);
    await channel.permissionOverwrites.edit(guildId, { SendMessages: false });
  }
  async unlock(channel, guildId) {
    this.assertAllowed(guildId === this.guild.id);
    this.assertChannel(channel, "ManageChannels", ["ViewChannel", "ManageRoles"]);
    await channel.permissionOverwrites.edit(guildId, { SendMessages: null });
  }
  async setNickname(member, nickname) { this.assertMember(member, "nickname"); await member.setNickname(nickname); }
  async ban(member, reason) { this.assertMember(member, "ban"); await member.ban({ reason }); }
  async kick(member, reason) { this.assertMember(member, "kick"); await member.kick(reason); }
  async getBan(id) { try { return await this.guild.bans.fetch(id); }
    catch (error) { if (classifyDiscordError(error).discordCode === 10026) return null; throw error; } }
  async unban(id, reason) {
    this.assertAllowed(Boolean(this.guild?.id) && !this.isProtectedTarget(id) && has(this.actor, "BanMembers") && has(this.guild.members?.me, "BanMembers") && this.actor?.guild?.id === this.guild.id);
    await this.guild.members.unban(id, reason);
  }
}
module.exports = { DiscordModerationTransport };
