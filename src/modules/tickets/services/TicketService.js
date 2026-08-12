"use strict";

const { TicketConfigKey: Key } = require("../configuration/ticketConstants");
const { TicketPremiumConfigKey: PKey } = require("../configuration/ticketPremiumConstants");
const { TicketPermissionService } = require("./TicketPermissionService");

class TicketService {
  constructor({ repository, configService = null, transport = null, welcomeService = null, transcriptService = null, ticketLog = null, premiumConfigResolver = null, counterRepository = null, channelNamingService = null }) {
    this.repository = repository;
    this.configService = configService;
    this.transport = transport;
    this.welcomeService = welcomeService;
    this.transcriptService = transcriptService;
    this.ticketLog = ticketLog;
    this.premiumConfigResolver = premiumConfigResolver;
    this.counterRepository = counterRepository;
    this.channelNamingService = channelNamingService;
    this.permissions = new TicketPermissionService();
  }

  // Phase 10.3 : les contenus Premium (message d'accueil, salon transcript) ne
  // sont résolus que si l'entitlement TICKET_PREMIUM est actif ; sans resolver
  // ou sans entitlement, null => comportement Free historique, inchangé.
  async resolvePremium(guildId, config) {
    return this.premiumConfigResolver
      ? this.premiumConfigResolver.resolve({ guildId, config })
      : Promise.resolve(null);
  }

  // Phase 10.4 : nom Premium du salon. Fail-closed à chaque étape : sans
  // entitlement, sans format valide, sans compteur disponible ou avec un
  // rendu invalide => null => le transport nomme ticket-<userId> (Free).
  // Note concurrence : le numéro est réservé avant la création Discord ; si
  // celle-ci échoue ensuite, le trou de séquence est assumé (documenté
  // docs/architecture/phase-10-4-ticket-counter.md).
  async resolvePremiumChannelName({ guildId, config, member = null, supportRole = null }) {
    const premium = await this.resolvePremium(guildId, config);
    const format = premium?.[PKey.NAME_FORMAT] || null;
    if (!format || !this.channelNamingService || !member) return null;
    let number = null;
    if (format.includes("{number}")) {
      if (!this.counterRepository) return null;
      try {
        number = await this.counterRepository.next(guildId);
      } catch (_error) {
        return null;
      }
    }
    return this.channelNamingService.build({ format, member, supportRole, number });
  }

  findOpen(guildId, userId) { return this.repository.findOpen(guildId, userId); }
  create(record) { return this.repository.create(record); }

