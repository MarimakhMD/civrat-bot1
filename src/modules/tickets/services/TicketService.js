"use strict";

const { TicketConfigKey: Key, TicketComponentId: Id } = require("../configuration/ticketConstants");
const { TicketPremiumConfigKey: PKey } = require("../configuration/ticketPremiumConstants");
const { TicketPermissionService } = require("./TicketPermissionService");
const { resolveButtonTarget } = require("../persistence/TicketPanelRepository");

// M8 — PostgREST relaie le code SQL de la violation d'unicité. Convention déjà
// établie dans le dépôt : M4 (suggestion_votes), M5 (giveaway_entries) et B3
// (member_xp) définissent toutes cette même constante.
const UNIQUE_VIOLATION = "23505";

// Nommage Free atomique (ticket-001) : le Free suit le même format de
// référence que le défaut Premium, via le compteur atomique unique de la
// guilde. Un seul compteur, un seul canal d'incrément — aucun COUNT(*)+1.
const FREE_CHANNEL_NAME_FORMAT = "ticket-{number}";

class TicketService {
  constructor({ repository, configService = null, transport = null, welcomeService = null, transcriptService = null, ticketLog = null, premiumConfigResolver = null, counterRepository = null, channelNamingService = null, panelRepository = null }) {
    this.repository = repository;
    this.configService = configService;
    this.transport = transport;
    this.welcomeService = welcomeService;
    this.transcriptService = transcriptService;
    this.ticketLog = ticketLog;
    this.premiumConfigResolver = premiumConfigResolver;
    this.counterRepository = counterRepository;
    this.channelNamingService = channelNamingService;
    // M8 — dépôt de panels. Optionnel : sans lui, une ouverture demandant un
    // panelId est refusée (aucun repli sur la configuration de guilde).
    this.panelRepository = panelRepository;
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
  // rendu invalide => null => le nommage Free atomique prend le relais
  // (resolveFreeChannelName). C9 : si les deux échouent, createTicket
  // retourne TICKET_NAME_UNAVAILABLE — aucun repli ticket-<userId> (§12).
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

  // Nommage Free atomique : ticket-001, ticket-002… via le compteur unique
  // de la guilde (la même source que le placeholder Premium {number} — Free
  // et Premium partagent un seul compteur). Fail-closed à chaque étape :
  // compteur absent/en échec ou rendu invalide => null. C9 : le transport ne
  // fournit plus de repli, createTicket retourne alors TICKET_NAME_UNAVAILABLE.
  async resolveFreeChannelName(guildId) {
    if (!guildId || !this.counterRepository || !this.channelNamingService) return null;
    let number;
    try {
      number = await this.counterRepository.next(guildId);
    } catch (_error) {
      return null;
    }
    return this.channelNamingService.build({ format: FREE_CHANNEL_NAME_FORMAT, number });
  }

  findOpen(guildId, userId) { return this.repository.findOpen(guildId, userId); }
  create(record) { return this.repository.create(record); }

  async createTicket({ guildId, member, t = (key) => key, panelId = null, buttonIndex = null, panelRepository = null }) {
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

    // ───────────────────────────────────────────────────────────────────────
    // M8 — résolution de la catégorie et du rôle support.
    //
    // Si un panelId est fourni, la configuration vient de la LIGNE de
    // public.ticket_panels, avec fallback bouton → panel :
    //     buttons[i].category_id  ??  panel.category_id
    //     buttons[i].support_role_id ?? panel.support_role_id
    //
    // Un panel absent ou désactivé est un REFUS, jamais un repli sur
    // guild_configs : retomber silencieusement sur les défauts de guilde
    // créerait un ticket dont la configuration ne correspond à aucun panel
    // publié — exactement l'historique inventé que §12 et §14 interdisent.
    // ───────────────────────────────────────────────────────────────────────
    let categoryId = config[Key.CATEGORY_ID];
    let supportRoleId = config[Key.SUPPORT_ROLE_ID];
    let resolvedPanelId = null;

    if (panelId !== null && panelId !== undefined && panelId !== "") {
      const panels = panelRepository || this.panelRepository;
      if (!panels) return result(false, "TICKET_PANEL_UNAVAILABLE");

      let panel;
      try {
        panel = await panels.findActive(guildId, panelId);
      } catch (_error) {
        return result(false, "PERSISTENCE_ERROR");
      }
      if (!panel) return result(false, "TICKET_PANEL_UNAVAILABLE");

      const target = resolveButtonTarget(panel, buttonIndex);
      // ─────────────────────────────────────────────────────────────────────
      // Indice hors bornes : REFUS strict.
      //
      // Un buttonIndex qui n'a jamais correspondu à un bouton du panel (un
      // customId forgé, ou un reste d'un panel profondément remanié) ne doit
      // JAMAIS pouvoir ouvrir un ticket. Aucun repli sur la catégorie du panel
      // ni sur guild_configs : ce serait rendre valide n'importe quel indice.
      //
      // La compatibilité pendant une réédition est assurée EN AMONT, par
      // l'ordre des écritures dans TicketPanelDeliveryService.redeliver :
      // Discord est mis à jour AVANT la base, donc pendant la transition la
      // base contient encore l'ancien état — un sur-ensemble en cas de
      // réduction. Les boutons réellement publiés restent résolvables, et les
      // boutons retirés ne sont plus cliquables.
      // ─────────────────────────────────────────────────────────────────────
      if (!target) return result(false, "TICKET_PANEL_UNAVAILABLE", { panelId: panel.id, buttonIndex });

      categoryId = target.categoryId;
      supportRoleId = target.supportRoleId;
      resolvedPanelId = panel.id;
    }

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

    // Nommage : format Premium personnalisé d'abord ; sinon nommage Free
    // atomique (ticket-001 via le compteur unique). Toute erreur de
    // résolution => null.
    let channelName = null;
    try {
      channelName = await this.resolvePremiumChannelName({ guildId, config, member: ticketMember, supportRole });
      if (!channelName) channelName = await this.resolveFreeChannelName(guildId);
    } catch (_error) {
      channelName = null;
    }

    // C9 — §12 : AUCUN repli ticket-<userId>. Sans nom on s'arrête AVANT tout
    // appel Discord : aucun salon orphelin, aucun nommage interdit, et
    // l'utilisateur reçoit un code explicite au lieu d'un faux succès.
    // Contrôle de présence uniquement (pas isValidTicketChannelName, dont la
    // limite 89 est plus stricte que la sanitisation à 100 de
    // TicketChannelNamingService.build et rejetterait des formats Premium
    // valides) — la forme est déjà garantie par build().
    if (typeof channelName !== "string" || channelName.trim() === "") {
      return result(false, "TICKET_NAME_UNAVAILABLE");
    }

    let channel;
    try {
      channel = await this.transport.createTicketChannel({ category, member, supportRole, name: channelName });
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
      await this.rollbackTicketChannel(channel.id, "overwrites");
      return result(false, "TICKET_DISCORD_ERROR", { channelId: channel.id });
    }
    if (!overwrites?.applied) {
      await this.rollbackTicketChannel(channel.id, "overwrites_refused");
      return result(false, overwrites?.code || "TICKET_OVERWRITE_FAILED", { channelId: channel.id });
    }

    if (this.welcomeService) {
      const premium = await this.resolvePremium(guildId, config);
      const welcome = this.welcomeService.build({ t, member: ticketMember, supportRole, welcomeMessage: premium ? premium[PKey.WELCOME_MESSAGE] : null });
      try {
        await this.transport.sendTicketWelcome(channel, welcome);
      } catch (_error) {
        // P13 (B2) : compensation — plus de salon orphelin sans record.
        await this.rollbackTicketChannel(channel.id, "welcome");
        return result(false, "TICKET_WELCOME_SEND_FAILED", { channelId: channel.id });
      }
    }

    const record = {
      guild_id: guildId,
      user_id: member.id,
      channel_id: channel.id,
      // M8 — décision validée : `category` reste "support" et n'est PAS
      // refactorisé dans cette étape. L'origine réelle du ticket est portée par
      // panel_id ; nettoyer `category` est un chantier distinct.
      category: "support",
      status: "open",
      closed: false,
      // M8 — panel ayant ouvert le ticket. null quand l'ouverture ne vient
      // d'aucun panel. Colonne nullable : les tickets antérieurs à M8 restent
      // null, AUCUN backfill (on n'invente pas d'historique).
      panel_id: resolvedPanelId,
    };
    try {
      const ticket = await this.create(record);
      this.ticketLog?.({action:"ticket_created",ticketChannelId:channel.id,userId:member.id}); return result(true, "TICKET_CREATED", { channelId: channel.id, ticket });
    } catch (error) {
      // ─────────────────────────────────────────────────────────────────────
      // M8 — anti double-ouverture.
      //
      // findOpen (SELECT) puis create (INSERT) sont deux allers-retours
      // séparés : sur un double-clic, les deux passent le SELECT avant
      // qu'aucun n'insère. C'est idx_tickets_open_unique — index unique partiel
      // sur (guild_id, user_id) WHERE status IN ('open','claimed') — qui tranche.
      //
      // Le second INSERT échoue en 23505. Le salon Discord étant créé AVANT
      // l'insert, il faut le nettoyer : c'est exactement le rôle de
      // rollbackTicketChannel, déjà en place depuis P13 (B2).
      //
      // ⚠️ Le 23505 n'est traduit QUE sur l'INSERT. Sur un update (claim,
      //    reopen) il signalerait autre chose et doit remonter — même règle
      //    que M5 sur giveaway_entries.
      // ─────────────────────────────────────────────────────────────────────
      const uniqueViolation = error?.code === UNIQUE_VIOLATION;
      await this.rollbackTicketChannel(channel.id, uniqueViolation ? "unique_violation" : "persistence");
      return result(false, uniqueViolation ? "OPEN_TICKET_EXISTS" : "PERSISTENCE_ERROR", { channelId: channel.id });
    }
  }

  // P13 (B2) — compensation best-effort après échec partiel de createTicket :
  // tout salon Discord déjà créé est supprimé (aucun record n'existe encore),
  // puis l'événement est logué. Si la suppression échoue elle-même, l'orphelin
  // est logué pour le staff au lieu d'être abandonné silencieusement. Ne lève
  // jamais d'erreur : le code d'échec d'origine est toujours retourné ensuite.
  async rollbackTicketChannel(channelId, cause) {
    try {
      await this.transport.deleteTicketChannel(channelId);
      this.ticketLog?.({ action: "ticket_creation_rolled_back", ticketChannelId: channelId, reason: cause });
    } catch (_error) {
      this.ticketLog?.({ action: "ticket_creation_orphan", ticketChannelId: channelId, reason: cause });
    }
  }

  async closeTicket({ guildId, channelId, member, t = null }) {
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
      ticket = await this.repository.findByChannel(guildId, channelId);
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
      const updatedTicket = await this.repository.updateByChannel(guildId, channelId, { status: "closed", closed: true, closed_at: closedAt });
      const premium = await this.resolvePremium(guildId, config);
      const transcriptChannelId = premium?.[PKey.TRANSCRIPT_CHANNEL_ID] || config.ticket_log_channel_id;
      if (this.transcriptService) await this.transcriptService.deliver({ channelId, logChannelId: transcriptChannelId, transport: this.transport });
      // P15 : notice de fermeture avec les actions staff (réouvrir /
      // supprimer), branchées sur les routes modulaires — best-effort,
      // après le résultat : elle ne change jamais le code retourné.
      await this.sendTicketNotice(channelId, t ? {
        description: t("tickets.closedNotice"),
        components: [
          { customId: Id.REOPEN, label: t("tickets.reopen"), style: "success" },
          { customId: Id.DELETE, label: t("tickets.delete"), style: "danger" },
        ],
      } : null);
      this.ticketLog?.({action:"ticket_closed",ticketChannelId:channelId,userId:member.id}); return result(true, "TICKET_CLOSED", { ticket: updatedTicket, closedAt });
    } catch (_error) {
      return result(false, "TICKET_CLOSE_FAILED");
    }
  }

