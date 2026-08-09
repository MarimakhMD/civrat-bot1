"use strict";

const { TicketConfigKey: Key } = require("../configuration/ticketConstants");

class TicketService {
  constructor({ repository, configService = null, transport = null }) {
    this.repository = repository;
    this.configService = configService;
    this.transport = transport;
  }

  findOpen(guildId, userId) { return this.repository.findOpen(guildId, userId); }
  create(record) { return this.repository.create(record); }

  async createTicket({ guildId, member }) {
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
}

module.exports = { TicketService };