  async createTicket({ guildId, member, t = (key) => key }) {
    const result = (created, code, details = {}) => ({
      created,
      code,
      guildId: guildId || null,
      memberId: member?.id || null,
      details,
    });
    if (!guildId || !member?.id) return result(false, "TICKET_GUILD_OR_MEMBER_MISSING");
    if (!this.configService || !this.transport) return result(false, "TICKET_CREATION_UNAVAILABLE");

    const config = await this.configService.read(guildId);
    if (!config[Key.ENABLED]) return result(false, "TICKETS_DISABLED");

    const categoryId = config[Key.CATEGORY_ID];
    const supportRoleId = config[Key.SUPPORT_ROLE_ID];
    if (!categoryId || !supportRoleId) {
      return result(false, "TICKET_CONFIG_INCOMPLETE", {
        categoryMissing: !categoryId,
        supportRoleMissing: !supportRoleId,
      });
    }

    let category;
    let supportRole;
    try {
      [category, supportRole] = await Promise.all([
        this.transport.getCategory(categoryId),
        this.transport.getSupportRole(supportRoleId),
      ]);
    } catch (_error) {
      return result(false, "TICKET_CONFIG_INCOMPLETE");
    }
    if (!category || !supportRole) {
      return result(false, "TICKET_CONFIG_INCOMPLETE", {
        categoryMissing: !category,
        supportRoleMissing: !supportRole,
      });
    }

    let ticketMember;
    let botMember;
    try {
      [ticketMember, botMember] = await Promise.all([
        this.transport.getMember(member.id),
        this.transport.getBotMember(),
      ]);
    } catch (_error) {
      return result(false, "TICKET_DISCORD_ERROR");
    }
    if (!ticketMember) return result(false, "TICKET_MEMBER_MISSING");
    if (!botMember) return result(false, "TICKET_BOT_MISSING");

    let openTicket;
    try {
      openTicket = await this.findOpen(guildId, member.id);
    } catch (_error) {
      return result(false, "PERSISTENCE_ERROR");
    }
    if (openTicket) return result(false, "OPEN_TICKET_EXISTS", { channelId: openTicket.channel_id || null });

    let premiumName = null;
    try {
      premiumName = await this.resolvePremiumChannelName({ guildId, config, member: ticketMember, supportRole });
    } catch (_error) {
      premiumName = null; // fail-closed : le nommage Free reste la référence
    }

    let channel;
    try {
      channel = await this.transport.createTicketChannel({ category, member, supportRole, name: premiumName || undefined });
    } catch (_error) {
      return result(false, "TICKET_CHANNEL_CREATION_FAILED");
    }

    let overwrites;
    try {
      overwrites = await this.transport.applyTicketOverwrites({
        channel,
        member: ticketMember,
        supportRole,
        botMember,
      });
    } catch (_error) {
      return result(false, "TICKET_DISCORD_ERROR", { channelId: channel.id });
    }
    if (!overwrites?.applied) return result(false, overwrites?.code || "TICKET_OVERWRITE_FAILED", { channelId: channel.id });

    if (this.welcomeService) {
      const premium = await this.resolvePremium(guildId, config);
      const welcome = this.welcomeService.build({ t, member: ticketMember, supportRole, welcomeMessage: premium ? premium[PKey.WELCOME_MESSAGE] : null });
      try {
        await this.transport.sendTicketWelcome(channel, welcome);
      } catch (_error) {
        return result(false, "TICKET_WELCOME_SEND_FAILED", { channelId: channel.id });
      }
    }

    const record = {
      guild_id: guildId,
      user_id: member.id,
      channel_id: channel.id,
      category: "support",
      status: "open",
      closed: false,
    };
    try {
      const ticket = await this.create(record);
      this.ticketLog?.({action:"ticket_created",ticketChannelId:channel.id,userId:member.id}); return result(true, "TICKET_CREATED", { channelId: channel.id, ticket });
    } catch (_error) {
      return result(false, "PERSISTENCE_ERROR", { channelId: channel.id });
    }
  }