  // P15 — notice post-action (fermeture/réouverture), best-effort : envoyée
  // une fois le résultat connu, après la mise à jour persistante. Toute
  // erreur (transport absent, salon indisponible, envoi refusé) est absorbée
  // — la notice ne change jamais le code métier retourné à l'appelant.
  async sendTicketNotice(channelId, view) {
    if (!view || typeof this.transport?.sendTicketNotice !== "function") return;
    try {
      await this.transport.sendTicketNotice(channelId, view);
    } catch (_error) {
      // best-effort : échec de notice absorbé, résultat métier inchangé.
    }
  }

  async reopenTicket({ guildId, channelId, member, t = null }) {
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
      ticket = await this.repository.findByChannel(guildId, channelId);
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
      const updatedTicket = await this.repository.updateByChannel(guildId, channelId, { status: "open", closed: false, closed_at: null });
      // P15 : notice de réouverture, sans composants — best-effort.
      await this.sendTicketNotice(channelId, t ? { description: t("tickets.reopenedNotice"), components: [] } : null);
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
      ticket = await this.repository.findByChannel(guildId, channelId);
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
      const updatedTicket = await this.repository.updateByChannel(guildId, channelId, { status: "deleted", closed: true, closed_at: deletedAt });
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
      ticket = await this.repository.findByChannel(guildId, channelId);
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
    try { ticket = await this.repository.findByChannel(guildId, channelId); } catch (_error) { return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
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
    let ticket; try{ticket=await this.repository.findByChannel(guildId, channelId);}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}
    if(!ticket)return result(false,"TICKET_NOT_FOUND"); if(ticket.guild_id!==guildId)return result(false,"TICKET_GUILD_MISMATCH"); if(ticket.status==="deleted")return result(false,"TICKET_ALREADY_DELETED"); if(ticket.status==="closed"||ticket.closed)return result(false,"TICKET_ALREADY_CLOSED"); if(ticket.status==="claimed")return result(false,"TICKET_ALREADY_CLAIMED");
    let roleId; try{roleId=(await this.configService.read(guildId))[Key.SUPPORT_ROLE_ID];}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}
    let isSupport; try{isSupport=Boolean(roleId&&await this.transport.isMemberInRole(member,roleId));}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}
    if(!isSupport)return result(false,"TICKET_UNAUTHORIZED");
    let channel;try{channel=await this.transport.claimTicketChannel(channelId,ticket.user_id,member.id);}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}if(!channel?.claimed)return result(false,"TICKET_CLAIM_FAILED");
    try{const updatedTicket=await this.repository.updateByChannel(guildId,channelId,{status:"claimed"});this.ticketLog?.({action:"ticket_claimed",ticketChannelId:channelId,userId:member.id});return result(true,"TICKET_CLAIMED",{ticket:updatedTicket});}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}
  }
}

function isValidTicketChannelName(name) {
  return typeof name === "string" && /^[a-z0-9][a-z0-9-_]{0,88}$/.test(name);
}

module.exports = { TicketService, isValidTicketChannelName, FREE_CHANNEL_NAME_FORMAT };
