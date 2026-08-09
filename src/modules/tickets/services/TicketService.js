"use strict";

const { TicketConfigKey: Key } = require("../configuration/ticketConstants");
const { TicketPermissionService } = require("./TicketPermissionService");

class TicketService {
  constructor({ repository, configService = null, transport = null, welcomeService = null }) {
    this.repository = repository;
    this.configService = configService;
    this.transport = transport;
    this.welcomeService = welcomeService;
    this.permissions = new TicketPermissionService();
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

    let channel;
    try {
      channel = await this.transport.createTicketChannel({ category, member, supportRole });
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
      const welcome = this.welcomeService.build({ t, member: ticketMember, supportRole });
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
      return result(true, "TICKET_CREATED", { channelId: channel.id, ticket });
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

    let supportRoleId;
    try {
      supportRoleId = (await this.configService.read(guildId))[Key.SUPPORT_ROLE_ID];
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
      return result(true, "TICKET_CLOSED", { ticket: updatedTicket, closedAt });
    } catch (_error) {
      return result(false, "TICKET_CLOSE_FAILED");
    }
  }
}

module.exports = { TicketService };