  async closeTicket({ guildId, channelId, member }) {
    const result = (closed, code, details = {}) => ({
      closed,
      code,
      guildId: guildId || null,
      channelId: channelId || null,
      memberId: member?.id || null,
      details,
    });
    if (!guildId || !channelId || !member?.id) return result(false, "TICKET_NOT_FOUND");

    let ticket;
    try {
      ticket = await this.repository.findByChannel(channelId);
    } catch (_error) {
      return result(false, "TICKET_CLOSE_FAILED");
    }
    if (!ticket) return result(false, "TICKET_NOT_FOUND");
    if (ticket.guild_id !== guildId) return result(false, "TICKET_GUILD_MISMATCH");
    if (ticket.status === "deleted") return result(false, "TICKET_ALREADY_DELETED");
    if (ticket.status === "closed" || ticket.closed) return result(false, "TICKET_ALREADY_CLOSED");

    let config;
    let supportRoleId;
    try {
      config = await this.configService.read(guildId);
      supportRoleId = config[Key.SUPPORT_ROLE_ID];
    } catch (_error) {
      return result(false, "TICKET_CLOSE_FAILED");
    }
    let isSupport;
    try {
      isSupport = Boolean(supportRoleId && await this.transport.isMemberInRole(member, supportRoleId));
    } catch (_error) {
      return result(false, "TICKET_CLOSE_FAILED");
    }
    if (!this.permissions.canManage({ isOwner: ticket.user_id === member.id, isSupport })) return result(false, "TICKET_UNAUTHORIZED");

    let channelResult;
    try {
      channelResult = await this.transport.closeTicketChannel(channelId, ticket.user_id);
    } catch (_error) {
      return result(false, "TICKET_CLOSE_FAILED");
    }
    if (!channelResult?.closed) return result(false, channelResult?.code || "TICKET_CLOSE_FAILED");

    const closedAt = new Date().toISOString();
    try {
      const updatedTicket = await this.repository.updateByChannel(channelId, { status: "closed", closed: true, closed_at: closedAt });
      const premium = await this.resolvePremium(guildId, config);
      const transcriptChannelId = premium?.[PKey.TRANSCRIPT_CHANNEL_ID] || config.ticket_log_channel_id;
      if (this.transcriptService) await this.transcriptService.deliver({ channelId, logChannelId: transcriptChannelId, transport: this.transport });
      this.ticketLog?.({action:"ticket_closed",ticketChannelId:channelId,userId:member.id}); return result(true, "TICKET_CLOSED", { ticket: updatedTicket, closedAt });
    } catch (_error) {
      return result(false, "TICKET_CLOSE_FAILED");
    }
  }

  async reopenTicket({ guildId, channelId, member }) {
    const result = (reopened, code, details = {}) => ({
      reopened,
      code,
      guildId: guildId || null,
      channelId: channelId || null,
      memberId: member?.id || null,
      details,
    });
    if (!guildId || !channelId || !member?.id) return result(false, "TICKET_NOT_FOUND");

    let ticket;
    try {
      ticket = await this.repository.findByChannel(channelId);
    } catch (_error) {
      return result(false, "TICKET_REOPEN_FAILED");
    }
    if (!ticket) return result(false, "TICKET_NOT_FOUND");
    if (ticket.guild_id !== guildId) return result(false, "TICKET_GUILD_MISMATCH");
    if (ticket.status === "deleted") return result(false, "TICKET_ALREADY_DELETED");
    if (ticket.status !== "closed" && !ticket.closed) return result(false, "TICKET_ALREADY_OPEN");

    let supportRoleId;
    try {
      supportRoleId = (await this.configService.read(guildId))[Key.SUPPORT_ROLE_ID];
    } catch (_error) {
      return result(false, "TICKET_REOPEN_FAILED");
    }
    let isSupport;
    try {
      isSupport = Boolean(supportRoleId && await this.transport.isMemberInRole(member, supportRoleId));
    } catch (_error) {
      return result(false, "TICKET_REOPEN_FAILED");
    }
    if (!this.permissions.canManage({ isOwner: ticket.user_id === member.id, isSupport })) return result(false, "TICKET_UNAUTHORIZED");

    let channelResult;
    try {
      channelResult = await this.transport.reopenTicketChannel(channelId, ticket.user_id);
    } catch (_error) {
      return result(false, "TICKET_REOPEN_FAILED");
    }
    if (!channelResult?.reopened) return result(false, channelResult?.code || "TICKET_REOPEN_FAILED");

    try {
      const updatedTicket = await this.repository.updateByChannel(channelId, { status: "open", closed: false, closed_at: null });
      this.ticketLog?.({action:"ticket_reopened",ticketChannelId:channelId,userId:member.id}); return result(true, "TICKET_REOPENED", { ticket: updatedTicket });
    } catch (_error) {
      return result(false, "TICKET_REOPEN_FAILED");
    }
  }

  async deleteTicket({ guildId, channelId, member }) {
    const result = (deleted, code, details = {}) => ({
      deleted,
      code,
      guildId: guildId || null,
      channelId: channelId || null,
      memberId: member?.id || null,
      details,
    });
    if (!guildId || !channelId || !member?.id) return result(false, "TICKET_NOT_FOUND");

    let ticket;
    try {
      ticket = await this.repository.findByChannel(channelId);
    } catch (_error) {
      return result(false, "TICKET_DELETE_FAILED");
    }
    if (!ticket) return result(false, "TICKET_NOT_FOUND");
    if (ticket.guild_id !== guildId) return result(false, "TICKET_GUILD_MISMATCH");
    if (ticket.status === "deleted") return result(false, "TICKET_ALREADY_DELETED");

    let supportRoleId;
    try {
      supportRoleId = (await this.configService.read(guildId))[Key.SUPPORT_ROLE_ID];
    } catch (_error) {
      return result(false, "TICKET_DELETE_FAILED");
    }
    let isSupport;
    try {
      isSupport = Boolean(supportRoleId && await this.transport.isMemberInRole(member, supportRoleId));
    } catch (_error) {
      return result(false, "TICKET_DELETE_FAILED");
    }
    if (!this.permissions.canManage({ isOwner: ticket.user_id === member.id, isSupport })) return result(false, "TICKET_UNAUTHORIZED");

    let channelResult;
    try {
      channelResult = await this.transport.deleteTicketChannel(channelId);
    } catch (_error) {
      return result(false, "TICKET_DELETE_FAILED");
    }
    if (!channelResult?.deleted) return result(false, channelResult?.code || "TICKET_DELETE_FAILED");

    const deletedAt = new Date().toISOString();
    try {
      const updatedTicket = await this.repository.updateByChannel(channelId, { status: "deleted", closed: true, closed_at: deletedAt });
      this.ticketLog?.({action:"ticket_deleted",ticketChannelId:channelId,userId:member.id}); return result(true, "TICKET_DELETED", { ticket: updatedTicket, deletedAt });
    } catch (_error) {
      return result(false, "TICKET_DELETE_FAILED");
    }
  }

  async renameTicket({ guildId, channelId, member, name }) {
    const result = (renamed, code, details = {}) => ({
      renamed,
      code,
      guildId: guildId || null,
      channelId: channelId || null,
      memberId: member?.id || null,
      details,
    });
    if (!guildId || !channelId || !member?.id) return result(false, "TICKET_NOT_FOUND");
    if (!isValidTicketChannelName(name)) return result(false, "TICKET_INVALID_NAME");

    let ticket;
    try {
      ticket = await this.repository.findByChannel(channelId);
    } catch (_error) {
      return result(false, "TICKET_RENAME_FAILED");
    }
    if (!ticket) return result(false, "TICKET_NOT_FOUND");
    if (ticket.guild_id !== guildId) return result(false, "TICKET_GUILD_MISMATCH");
    if (ticket.status === "deleted") return result(false, "TICKET_ALREADY_DELETED");

    let supportRoleId;
    try {
      supportRoleId = (await this.configService.read(guildId))[Key.SUPPORT_ROLE_ID];
    } catch (_error) {
      return result(false, "TICKET_RENAME_FAILED");
    }
    let isSupport;
    try {
      isSupport = Boolean(supportRoleId && await this.transport.isMemberInRole(member, supportRoleId));
    } catch (_error) {
      return result(false, "TICKET_RENAME_FAILED");
    }
    if (!this.permissions.canManage({ isOwner: ticket.user_id === member.id, isSupport })) return result(false, "TICKET_UNAUTHORIZED");

    let channelResult;
    try {
      channelResult = await this.transport.renameTicketChannel(channelId, name);
    } catch (_error) {
      return result(false, "TICKET_RENAME_FAILED");
    }
    if (!channelResult?.renamed) return result(false, channelResult?.code || "TICKET_RENAME_FAILED");
    this.ticketLog?.({action:"ticket_renamed",ticketChannelId:channelId,userId:member.id}); return result(true, "TICKET_RENAMED", { name });
  }

  async updateMemberAccess({ guildId, channelId, member, targetMemberId, action }) {
    const result = (changed, code) => ({ changed, code, guildId: guildId || null, channelId: channelId || null, memberId: member?.id || null, targetMemberId: targetMemberId || null, details: {} });
    if (!guildId || !channelId || !member?.id || !targetMemberId) return result(false, "TICKET_MEMBER_NOT_FOUND");
    let ticket;
    try { ticket = await this.repository.findByChannel(channelId); } catch (_error) { return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
    if (!ticket) return result(false, "TICKET_NOT_FOUND");
    if (ticket.guild_id !== guildId) return result(false, "TICKET_GUILD_MISMATCH");
    if (ticket.status === "deleted") return result(false, "TICKET_ALREADY_DELETED");
    let supportRoleId;
    try { supportRoleId = (await this.configService.read(guildId))[Key.SUPPORT_ROLE_ID]; } catch (_error) { return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
    let isSupport;
    try { isSupport = Boolean(supportRoleId && await this.transport.isMemberInRole(member, supportRoleId)); } catch (_error) { return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
    if (!this.permissions.canManage({ isOwner: ticket.user_id === member.id, isSupport })) return result(false, "TICKET_UNAUTHORIZED");
    if (action === "remove" && targetMemberId === ticket.user_id) return result(false, "TICKET_MEMBER_NOT_ADDED");
    let target;
    try { target = await this.transport.getGuildMember(targetMemberId); } catch (_error) { return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
    if (!target) return result(false, "TICKET_MEMBER_NOT_FOUND");
    let access;
    try { access = action === "add" ? await this.transport.addTicketMemberAccess(channelId, target) : await this.transport.removeTicketMemberAccess(channelId, targetMemberId); } catch (_error) { return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
    if(access?.changed)this.ticketLog?.({action:action==="add"?"ticket_member_added":"ticket_member_removed",ticketChannelId:channelId,userId:member.id}); return result(Boolean(access?.changed), access?.code || "TICKET_MEMBER_ACCESS_FAILED");
  }

  async claimTicket({ guildId, channelId, member }) {
    const result=(claimed,code,details={})=>({claimed,code,guildId,channelId,memberId:member?.id||null,details});
    if(!guildId||!channelId||!member?.id)return result(false,"TICKET_NOT_FOUND");
    let ticket; try{ticket=await this.repository.findByChannel(channelId);}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}
    if(!ticket)return result(false,"TICKET_NOT_FOUND"); if(ticket.guild_id!==guildId)return result(false,"TICKET_GUILD_MISMATCH"); if(ticket.status==="deleted")return result(false,"TICKET_ALREADY_DELETED"); if(ticket.status==="closed"||ticket.closed)return result(false,"TICKET_ALREADY_CLOSED"); if(ticket.status==="claimed")return result(false,"TICKET_ALREADY_CLAIMED");
    let roleId; try{roleId=(await this.configService.read(guildId))[Key.SUPPORT_ROLE_ID];}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}
    let isSupport; try{isSupport=Boolean(roleId&&await this.transport.isMemberInRole(member,roleId));}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}
    if(!isSupport)return result(false,"TICKET_UNAUTHORIZED");
    let channel;try{channel=await this.transport.claimTicketChannel(channelId,ticket.user_id,member.id);}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}if(!channel?.claimed)return result(false,"TICKET_CLAIM_FAILED");
    try{const updatedTicket=await this.repository.updateByChannel(channelId,{status:"claimed"});this.ticketLog?.({action:"ticket_claimed",ticketChannelId:channelId,userId:member.id});return result(true,"TICKET_CLAIMED",{ticket:updatedTicket});}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}
  }
}

function isValidTicketChannelName(name) {
  return typeof name === "string" && /^[a-z0-9][a-z0-9-_]{0,88}$/.test(name);
}

module.exports = { TicketService, isValidTicketChannelName };
