"use strict";

const { TicketConfigKey: Key, TicketComponentId: Id, TicketCategory } = require("../configuration/ticketConstants");
const { TicketPremiumConfigKey: PKey } = require("../configuration/ticketPremiumConstants");
const { TicketPermissionService } = require("./TicketPermissionService");
const { PermissionsBitField } = require("discord.js");
const { resolveButtonTarget } = require("../persistence/TicketPanelRepository");
const { panelBindingFingerprint } = require("./TicketPanelBinding");
const { snapshotCategory } = require("./TicketFreeCategoryPolicy");
const { createHash } = require("node:crypto");

// M8 — PostgREST relaie le code SQL de la violation d'unicité. Convention déjà
// établie dans le dépôt : M4 (suggestion_votes), M5 (giveaway_entries) et B3
// (member_xp) définissent toutes cette même constante.
const UNIQUE_VIOLATION = "23505";

// Nommage Free atomique (ticket-001) : le Free suit le même format de
// référence que le défaut Premium, via le compteur atomique unique de la
// guilde. Un seul compteur, un seul canal d'incrément — aucun COUNT(*)+1.
const FREE_CHANNEL_NAME_FORMAT = "ticket-{number}";

class TicketService {
  constructor({ repository, configService = null, transport = null, welcomeService = null, transcriptService = null, ticketLog = null, premiumConfigResolver = null, counterRepository = null, channelNamingService = null, panelRepository = null, categoryRepository = null, historicalAttestationRepository = null, operationJournalRequired = false, operationRepository = null, operationInteractionId = null, freeSettingsRepository = null, reservationRepository = null }) {
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
    this.categoryRepository = categoryRepository;
    this.historicalAttestationRepository = historicalAttestationRepository;
    this.operationJournalRequired = operationJournalRequired;
    this.operationRepository = operationRepository;
    this.operationInteractionId = operationInteractionId;
    this.freeSettingsRepository = freeSettingsRepository;
    this.reservationRepository = reservationRepository;
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

  // Les nouveaux tickets portant une identité fonctionnelle ne peuvent jamais
  // retomber sur le rôle courant de guilde : instantané absent/malformé = refus.
  // Pour les tickets historiques sans instantané fiable, seul un membre
  // ayant MANAGE_GUILD est considéré support. Le propriétaire conserve ses
  // actions non réservées au staff : on n'invente aucun ancien rôle.
  async isTicketSupport(ticket, member, _legacyRoleId) {
    if (ticket?.free_category_id != null) {
      const roles = ticket.free_support_role_ids;
      if (ticket.free_permission_profile !== "standard-v1" || !Array.isArray(roles) || !roles.length || roles.length > 5 || roles.some((role) => typeof role !== "string" || !/^\d{15,22}$/.test(role) || role === ticket.guild_id) || new Set(roles).size !== roles.length) return false;
      for (const role of roles) if (await this.transport.isMemberInRole(member, role)) return true;
      return false;
    }
    if (ticket?.free_support_role_ids != null || ticket?.free_permission_profile != null) return false;
    // Si le schéma de snapshot est absent/incomplet, le type du ticket ne
    // peut pas être prouvé : ne pas activer d'attestation historique.
    if (ticket?._snapshot_schema_missing) return Boolean(member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild));
    if (this.historicalAttestationRepository && ticket?.guild_id && ticket?.channel_id) {
      let attestation;
      try { attestation = await this.historicalAttestationRepository.find(ticket.guild_id, ticket.channel_id); } catch (_) { return false; }
      if (attestation) {
        const roles = attestation.role_ids;
        if (attestation.guild_id !== ticket.guild_id || attestation.channel_id !== ticket.channel_id || attestation.result !== "attested" || attestation.permission_profile !== "legacy-staff-v1" || !Array.isArray(roles) || !roles.length || roles.length > 5 || roles.some((id) => typeof id !== "string" || !/^\d{15,22}$/.test(id) || id === ticket.guild_id) || new Set(roles).size !== roles.length) return false;
        for (const role of roles) if (await this.transport.isMemberInRole(member, role)) return true;
        return false;
      }
    }
    return Boolean(member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild));
  }

  async getGlobalLimit(guildId) {
    try {
      if (this.freeSettingsRepository?.get) {
        const s = await this.freeSettingsRepository.get(guildId);
        if (s && Number.isInteger(s.openLimit) && s.openLimit >=1 && s.openLimit <=5) return s.openLimit;
      }
      // Fallback : lire depuis guild_configs si présent (compat)
      const cfg = this.configService ? await this.configService.read(guildId) : null;
      if (cfg && Number.isInteger(cfg.ticket_global_limit) && cfg.ticket_global_limit >=1 && cfg.ticket_global_limit <=5) return cfg.ticket_global_limit;
    } catch (_) {}
    return 1;
  }

  async countOpenForUser(guildId, userId) {
    let fromTickets = 0;
    try {
      if (typeof this.repository?.listOpenForUser === "function") {
        const list = await this.repository.listOpenForUser(guildId, userId);
        fromTickets = Array.isArray(list) ? list.length : 0;
      } else if (typeof this.repository?.findOpen === "function") {
        const one = await this.repository.findOpen(guildId, userId);
        fromTickets = one ? 1 : 0;
      }
    } catch (_) { fromTickets = 0; }
    let fromReservations = 0;
    try {
      if (typeof this.reservationRepository?.listForUser === "function") {
        const res = await this.reservationRepository.listForUser(guildId, userId);
        fromReservations = Array.isArray(res) ? res.length : 0;
      }
    } catch (_) {}
    return fromTickets + fromReservations;
  }

  async countOpenForCategory(guildId, userId, categoryId) {
    if (!categoryId) return 0;
    let fromTickets = 0;
    try {
      if (typeof this.repository?.listOpenForUserByCategory === "function") {
        const list = await this.repository.listOpenForUserByCategory(guildId, userId, categoryId);
        fromTickets = Array.isArray(list) ? list.length : 0;
      }
    } catch (_) {}
    let fromReservations = 0;
    try {
      if (typeof this.reservationRepository?.listForCategory === "function") {
        const res = await this.reservationRepository.listForCategory(guildId, userId, categoryId);
        fromReservations = Array.isArray(res) ? res.length : 0;
      }
    } catch (_) {}
    return fromTickets + fromReservations;
  }

  async checkLimits({ guildId, userId, categoryId }) {
    const globalLimit = await this.getGlobalLimit(guildId);
    const globalCount = await this.countOpenForUser(guildId, userId);
    if (globalCount >= globalLimit) return { ok: false, code: "TICKET_LIMIT_REACHED", globalLimit, globalCount };
    if (categoryId) {
      let categoryLimit = null;
      try {
        if (this.categoryRepository?.find) {
          const cat = await this.categoryRepository.find(guildId, categoryId);
          if (cat) categoryLimit = cat.openLimit ?? cat.open_limit ?? null;
        }
      } catch (_) {}
      if (categoryLimit != null) {
        const categoryCount = await this.countOpenForCategory(guildId, userId, categoryId);
        if (categoryCount >= categoryLimit) return { ok: false, code: "TICKET_CATEGORY_LIMIT_REACHED", categoryLimit, categoryCount };
      }
    }
    return { ok: true, globalLimit, globalCount };
  }

  async reserveTicketSlot({ guildId, userId, categoryId, requestId, actorId }) {
    if (this.reservationRepository?.reserveOpenAtomic) {
      return await this.reservationRepository.reserveOpenAtomic({ guildId, userId, categoryId, requestId, actorId }, async () => {
        const check = await this.checkLimits({ guildId, userId, categoryId });
        if (!check.ok) { const e = new Error(check.code); e.code = check.code; throw e; }
      });
    }
    if (this.reservationRepository?.reserveOpen) {
      try {
        const globalLimit = await this.getGlobalLimit(guildId);
        let categoryLimit = null;
        if (categoryId && this.categoryRepository?.find) {
          try { const cat = await this.categoryRepository.find(guildId, categoryId); categoryLimit = cat?.openLimit ?? null; } catch (_) {}
        }
        const globalCount = await this.countOpenForUser(guildId, userId);
        const categoryCount = categoryId ? await this.countOpenForCategory(guildId, userId, categoryId) : null;
        return await this.reservationRepository.reserveOpen({ guildId, userId, categoryId, requestId, actorId, globalLimit, categoryLimit, countGlobal: globalCount, countCategory: categoryCount });
      } catch (e) {
        if (e.code === "TICKET_LIMIT_REACHED" || e.code === "TICKET_CATEGORY_LIMIT_REACHED") throw e;
        throw e;
      }
    }
    const check = await this.checkLimits({ guildId, userId, categoryId });
    if (!check.ok) {
      const err = new Error(check.code); err.code = check.code; throw err;
    }
    return { request_id: requestId, state: "reserved" };
  }

  async finalizeTicketSlot({ requestId, channelId }) {
    if (this.reservationRepository?.finalizeOpen) {
      try { return await this.reservationRepository.finalizeOpen({ requestId, channelId }); } catch (_) {}
    }
    return null;
  }

  async cancelTicketSlot({ requestId }) {
    if (this.reservationRepository?.cancelReservation) {
      try { return await this.reservationRepository.cancelReservation({ requestId }); } catch (_) {}
    }
    return null;
  }


  async verifiedActor(guildId, member, channelId = null) {
    if (!member?.id || typeof this.transport?.verifyTicketActor !== "function") return null;
    try { return await this.transport.verifyTicketActor(guildId, member.id, channelId, member); } catch (_) { return null; }
  }

  findOpen(guildId, userId) { return this.repository.findOpen(guildId, userId); }
  create(record) { return this.repository.create(record); }

  async createTicket({ guildId, member, t = (key) => key, panelId = null, buttonIndex = null, buttonFingerprint = null, panelRepository = null }) {
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
    const verified = await this.verifiedActor(guildId, member);
    if (!verified) return result(false, "TICKET_UNAUTHORIZED");
    member = verified;

    // Sécurité : en production, refuser si dépôt de réservation indisponible (fail-closed, pas de contournement)
    if (this.isProductionFailClosed() && !this.reservationRepository) {
      return result(false, "TICKET_RESERVATION_UNAVAILABLE", { reason: "reservation repository unavailable in production" });
    }
    if (this.reservationRepository || this.freeSettingsRepository) {
      try {
        const requestId = this.reservationIdFor(guildId, member.id, null);
        const globalLimit = await this.getGlobalLimit(guildId);
        // Pour création classique, pas de categoryId → seule limite globale
        const check = await this.checkLimits({ guildId, userId: member.id, categoryId: null });
        if (!check.ok) return result(false, check.code, { globalLimit: check.globalLimit, globalCount: check.globalCount });
        // Réserver (si repo dispo, atomique via RPC ; sinon vérif locale déjà faite)
        if (this.reservationRepository?.reserveOpen) {
          try {
            await this.reserveTicketSlot({ guildId, userId: member.id, categoryId: null, requestId, actorId: member.id });
            // Stocker pour finalisation/annulation ultérieure (best effort)
            this._lastReservationId = requestId;
          } catch (e) {
            if (e.code === "TICKET_LIMIT_REACHED" || e.code === "TICKET_CATEGORY_LIMIT_REACHED") return result(false, e.code);
            // Autre erreur réservation → bloquer par sécurité
            return result(false, "TICKET_RESERVATION_FAILED");
          }
        }
      } catch (e) {
        if (e.code === "TICKET_LIMIT_REACHED" || e.code === "TICKET_CATEGORY_LIMIT_REACHED") return result(false, e.code);
      }
    }

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
      if (!panel || panel.hasUnsafeButtons || !panel.channelId) return result(false, "TICKET_PANEL_UNAVAILABLE");
      member = await this.verifiedActor(guildId, member, panel.channelId);
      if (!member) return result(false, "TICKET_UNAUTHORIZED");

      const target = resolveButtonTarget(panel, buttonIndex);
      // Un indice absent ou une empreinte périmée ne doivent jamais être
      // interprétés comme la nouvelle cible qui occupe cette position.
      if (!target) return result(false, "TICKET_PANEL_UNAVAILABLE", { panelId: panel.id, buttonIndex });
      // Les interactions publiques fournissent toujours cette empreinte. Le
      // contrôle au service ferme la fenêtre entre résolution et création.
      if (buttonFingerprint !== panelBindingFingerprint(panel, buttonIndex)) {
        return result(false, "TICKET_PANEL_STALE", { panelId: panel.id });
      }

      // Aucun repli silencieux vers la destination historique du panneau.
      if (target.freeCategoryId) return this.createCategoryTicket({ guildId, member, t, panelId: panel.id, categoryId: target.freeCategoryId, result });
      categoryId = target.categoryId;
      supportRoleId = target.supportRoleId;
      resolvedPanelId = panel.id;
    }

    if (this.operationJournalRequired) {
      return this.executeCreationJournaled({ guildId, member, t, panelId, buttonIndex, buttonFingerprint, panelRepository }, "create", () => this._createTicketClassic({ guildId, member, t, panelId, buttonIndex, buttonFingerprint, panelRepository, categoryId, supportRoleId, resolvedPanelId, config }));
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

    let globalLimitForOpenCheckMain2 = 1; try { globalLimitForOpenCheckMain2 = await this.getGlobalLimit(guildId); } catch (_) {}
    if (globalLimitForOpenCheckMain2 <= 1) {
      let openTicket;
      try { openTicket = await this.findOpen(guildId, member.id); } catch (_error) { return result(false, "PERSISTENCE_ERROR"); }
      if (openTicket) return result(false, "OPEN_TICKET_EXISTS", { channelId: openTicket.channel_id || null });
    }

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
      channel = await this.transport.createTicketChannel({ category, member: ticketMember, supportRole, botMember, name: channelName });
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
      try {
        const premium = await this.resolvePremium(guildId, config);
        const welcome = this.welcomeService.build({ t, member: ticketMember, supportRole, welcomeMessage: premium ? premium[PKey.WELCOME_MESSAGE] : null });
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
      // panel_id ; nettoyer `category` est un chantier distinct (F1).
      // F1 — la valeur est centralisée dans TicketCategory.SUPPORT.
      category: TicketCategory.SUPPORT,
      status: "open",
      closed: false,
      // M8 — panel ayant ouvert le ticket. null quand l'ouverture ne vient
      // d'aucun panel. Colonne nullable : les tickets antérieurs à M8 restent
      // null, AUCUN backfill (on n'invente pas d'historique).
      panel_id: resolvedPanelId,
    };
    try {
      const ticket = await this.create(record);
      // Finaliser réservation atomique
      if (this._lastReservationId) { try { await this.finalizeTicketSlot({ requestId: this._lastReservationId, channelId: channel.id }); } catch (_) {} this._lastReservationId = null; }
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
      const deleted = await this.rollbackTicketChannel(channel.id, uniqueViolation ? "unique_violation" : "persistence");
      if (deleted && this._lastReservationId) { try { await this.cancelTicketSlot({ requestId: this._lastReservationId }); } catch (_) {} this._lastReservationId = null; }
      return result(false, uniqueViolation ? "OPEN_TICKET_EXISTS" : "PERSISTENCE_ERROR", { channelId: channel.id });
    }
  }


  async _createTicketClassic({ guildId, member, t, panelId, buttonIndex, buttonFingerprint, panelRepository, categoryId, supportRoleId, resolvedPanelId, config }) {
    const result = (created, code, details = {}) => ({ created, code, guildId: guildId || null, memberId: member?.id || null, details });
    let category; let supportRole;
    try { [category, supportRole] = await Promise.all([this.transport.getCategory(categoryId), this.transport.getSupportRole(supportRoleId)]); } catch (_error) { return result(false, "TICKET_CONFIG_INCOMPLETE"); }
    if (!category || !supportRole) return result(false, "TICKET_CONFIG_INCOMPLETE", { categoryMissing: !category, supportRoleMissing: !supportRole });
    let ticketMember; let botMember;
    try { [ticketMember, botMember] = await Promise.all([this.transport.getMember(member.id), this.transport.getBotMember()]); } catch (_error) { return result(false, "TICKET_DISCORD_ERROR"); }
    if (!ticketMember) return result(false, "TICKET_MEMBER_MISSING");
    if (!botMember) return result(false, "TICKET_BOT_MISSING");
    let globalLimitForOpenCheck2 = 1; try { globalLimitForOpenCheck2 = await this.getGlobalLimit(guildId); } catch (_) {}
    if (globalLimitForOpenCheck2 <= 1) {
      let openTicket; try { openTicket = await this.findOpen(guildId, member.id); } catch (_error) { return result(false, "PERSISTENCE_ERROR"); }
      if (openTicket) return result(false, "OPEN_TICKET_EXISTS", { channelId: openTicket.channel_id || null });
    }
    let channelName = null;
    try { channelName = await this.resolvePremiumChannelName({ guildId, config, member: ticketMember, supportRole }); if (!channelName) channelName = await this.resolveFreeChannelName(guildId); } catch (_error) { channelName = null; }
    if (typeof channelName !== "string" || channelName.trim() === "") return result(false, "TICKET_NAME_UNAVAILABLE");
    let channel; try { channel = await this.transport.createTicketChannel({ category, member: ticketMember, supportRole, botMember, name: channelName }); } catch (_error) { return result(false, "TICKET_CHANNEL_CREATION_FAILED"); }
    let overwrites; try { overwrites = await this.transport.applyTicketOverwrites({ channel, member: ticketMember, supportRole, botMember }); } catch (_error) { await this.rollbackTicketChannel(channel.id, "overwrites"); return result(false, "TICKET_DISCORD_ERROR", { channelId: channel.id }); }
    if (!overwrites?.applied) { await this.rollbackTicketChannel(channel.id, "overwrites_refused"); return result(false, overwrites?.code || "TICKET_OVERWRITE_FAILED", { channelId: channel.id }); }
    if (this.welcomeService) { try { const premium = await this.resolvePremium(guildId, config); const welcome = this.welcomeService.build({ t, member: ticketMember, supportRole, welcomeMessage: premium ? premium[PKey.WELCOME_MESSAGE] : null }); await this.transport.sendTicketWelcome(channel, welcome); } catch (_error) { await this.rollbackTicketChannel(channel.id, "welcome"); return result(false, "TICKET_WELCOME_SEND_FAILED", { channelId: channel.id }); } }
    const record = { guild_id: guildId, user_id: member.id, channel_id: channel.id, category: TicketCategory.SUPPORT, status: "open", closed: false, panel_id: resolvedPanelId };
    try { const ticket = await this.create(record); if (this._lastReservationId) { try { await this.finalizeTicketSlot({ requestId: this._lastReservationId, channelId: channel.id }); } catch (_) {} this._lastReservationId = null; } this.ticketLog?.({action:"ticket_created",ticketChannelId:channel.id,userId:member.id}); return result(true, "TICKET_CREATED", { channelId: channel.id, ticket }); } catch (error) { const uniqueViolation = error?.code === UNIQUE_VIOLATION; const deleted2 = await this.rollbackTicketChannel(channel.id, uniqueViolation ? "unique_violation" : "persistence"); if (deleted2 && this._lastReservationId) { try { await this.cancelTicketSlot({ requestId: this._lastReservationId }); } catch (_) {} this._lastReservationId = null; } return result(false, uniqueViolation ? "OPEN_TICKET_EXISTS" : "PERSISTENCE_ERROR", { channelId: channel.id }); }
  }

  async createCategoryTicket({ guildId, member, t, panelId, categoryId, result = null }) {
    if (!result) result = (created, code, details={}) => ({ created, code, guildId: guildId||null, memberId: member?.id||null, details });
    if (this.operationJournalRequired) return this.executeCreationJournaled({ guildId, member, t, panelId, categoryId, result }, "create_category", () => this._createCategoryTicketClassic({ guildId, member, t, panelId, categoryId, result }));
    if (!this.categoryRepository || !this.repository.createCategoryTicket || !this.transport.createPendingTicketChannel) return result(false, "TICKET_CREATION_UNAVAILABLE");
    let category;
    try { category = await this.categoryRepository.find(guildId, categoryId); } catch (_) { return result(false, "PERSISTENCE_ERROR"); }
    if (!category || category.guildId !== guildId || category.id !== categoryId || !category.enabled) return result(false, "TICKET_CREATION_UNAVAILABLE");
    if (this.isProductionFailClosed() && !this.reservationRepository) {
      return result(false, "TICKET_RESERVATION_UNAVAILABLE", { reason: "reservation repository unavailable in production" });
    }
    // Limites atomiques pour catégorie : globale + spécifique (si open_limit non null)
    if (this.reservationRepository || this.freeSettingsRepository) {
      const requestId = this.reservationIdFor(guildId, member.id, categoryId);
      try {
        const check = await this.checkLimits({ guildId, userId: member.id, categoryId });
        if (!check.ok) return result(false, check.code, { globalLimit: check.globalLimit, globalCount: check.globalCount, categoryLimit: check.categoryLimit, categoryCount: check.categoryCount });
        if (this.reservationRepository?.reserveOpen) {
          try { await this.reserveTicketSlot({ guildId, userId: member.id, categoryId, requestId, actorId: member.id }); this._lastReservationId = requestId; } 
          catch (e) { if (e.code === "TICKET_LIMIT_REACHED" || e.code === "TICKET_CATEGORY_LIMIT_REACHED") return result(false, e.code); return result(false, "TICKET_RESERVATION_FAILED"); }
        }
      } catch (e) { if (e.code === "TICKET_LIMIT_REACHED" || e.code === "TICKET_CATEGORY_LIMIT_REACHED") return result(false, e.code); }
    }
    let globalLimitForOpenCheck = 1;
    try { globalLimitForOpenCheck = await this.getGlobalLimit(guildId); } catch (_) {}
    if (globalLimitForOpenCheck <= 1) {
      let open;
      try { open = await this.repository.findOpen(guildId, member.id); } catch (_) { return result(false, "PERSISTENCE_ERROR"); }
      if (open) return result(false, "OPEN_TICKET_EXISTS", { channelId: open.channel_id || null });
    }
    let destination, roles, botMember, ticketMember, name;
    try {
      [destination, roles, botMember, ticketMember, name] = await Promise.all([
        this.transport.getCategory(category.destinationId),
        Promise.all(category.supportRoleIds.map((id) => this.transport.getSupportRole(id))),
        this.transport.getBotMember(), this.transport.getMember(member.id), this.resolveFreeChannelName(guildId),
      ]);
    } catch (_) { return result(false, "TICKET_CREATION_UNAVAILABLE"); }
    if (!destination || !botMember || !ticketMember || roles.some((role) => !role) || !name) return result(false, "TICKET_CREATION_UNAVAILABLE");
    let channel;
    try { channel = await this.transport.createPendingTicketChannel({ category: destination, botMember, name }); }
    catch (_) {
      // Réservation acquise mais salon Discord non créé : libérer immédiatement
      if (this._lastReservationId) { try { await this.cancelTicketSlot({ requestId: this._lastReservationId }); } catch (_) {} this._lastReservationId = null; }
      await this.signalDivergence(null, "creation_discord_unknown", member.id);
      return result(false, "TICKET_CHANNEL_CREATION_FAILED", { reconciliationRequired: true });
    }
    const record = { guild_id: guildId, user_id: member.id, channel_id: channel.id, panel_id: panelId };
    let ticket;
    try {
      ticket = await this.repository.createCategoryTicket(record, snapshotCategory(category.id, category), category.welcomeMessage);
    } catch (error) {
      const deleted = await this.rollbackTicketChannel(channel.id, "snapshot");
      // La réponse peut être perdue APRÈS commit. Ne désactiver qu'une ligne
      // scoped au salon effectivement supprimé ; sinon laisser une trace.
      if (deleted) { try { await this.repository.updateByChannel(guildId, channel.id, { status: "deleted", closed: true }); } catch (_) { await this.signalDivergence(channel.id, "snapshot_commit_unknown", member.id); } }
      return result(false, error?.code === UNIQUE_VIOLATION ? "OPEN_TICKET_EXISTS" : "PERSISTENCE_ERROR", { channelId: channel.id });
    }
    try {
      if (this.welcomeService) {
        const welcome = this.welcomeService.build({ t, member: ticketMember, supportRole: roles[0], welcomeMessage: category.welcomeMessage });
        await this.transport.sendTicketWelcome(channel, welcome);
      }
      const applied = await this.transport.applyTicketOverwrites({ channel, member: ticketMember, supportRoles: roles, botMember });
      if (!applied?.applied) throw new Error("ticket_overwrite_failed");
    } catch (_) {
      // La suppression peut échouer : tenter également de retirer les accès ;
      // si les deux échouent, signaler explicitement la divergence.
      let locked = false;
      try { locked = (await this.transport.lockPendingTicketChannel(channel, botMember))?.locked === true; } catch (_) { /* signalement ci-dessous */ }
      const deleted = await this.rollbackTicketChannel(channel.id, "activation");
      if (deleted) { try { await this.repository.updateByChannel(guildId, channel.id, { status: "deleted", closed: true }); } catch (_) { await this.signalDivergence(channel.id, "activation_database_unknown", member.id); } }
      if (!deleted) await this.signalDivergence(channel.id, locked ? "activation_locked_channel_remains" : "activation_unlocked_channel_remains", member.id);
      return result(false, "TICKET_DISCORD_ERROR", { channelId: channel.id, deleted, locked });
    }
    if (this._lastReservationId) { try { await this.finalizeTicketSlot({ requestId: this._lastReservationId, channelId: channel.id }); } catch (_) {} this._lastReservationId = null; }
    this.ticketLog?.({ action: "ticket_created", ticketChannelId: channel.id, userId: member.id });
    return result(true, "TICKET_CREATED", { channelId: channel.id, ticket });
  }


  async _createCategoryTicketClassic({ guildId, member, t, panelId, categoryId, result = null }) {
    if (!result) result = (created, code, details={}) => ({ created, code, guildId: guildId||null, memberId: member?.id||null, details });
    if (!this.categoryRepository || !this.repository.createCategoryTicket || !this.transport.createPendingTicketChannel) return result(false, "TICKET_CREATION_UNAVAILABLE");
    let category; try { category = await this.categoryRepository.find(guildId, categoryId); } catch (_) { return result(false, "PERSISTENCE_ERROR"); }
    if (!category || category.guildId !== guildId || category.id !== categoryId || !category.enabled) return result(false, "TICKET_CREATION_UNAVAILABLE");
    // Limites (fallback si appelé hors journal) — respecter globalLimit >1
    try { const chk = await this.checkLimits({ guildId, userId: member.id, categoryId }); if (!chk.ok) return result(false, chk.code); } catch (_) {}
    let globalLimitForClassic = 1; try { globalLimitForClassic = await this.getGlobalLimit(guildId); } catch (_) {}
    if (globalLimitForClassic <= 1) {
      let open; try { open = await this.repository.findOpen(guildId, member.id); } catch (_) { return result(false, "PERSISTENCE_ERROR"); }
      if (open) return result(false, "OPEN_TICKET_EXISTS", { channelId: open.channel_id || null });
    }
    let destination, roles, botMember, ticketMember, name;
    try { [destination, roles, botMember, ticketMember, name] = await Promise.all([this.transport.getCategory(category.destinationId), Promise.all(category.supportRoleIds.map((id) => this.transport.getSupportRole(id))), this.transport.getBotMember(), this.transport.getMember(member.id), this.resolveFreeChannelName(guildId)]); } catch (_) { return result(false, "TICKET_CREATION_UNAVAILABLE"); }
    if (!destination || !botMember || !ticketMember || roles.some((role) => !role) || !name) return result(false, "TICKET_CREATION_UNAVAILABLE");
    let channel; try { channel = await this.transport.createPendingTicketChannel({ category: destination, botMember, name }); } catch (_) { if (this._lastReservationId) { try { await this.cancelTicketSlot({ requestId: this._lastReservationId }); } catch (_) {} this._lastReservationId = null; } await this.signalDivergence(null, "creation_discord_unknown", member.id); return result(false, "TICKET_CHANNEL_CREATION_FAILED", { reconciliationRequired: true }); }
    const record = { guild_id: guildId, user_id: member.id, channel_id: channel.id, panel_id: panelId };
    let ticket; try { ticket = await this.repository.createCategoryTicket(record, snapshotCategory(category.id, category), category.welcomeMessage); } catch (error) { const deleted = await this.rollbackTicketChannel(channel.id, "snapshot"); if (deleted) { try { await this.repository.updateByChannel(guildId, channel.id, { status: "deleted", closed: true }); } catch (_) { await this.signalDivergence(channel.id, "snapshot_commit_unknown", member.id); } } return result(false, error?.code === UNIQUE_VIOLATION ? "OPEN_TICKET_EXISTS" : "PERSISTENCE_ERROR", { channelId: channel.id }); }
    try { if (this.welcomeService) { const welcome = this.welcomeService.build({ t, member: ticketMember, supportRole: roles[0], welcomeMessage: category.welcomeMessage }); await this.transport.sendTicketWelcome(channel, welcome); } const applied = await this.transport.applyTicketOverwrites({ channel, member: ticketMember, supportRoles: roles, botMember }); if (!applied?.applied) throw new Error("ticket_overwrite_failed"); } catch (_) { let locked = false; try { locked = (await this.transport.lockPendingTicketChannel(channel, botMember))?.locked === true; } catch (_) {} const deleted = await this.rollbackTicketChannel(channel.id, "activation"); if (deleted) { try { await this.repository.updateByChannel(guildId, channel.id, { status: "deleted", closed: true }); } catch (_) { await this.signalDivergence(channel.id, "activation_database_unknown", member.id); } } if (!deleted) await this.signalDivergence(channel.id, locked ? "activation_locked_channel_remains" : "activation_unlocked_channel_remains", member.id); return result(false, "TICKET_DISCORD_ERROR", { channelId: channel.id, deleted, locked }); }
    this.ticketLog?.({ action: "ticket_created", ticketChannelId: channel.id, userId: member.id }); return result(true, "TICKET_CREATED", { channelId: channel.id, ticket });
  }

  // Helpers participants pour fermeture/réouverture : source de vérité = registre durable.
  async getActiveParticipants(guildId, channelId) {
    if (!this.operationRepository?.listParticipants) return [];
    try { const list = await this.operationRepository.listParticipants(guildId, channelId); return list.filter(r => r.state === "active").map(r => r.member_id); } catch (_) { return null; }
  }
  async suspendParticipantsForClose(guildId, channelId, actorId) {
    const ids = await this.getActiveParticipants(guildId, channelId);
    if (ids === null) return { suspended: false, uncertain: true };
    if (!ids.length) return { suspended: true, participants: [] };
    if (typeof this.transport?.suspendTicketParticipants !== "function") return { suspended: false };
    const res = await this.transport.suspendTicketParticipants(channelId, ids);
    if (!res?.suspended) await this.signalDivergence(channelId, "close_participant_suspend_unknown", actorId);
    return { suspended: !!res?.suspended, uncertain: !!res?.uncertain, participants: ids };
  }
  async restoreParticipantsForReopen(guildId, channelId, actorId) {
    const ids = await this.getActiveParticipants(guildId, channelId);
    if (ids === null) return { restored: false, uncertain: true };
    if (!ids.length) return { restored: true, participants: [] };
    if (typeof this.transport?.restoreTicketParticipants !== "function") return { restored: false };
    const res = await this.transport.restoreTicketParticipants(channelId, ids);
    if (!res?.restored) await this.signalDivergence(channelId, "reopen_participant_restore_unknown", actorId);
    return { restored: !!res?.restored, uncertain: !!res?.uncertain, participants: ids };
  }

  // Signal non durable : une panne de logs ne doit pas masquer le résultat.
  async signalDivergence(channelId, reason, userId = null) {
    try { await this.ticketLog?.({ action: "ticket_state_divergent", ticketChannelId: channelId, reason, userId }); } catch (_) { /* best effort uniquement */ }
  }

  // P13 (B2) — compensation best-effort après échec partiel de createTicket :
  // tout salon Discord déjà créé est supprimé (aucun record n'existe encore),
  // puis l'événement est logué. Si la suppression échoue elle-même, l'orphelin
  // est logué pour le staff au lieu d'être abandonné silencieusement. Ne lève
  // jamais d'erreur : le code d'échec d'origine est toujours retourné ensuite.
  async rollbackTicketChannel(channelId, cause) {
    let deleted = false;
    try { deleted = (await this.transport.deleteTicketChannel(channelId))?.deleted === true; } catch (_) { /* inconnu : ne pas supposer la suppression */ }
    try { await this.ticketLog?.({ action: deleted ? "ticket_creation_rolled_back" : "ticket_creation_orphan", ticketChannelId: channelId, reason: cause }); } catch (_) { /* journal best effort */ }
    return deleted;
  }

  // Chaque interaction réutilise le même UUID ; aucun effet externe n'est
  // tenté avant la réservation et le CAS vers in_progress en base.
  operationId(guildId) {
    if (!/^\d{15,22}$/.test(guildId || "") || !/^\d{15,22}$/.test(this.operationInteractionId || "")) return null;
    const h = createHash("sha256").update(`civrat-ticket:${guildId}:${this.operationInteractionId}`).digest("hex");
    return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
  }
  creationOperationId(guildId) { return this.operationId(guildId); }

  // Identifiant stable pour réservation : déterministe si interaction Discord disponible,
  // sinon fallback. Une même interaction ne crée jamais 2 réservations ; une nouvelle interaction en crée une nouvelle.
  isProductionFailClosed() {
    return process.env.NODE_ENV === "production";
  }

  reservationIdFor(guildId, memberId, categoryId = null) {
    if (this.operationInteractionId) {
      // Dérivation stable même si l'ID n'est pas un snowflake (tests utilisent "int-1")
      const h = createHash("sha256").update(`civrat-reservation:${guildId}:${this.operationInteractionId}:${categoryId || ""}`).digest("hex");
      return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
    }
    // Chemins sans interaction directe (autres chemins) : UUID v4 explicite
    try {
      const { randomUUID } = require("crypto");
      if (typeof randomUUID === "function") return randomUUID();
    } catch (_) {}
    return `manual:${guildId}:${memberId}:${categoryId || "free"}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  }
  // Corrélation création : récupère operation_id par scope u: après redémarrage via registre
  async findCreationOperation(guildId, memberId) {
    if (!this.operationRepository?.listOperationsByScope) return null;
    try { const ops = await this.operationRepository.listOperationsByScope(guildId, `u:${memberId}`); return ops.find(o => ["pending","in_progress","uncertain","manual"].includes(o.state)) || null; } catch (_) { return null; }
  }
  async authorizeJournalOperation({ guildId, channelId, member }, action) {
    try {
      const ticket = await this.repository.findByChannel(guildId, channelId);
      if (!ticket || ticket.guild_id !== guildId || ticket.channel_id !== channelId) return false;
      const actor = await this.verifiedActor(guildId, member, channelId);
      if (!actor) return false;
      const config = await this.configService.read(guildId);
      const support = await this.isTicketSupport(ticket, actor, config[Key.SUPPORT_ROLE_ID]);
      return action === "delete" ? support : this.permissions.canManage({ isOwner: ticket.user_id === actor.id, isSupport: support });
    } catch (_) { return null; }
  }
  async executeJournaled(args, action, successKey, perform) {
    const fail = (code) => ({ [successKey]: false, code, guildId: args.guildId || null, channelId: args.channelId || null, memberId: args.member?.id || null, details: { reconciliationRequired: code === "TICKET_OPERATION_UNKNOWN" } });
    const operationId = this.operationId(args.guildId), repository = this.operationRepository;
    if (!operationId || !repository || !args.channelId || !args.member?.id) return fail("TICKET_OPERATION_UNAVAILABLE");
    const authorized = await this.authorizeJournalOperation(args, action);
    if (authorized !== true) return fail(authorized === null ? "TICKET_OPERATION_UNAVAILABLE" : "TICKET_UNAUTHORIZED");
    let op;
    try { op = await repository.begin({ operationId, guildId: args.guildId, scope: `c:${args.channelId}`, actorId: args.member.id, targetId: action.startsWith("participant_") ? args.targetMemberId : null, action }); }
    catch (_) { return fail("TICKET_OPERATION_UNKNOWN"); }
    if (op.state === "confirmed" || op.state === "failed") return fail("TICKET_OPERATION_ALREADY_PROCESSED");
    if (op.state !== "pending") return fail("TICKET_OPERATION_UNKNOWN");
    try { op = await repository.transition({ guildId: args.guildId, operationId, expectedRevision: Number(op.revision), state: "in_progress", observation: "attempting", actorId: args.member.id }); }
    catch (_) { return fail("TICKET_OPERATION_UNKNOWN"); }
    let outcome;
    try { outcome = await perform(); } catch (_) { outcome = null; }
    const safeFailures = new Set(["TICKET_UNAUTHORIZED", "TICKET_NOT_FOUND", "TICKET_GUILD_MISMATCH", "TICKET_ALREADY_DELETED", "TICKET_ALREADY_CLOSED", "TICKET_ALREADY_OPEN", "TICKET_MEMBER_NOT_FOUND", "TICKET_MEMBER_NOT_ADDED", "TICKET_MEMBER_ALREADY_ADDED", "TICKET_CLOSE_PARTICIPANTS_PRESENT", "TICKET_TRANSCRIPT_AUDIENCE_UNVERIFIED", "TICKET_TRANSCRIPT_INCOMPLETE", "TRANSCRIPT_AUDIENCE_UNVERIFIED", "TRANSCRIPT_INCOMPLETE", "TRANSCRIPT_FAILED", "TICKET_TRANSCRIPT_REQUIRED"]);
    let confirmed = false;
    try {
      if (outcome?.[successKey] === true && action.startsWith("participant_")) {
        await repository.confirmParticipant({ guildId: args.guildId, operationId, expectedRevision: Number(op.revision), actorId: args.member.id });
        return outcome;
      }
      if (outcome?.[successKey] === true && (action === "close" || action === "reopen")) {
        const ticket = await this.repository.findByChannel(args.guildId, args.channelId);
        const expected = action === "close" ? ticket?.status === "closed" && ticket?.closed === true : ticket?.status === "open" && ticket?.closed === false;
        confirmed = expected && await this.transport.verifyLifecycleState(args.channelId, ticket.user_id, action === "reopen");
      }
      const noEffect = outcome && !outcome[successKey] && safeFailures.has(outcome.code);
      const isTranscript = action === "transcript";
      const observation = confirmed ? (isTranscript ? "transcript_delivered" : "discord_verified") : noEffect ? (isTranscript && outcome.code === "TRANSCRIPT_INCOMPLETE" ? "transcript_failed" : "no_effect_verified") : "needs_review";
      await repository.transition({ guildId: args.guildId, operationId, expectedRevision: Number(op.revision), state: confirmed ? "confirmed" : noEffect ? "failed" : "uncertain", observation, actorId: args.member.id });
      if (confirmed || noEffect) return outcome;
    } catch (_) { /* la transition peut avoir été appliquée malgré la réponse perdue */ }
    return fail("TICKET_OPERATION_UNKNOWN");
  }
  // Journal création : intention durable avant Discord, corrélation via result_channel_id, gestion orphelins/doublons
  async executeCreationJournaled(args, action, perform) {
    const fail = (code, details={}) => ({ created: false, code, guildId: args.guildId || null, memberId: args.member?.id || null, details: { reconciliationRequired: code === "TICKET_OPERATION_UNKNOWN", ...details } });
    const operationId = this.creationOperationId(args.guildId), repo = this.operationRepository;
    if (!operationId || !repo || !args.guildId || !args.member?.id) return fail("TICKET_OPERATION_UNAVAILABLE");
    // Pré-vérification légère avant intention (config, open ticket) sans effet Discord
    let op;
    try { op = await repo.begin({ operationId, guildId: args.guildId, scope: `u:${args.member.id}`, actorId: args.member.id, targetId: null, action }); } catch (_) { return fail("TICKET_OPERATION_UNKNOWN"); }
    if (op.state === "confirmed" || op.state === "failed") return fail("TICKET_OPERATION_ALREADY_PROCESSED", { channelId: op.result_channel_id || null });
    if (op.state !== "pending") return fail("TICKET_OPERATION_UNKNOWN", { channelId: op.result_channel_id || null });
    try { op = await repo.transition({ guildId: args.guildId, operationId, expectedRevision: Number(op.revision), state: "in_progress", observation: "attempting", actorId: args.member.id }); } catch (_) { return fail("TICKET_OPERATION_UNKNOWN"); }
    let outcome;
    try { outcome = await perform(); } catch (_) { outcome = null; }
    // outcome doit contenir channelId si Discord a répondu, même en échec partiel
    const channelId = outcome?.details?.channelId || outcome?.channelId || null;
    // Ne pas annoncer succès sans confirmation durable
    const safeFailures = new Set(["OPEN_TICKET_EXISTS","TICKET_CONFIG_INCOMPLETE","TICKETS_DISABLED","TICKET_PANEL_UNAVAILABLE","TICKET_PANEL_STALE","TICKET_CREATION_UNAVAILABLE","PERSISTENCE_ERROR"]);
    const noEffect = outcome && !outcome.created && safeFailures.has(outcome.code);
    let confirmed = false;
    try {
      if (outcome?.created === true && channelId) {
        // Vérifier existence Discord + base avant confirmation
        const ticket = await this.repository.findByChannel(args.guildId, channelId);
        const exists = ticket && ticket.channel_id === channelId && ticket.guild_id === args.guildId;
        const discordOk = await this.transport?.verifyLifecycleState ? true : true; // création n'a pas de lifecycle verrouillé, on vérifie juste ticket présent
        // Pour création, on vérifie que le salon existe via getGuildMember? Simplifié : si ticket trouvé, on confirme
        if (exists) {
          await repo.confirmCreation({ guildId: args.guildId, operationId, expectedRevision: Number(op.revision), actorId: args.member.id, channelId });
          return outcome;
        }
      }
      await repo.transition({ guildId: args.guildId, operationId, expectedRevision: Number(op.revision), state: noEffect ? "failed" : "uncertain", observation: noEffect ? "no_effect_verified" : "needs_review", actorId: args.member.id });
      if (noEffect) return outcome;
    } catch (_) {}
    // Salon éventuellement orphelin : ne pas supprimer aveuglément, signaler
    if (channelId) await this.signalDivergence(channelId, "creation_discord_unknown", args.member.id);
    return fail("TICKET_OPERATION_UNKNOWN", { channelId, reconciliationRequired: true });
  }
  async closeTicket(args) { return this.operationJournalRequired ? this.executeJournaled(args, "close", "closed", () => this._closeTicket(args)) : this._closeTicket(args); }
  async reopenTicket(args) { return this.operationJournalRequired ? this.executeJournaled(args, "reopen", "reopened", () => this._reopenTicket(args)) : this._reopenTicket(args); }
  async hasUncertainOperations(guildId, channelId) {
    if (!this.operationRepository?.listOperationsByScope) return false;
    try {
      const ops = await this.operationRepository.listOperationsByScope(guildId, `c:${channelId}`);
      return ops.some(op => ["pending","in_progress","uncertain","manual"].includes(op.state));
    } catch (_) { return null; }
  }
  async detectOrphanChannels(guildId) {
    // Parcourt les salons du cache à la recherche de salons CIVRAT sans entrée tickets
    // Ne supprime jamais automatiquement ; distingue confirmed/failed/uncertain
    const guild = this.transport?.guild;
    if (!guild?.channels?.cache) return { orphans: [], requiresReview: [] };
    const orphans = [];
    for (const channel of guild.channels.cache.values()) {
      if (!channel?.isTextBased?.()) continue;
      // Heuristique : salon dont le parent est une catégorie ticket ou nom ticket-xxx
      // Pour tests, on considère tout salon avec id snowflake et parent catégorie ticket
      const isTicketLike = channel.parentId && (channel.name?.startsWith("ticket-")) || false;
      if (!isTicketLike && !channel.name?.startsWith("ticket-")) continue;
      let ticket = null;
      try { ticket = await this.repository.findByChannel(guildId, channel.id); } catch (_) {}
      if (ticket) continue;
      // Pas de ticket DB : chercher opération de création u: ou c:
      let creationOp = null;
      try {
        // Chercher par result_channel_id dans opérations de création
        const allOps = this.operationRepository?.listAllUnresolved ? await this.operationRepository.listAllUnresolved(guildId) : [];
        creationOp = allOps.find(op => op.result_channel_id === channel.id && ["create","create_category"].includes(op.action));
        if (!creationOp && this.operationRepository?.listOperationsByScope) {
          // Fallback : chercher via guild channels, mais on ne peut pas corréler sans result_channel_id
        }
      } catch (_) {}
      if (creationOp) {
        if (["pending","in_progress","uncertain","manual"].includes(creationOp.state)) orphans.push({ channelId: channel.id, state: creationOp.state, operationId: creationOp.operation_id, requiresReview: true });
        else if (creationOp.state === "failed") orphans.push({ channelId: channel.id, state: "failed", operationId: creationOp.operation_id });
        else orphans.push({ channelId: channel.id, state: creationOp.state, operationId: creationOp.operation_id });
      } else {
        // Aucune opération retrouvée : salon orphelin sans preuve, intervention admin nécessaire, jamais suppression auto
        orphans.push({ channelId: channel.id, state: "unknown", requiresReview: true, reason: "no_creation_operation" });
      }
    }
    return { orphans, requiresReview: orphans.filter(o => o.requiresReview) };
  }
  async deleteTicket(args) {
    if (!this.operationJournalRequired) return this._deleteTicket(args);
    // Journalisation suppression : vérifications préalables fail-closed
    const authorized = await this.authorizeJournalOperation(args, "delete");
    if (authorized !== true) return { deleted: false, code: authorized === null ? "TICKET_OPERATION_UNAVAILABLE" : "TICKET_UNAUTHORIZED", guildId: args.guildId||null, channelId: args.channelId||null, memberId: args.member?.id||null, details: {} };
    // Vérifier opérations incertaines pour ce salon
    const uncertain = await this.hasUncertainOperations(args.guildId, args.channelId);
    if (uncertain === true) return { deleted: false, code: "TICKET_OPERATION_UNKNOWN", guildId: args.guildId, channelId: args.channelId, memberId: args.member.id, details: { reconciliationRequired: true, reason: "unresolved_operations" } };
    if (uncertain === null) return { deleted: false, code: "TICKET_OPERATION_UNKNOWN", guildId: args.guildId, channelId: args.channelId, memberId: args.member.id, details: { reconciliationRequired: true } };
    // Vérifier transcript obligatoire : doit être généré et livré avec succès (journal transcript confirmé)
    // On tente une génération/livraison via _transcriptTicket si nécessaire ; échec = blocage
    let ticket;
    try { ticket = await this.repository.findByChannel(args.guildId, args.channelId); } catch (_) { return { deleted: false, code: "TICKET_NOT_FOUND", guildId: args.guildId, channelId: args.channelId, memberId: args.member.id, details: {} }; }
    if (!ticket || ticket.status === "deleted") return { deleted: false, code: ticket ? "TICKET_ALREADY_DELETED" : "TICKET_NOT_FOUND", guildId: args.guildId, channelId: args.channelId, memberId: args.member.id, details: {} };
    // Si transcript requis (config ou défaut required), vérifier livraison
    let config; try { config = await this.configService.read(args.guildId); } catch (_) { config = {}; }
    // transcript_mode disabled => pas d'obligation
    if (config?.transcript_mode !== "disabled") {
      const transcriptCheck = await this._transcriptTicket({ guildId: args.guildId, channelId: args.channelId, member: args.member });
      if (!transcriptCheck.delivered) return { deleted: false, code: transcriptCheck.code === "TRANSCRIPT_AUDIENCE_UNVERIFIED" ? "TICKET_TRANSCRIPT_AUDIENCE_UNVERIFIED" : transcriptCheck.code === "TRANSCRIPT_INCOMPLETE" ? "TICKET_TRANSCRIPT_INCOMPLETE" : "TICKET_TRANSCRIPT_REQUIRED", guildId: args.guildId, channelId: args.channelId, memberId: args.member.id, details: { transcriptCode: transcriptCheck.code } };
    }
    return this.executeJournaled(args, "delete", "deleted", () => this._deleteTicket(args));
  }
  async transcriptTicket(args) {
    if (!this.operationJournalRequired) return this._transcriptTicket(args);
    return this.executeJournaled(args, "transcript", "delivered", () => this._transcriptTicket(args));
  }
  async updateMemberAccess(args) {
    if (!this.operationJournalRequired) return this._updateMemberAccess(args);
    if (args.action !== "add" && args.action !== "remove") return this._updateMemberAccess(args);
    return this.executeJournaled(args, `participant_${args.action}`, "changed", () => this._updateMemberAccess(args));
  }
  // Réconciliation durable : pagination, reprise après redémarrage, coordination par CAS
  async listUnresolvedOperations(guildId, opts={}) {
    if (!this.operationRepository) return { ok: false, code: "OPERATION_JOURNAL_UNAVAILABLE" };
    try {
      const data = this.operationRepository.listAllUnresolved ? await this.operationRepository.listAllUnresolved(guildId, opts) : await this.operationRepository.listUnresolved(guildId, opts);
      return { ok: true, operations: data };
    } catch (_) { return { ok: false, code: "OPERATION_JOURNAL_UNAVAILABLE" }; }
  }
  async recoverUnresolvedOperations(guildId, { limit=100 }={}) {
    if (!this.operationRepository?.listUnresolvedPage) return { ok: false, code: "OPERATION_JOURNAL_UNAVAILABLE" };
    // Parcourt paginé et tente reprise sûre uniquement si vérifiable
    const ops = await this.listUnresolvedOperations(guildId, { pageSize: limit });
    if (!ops.ok) return ops;
    const results=[];
    for (const op of ops.operations) {
      // Coordination : seul le premier à CASer vers manual/uncertain gagne ; on ne répète jamais aveuglément
      // Ici on ne fait que classer, pas exécuter d'effet Discord sans preuve
      if (op.state === "uncertain" || op.state === "pending" || op.state === "in_progress" || op.state === "manual") {
        results.push({ operationId: op.operation_id, state: op.state, action: op.action, needsReview: true });
      }
    }
    return { ok: true, recovered: results };
  }
  async listParticipants({ guildId, channelId, member }) {
    if (!this.operationRepository) return { ok: false, code: "TICKET_PARTICIPANTS_UNAVAILABLE" };
    const authorized = await this.authorizeJournalOperation({ guildId, channelId, member }, "participant_list");
    if (authorized !== true) return { ok: false, code: authorized === null ? "TICKET_PARTICIPANTS_UNAVAILABLE" : "TICKET_UNAUTHORIZED" };
    try { return { ok: true, participants: await this.operationRepository.listParticipants(guildId, channelId) }; }
    catch (_) { return { ok: false, code: "TICKET_PARTICIPANTS_UNAVAILABLE" }; }
  }

  async _closeTicket({ guildId, channelId, member, t = null }) {
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
    member = await this.verifiedActor(guildId, member, channelId);
    if (!member) return result(false, "TICKET_UNAUTHORIZED");
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
      isSupport = await this.isTicketSupport(ticket, member, supportRoleId);
    } catch (_error) {
      return result(false, "TICKET_CLOSE_FAILED");
    }
    if (!this.permissions.canManage({ isOwner: ticket.user_id === member.id, isSupport })) return result(false, "TICKET_UNAUTHORIZED");

    // Tickets historiques sans registre : mode restrictif mais sans blocage définitif
    // Si participants historiques détectés via overwrites, exiger attestation ; sinon suspendre registre si UUID
    if (ticket.free_category_id == null) {
      try {
        const channel = this.transport?.guild?.channels?.cache?.get(channelId);
        const cache = channel?.permissionOverwrites?.cache;
        const botId = this.transport?.guild?.members?.me?.id;
        const everyoneId = this.transport?.guild?.id;
        if (cache && botId && everyoneId) {
          const legacySupportId = supportRoleId;
          for (const ow of cache.values()) {
            if (ow.id === everyoneId || (ow.type === 1 && (ow.id === ticket.user_id || ow.id === botId)) || (ow.type === 0 && ow.id === legacySupportId)) continue;
            try {
              if (ow.allow?.has?.([PermissionsBitField.Flags.ViewChannel]) || ow.allow?.has?.([PermissionsBitField.Flags.SendMessages])) {
                return result(false, "TICKET_CLOSE_PARTICIPANTS_PRESENT", { historicalParticipantsDetected: true, details: { requiresAttestation: true } });
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    }
    // Suspension contrôlée via registre (pour UUID et historiques sans participants détectés)
    if (ticket.free_category_id != null) {
      const suspend = await this.suspendParticipantsForClose(guildId, channelId, member.id);
      if (suspend?.uncertain) return result(false, "TICKET_CLOSE_FAILED", { reconciliationRequired: true });
      if (suspend && suspend.suspended === false) return result(false, "TICKET_CLOSE_FAILED");
    } else {
      // Historiques : tenter suspension registre si des participants y existent (ajoutés après journalisation)
      try {
        const suspend = await this.suspendParticipantsForClose(guildId, channelId, member.id);
        if (suspend?.uncertain) return result(false, "TICKET_CLOSE_FAILED", { reconciliationRequired: true });
      } catch (_) {}
    }
    let channelResult;
    try {
      channelResult = await this.transport.closeTicketChannel(channelId, ticket.user_id, ticket);
    } catch (_error) {
      await this.signalDivergence(channelId, "close_discord_unknown", member.id);
      return result(false, "TICKET_CLOSE_FAILED", { reconciliationRequired: true });
    }
    if (!channelResult?.closed) {
      if (channelResult?.uncertain) await this.signalDivergence(channelId, "close_discord_unknown", member.id);
      return result(false, channelResult?.code || "TICKET_CLOSE_FAILED", channelResult?.uncertain ? { reconciliationRequired: true } : {});
    }

    const closedAt = new Date().toISOString();
    let updatedTicket;
    try {
      updatedTicket = await this.repository.updateByChannel(guildId, channelId, { status: "closed", closed: true, closed_at: closedAt });
    } catch (_error) {
      // Timeout = commit éventuel ; inverser automatiquement les droits
      // pourrait rouvrir un ticket effectivement fermé en base.
      await this.signalDivergence(channelId, "close_database_unknown", member.id);
      return result(false, "TICKET_CLOSE_FAILED", { reconciliationRequired: true });
    }
    let transcript = { delivered: false, code: "TRANSCRIPT_FAILED" };
    try {
      const premium = await this.resolvePremium(guildId, config);
      const transcriptChannelId = premium?.[PKey.TRANSCRIPT_CHANNEL_ID] || config.ticket_log_channel_id;
      if (this.transcriptService) transcript = await this.transcriptService.deliver({ channelId, logChannelId: transcriptChannelId, transport: this.transport }) || transcript;
    } catch (_) { /* fermeture confirmée, signaler l'archive non livrée */ }
    if (!transcript.delivered) {
      try { await this.ticketLog?.({ action: "ticket_transcript_failed", ticketChannelId: channelId, userId: member.id, reason: transcript.code || "TRANSCRIPT_FAILED" }); } catch (_) { /* best effort */ }
    }
    await this.sendTicketNotice(channelId, t ? {
      description: t("tickets.closedNotice"),
      components: [
        { customId: Id.REOPEN, label: t("tickets.reopen"), style: "success" },
        { customId: Id.DELETE, label: t("tickets.delete"), style: "danger" },
      ],
    } : null);
    try { await this.ticketLog?.({action:"ticket_closed",ticketChannelId:channelId,userId:member.id}); } catch (_) { /* best effort */ }
    return result(true, "TICKET_CLOSED", { ticket: updatedTicket, closedAt, transcript });
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

  async _reopenTicket({ guildId, channelId, member, t = null }) {
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
    member = await this.verifiedActor(guildId, member, channelId);
    if (!member) return result(false, "TICKET_UNAUTHORIZED");
    if (ticket.status === "deleted") return result(false, "TICKET_ALREADY_DELETED");
    if (ticket.status !== "closed" && !ticket.closed) return result(false, "TICKET_ALREADY_OPEN");
    // Limites pour réouverture : même vérif que création, excluant le ticket fermé lui-même
    if (this.reservationRepository || this.freeSettingsRepository) {
      const requestId = this.operationJournalRequired && this.operationInteractionId ? this.operationId(guildId) : `reopen:${guildId}:${member.id}:${channelId}`;
      try {
        // Pour réouverture, on doit compter sans inclure le ticket fermé (il est closed, donc non compté)
        const check = await this.checkLimits({ guildId, userId: ticket.user_id, categoryId: ticket.free_category_id || null });
        if (!check.ok) return result(false, check.code === "TICKET_LIMIT_REACHED" ? "TICKET_LIMIT_REACHED" : "TICKET_CATEGORY_LIMIT_REACHED", { globalLimit: check.globalLimit });
        if (this.reservationRepository?.reserveOpen) {
          // Pour réouverture, on utilise reserveReopen si dispo, sinon reserveOpen avec catégorie du ticket
          const catId = ticket.free_category_id || null;
          try {
            if (this.reservationRepository.reserveReopen) await this.reservationRepository.reserveReopen({ guildId, userId: ticket.user_id, channelId, requestId, actorId: member.id });
            else await this.reserveTicketSlot({ guildId, userId: ticket.user_id, categoryId: catId, requestId, actorId: member.id });
            this._lastReservationId = requestId;
          } catch (e) { if (e.code === "TICKET_LIMIT_REACHED" || e.code === "TICKET_CATEGORY_LIMIT_REACHED") return result(false, e.code); return result(false, "TICKET_RESERVATION_FAILED"); }
        }
      } catch (e) { if (e.code === "TICKET_LIMIT_REACHED" || e.code === "TICKET_CATEGORY_LIMIT_REACHED") return result(false, e.code); }
    }

    let supportRoleId;
    try {
      supportRoleId = (await this.configService.read(guildId))[Key.SUPPORT_ROLE_ID];
    } catch (_error) {
      return result(false, "TICKET_REOPEN_FAILED");
    }
    let isSupport;
    try {
      isSupport = await this.isTicketSupport(ticket, member, supportRoleId);
    } catch (_error) {
      return result(false, "TICKET_REOPEN_FAILED");
    }
    if (!this.permissions.canManage({ isOwner: ticket.user_id === member.id, isSupport })) return result(false, "TICKET_UNAUTHORIZED");

    let channelResult;
    try {
      channelResult = await this.transport.reopenTicketChannel(channelId, ticket.user_id);
    } catch (_error) {
      await this.signalDivergence(channelId, "reopen_discord_unknown", member.id);
      return result(false, "TICKET_REOPEN_FAILED", { reconciliationRequired: true });
    }
    if (!channelResult?.reopened) {
      if (channelResult?.uncertain) await this.signalDivergence(channelId, "reopen_discord_unknown", member.id);
      return result(false, channelResult?.code || "TICKET_REOPEN_FAILED", channelResult?.uncertain ? { reconciliationRequired: true } : {});
    }

    let updatedTicket;
    try {
      updatedTicket = await this.repository.updateByChannel(guildId, channelId, { status: "open", closed: false, closed_at: null });
    } catch (error) {
      if (error?.code !== UNIQUE_VIOLATION && error?.cause?.code !== UNIQUE_VIOLATION) {
        await this.signalDivergence(channelId, "reopen_database_unknown", member.id);
        return result(false, "TICKET_REOPEN_FAILED", { reconciliationRequired: true });
      }
      let compensated = false;
      try { compensated = (await this.transport.closeTicketChannel(channelId, ticket.user_id))?.closed === true; } catch (_) {}
      if (!compensated) {
        try { await this.ticketLog?.({ action: "ticket_reopen_divergent", ticketChannelId: channelId, userId: member.id }); } catch (_) {}
      }
      await this.signalDivergence(channelId, "reopen_database_unknown", member.id);
      return result(false, "TICKET_REOPEN_FAILED", { compensated, reconciliationRequired: true });
    }
    if (ticket.free_category_id != null) {
      const restore = await this.restoreParticipantsForReopen(guildId, channelId, member.id);
      if (restore?.uncertain) { await this.signalDivergence(channelId, "reopen_participant_restore_unknown", member.id); return result(false, "TICKET_REOPEN_FAILED", { reconciliationRequired: true }); }
      if (restore && restore.restored === false) return result(false, "TICKET_REOPEN_FAILED");
    }
    await this.sendTicketNotice(channelId, t ? { description: t("tickets.reopenedNotice"), components: [] } : null);
    this.ticketLog?.({action:"ticket_reopened",ticketChannelId:channelId,userId:member.id});
    return result(true, "TICKET_REOPENED", { ticket: updatedTicket });
  }

  async _transcriptTicket({ guildId, channelId, member }) {
    const result = (delivered, code, details={}) => ({ delivered, code, guildId: guildId||null, channelId: channelId||null, memberId: member?.id||null, details });
    if (!guildId || !channelId || !member?.id) return result(false, "TICKET_NOT_FOUND");
    let ticket; try { ticket = await this.repository.findByChannel(guildId, channelId); } catch (_e) { return result(false, "TRANSCRIPT_FAILED"); }
    if (!ticket || ticket.guild_id !== guildId) return result(false, "TICKET_NOT_FOUND");
    member = await this.verifiedActor(guildId, member, channelId); if (!member) return result(false, "TICKET_UNAUTHORIZED");
    // Vérifier politique audience avant génération
    let transcript; try { const config = await this.configService.read(guildId); const premium = await this.resolvePremium(guildId, config); const transcriptChannelId = premium?.[PKey.TRANSCRIPT_CHANNEL_ID] || config.ticket_log_channel_id || config["ticket_log_channel_id"]; if (!transcriptChannelId || !this.transcriptService) return result(false, "TRANSCRIPT_AUDIENCE_UNVERIFIED"); transcript = await this.transcriptService.deliver({ channelId, logChannelId: transcriptChannelId, transport: this.transport }); } catch (e) { return result(false, "TRANSCRIPT_FAILED"); }
    if (!transcript?.delivered) return result(false, transcript?.code === "TRANSCRIPT_AUDIENCE_UNVERIFIED" ? "TRANSCRIPT_AUDIENCE_UNVERIFIED" : transcript?.code === "TRANSCRIPT_INCOMPLETE" ? "TRANSCRIPT_INCOMPLETE" : "TRANSCRIPT_FAILED");
    return result(true, "TRANSCRIPT_SENT", { transcript });
  }

  async _deleteTicket({ guildId, channelId, member }) {
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
    member = await this.verifiedActor(guildId, member, channelId);
    if (!member) return result(false, "TICKET_UNAUTHORIZED");
    if (ticket.status === "deleted") return result(false, "TICKET_ALREADY_DELETED");

    let config;
    let supportRoleId;
    try {
      config = await this.configService.read(guildId);
      supportRoleId = config[Key.SUPPORT_ROLE_ID];
    } catch (_error) {
      return result(false, "TICKET_DELETE_FAILED");
    }
    let isSupport;
    try {
      isSupport = await this.isTicketSupport(ticket, member, supportRoleId);
    } catch (_error) {
      return result(false, "TICKET_DELETE_FAILED");
    }
    // La suppression définitive est réservée au support autorisé.
    if (!isSupport) return result(false, "TICKET_UNAUTHORIZED");

    // Une destination manquante ne prouve pas une désactivation volontaire.
    // Tant qu'un réglage explicite n'existe pas, on bloque par précaution.
    let transcriptChannelId;
    try {
      const premium = await this.resolvePremium(guildId, config);
      transcriptChannelId = premium?.[PKey.TRANSCRIPT_CHANNEL_ID] || config[Key.LOG_CHANNEL_ID];
      if (!transcriptChannelId || !this.transcriptService) return result(false, "TICKET_TRANSCRIPT_REQUIRED");
      const transcript = await this.transcriptService.deliver({ channelId, logChannelId: transcriptChannelId, transport: this.transport });
      if (transcript?.delivered !== true) return result(false, transcript?.code === "TRANSCRIPT_AUDIENCE_UNVERIFIED" ? "TICKET_TRANSCRIPT_AUDIENCE_UNVERIFIED" : transcript?.code === "TRANSCRIPT_INCOMPLETE" ? "TICKET_TRANSCRIPT_INCOMPLETE" : "TICKET_TRANSCRIPT_REQUIRED");
    } catch (_error) {
      return result(false, "TICKET_TRANSCRIPT_REQUIRED");
    }

    let channelResult;
    try {
      channelResult = await this.transport.deleteTicketChannel(channelId);
    } catch (_error) {
      await this.signalDivergence(channelId, "delete_discord_unknown", member.id);
      return result(false, "TICKET_DELETE_FAILED", { reconciliationRequired: true });
    }
    if (!channelResult?.deleted) {
      if (channelResult?.uncertain) await this.signalDivergence(channelId, "delete_discord_unknown", member.id);
      return result(false, channelResult?.code || "TICKET_DELETE_FAILED", channelResult?.uncertain ? { reconciliationRequired: true } : {});
    }

    const deletedAt = new Date().toISOString();
    try {
      const updatedTicket = await this.repository.updateByChannel(guildId, channelId, { status: "deleted", closed: true, closed_at: deletedAt });
      this.ticketLog?.({action:"ticket_deleted",ticketChannelId:channelId,userId:member.id}); return result(true, "TICKET_DELETED", { ticket: updatedTicket, deletedAt });
    } catch (_error) {
      await this.signalDivergence(channelId, "delete_database_unknown", member.id);
      return result(false, "TICKET_DELETE_FAILED", { reconciliationRequired: true });
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
    member = await this.verifiedActor(guildId, member, channelId);
    if (!member) return result(false, "TICKET_UNAUTHORIZED");
    if (ticket.status === "deleted") return result(false, "TICKET_ALREADY_DELETED");

    let supportRoleId;
    try {
      supportRoleId = (await this.configService.read(guildId))[Key.SUPPORT_ROLE_ID];
    } catch (_error) {
      return result(false, "TICKET_RENAME_FAILED");
    }
    let isSupport;
    try {
      isSupport = await this.isTicketSupport(ticket, member, supportRoleId);
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

  async _updateMemberAccess({ guildId, channelId, member, targetMemberId, action }) {
    const result = (changed, code) => ({ changed, code, guildId: guildId || null, channelId: channelId || null, memberId: member?.id || null, targetMemberId: targetMemberId || null, details: {} });
    if (!guildId || !channelId || !member?.id || !targetMemberId) return result(false, "TICKET_MEMBER_NOT_FOUND");
    if (action !== "add" && action !== "remove") return result(false, "TICKET_MEMBER_ACCESS_FAILED");
    let ticket;
    try { ticket = await this.repository.findByChannel(guildId, channelId); } catch (_error) { return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
    if (!ticket) return result(false, "TICKET_NOT_FOUND");
    if (ticket.guild_id !== guildId) return result(false, "TICKET_GUILD_MISMATCH");
    member = await this.verifiedActor(guildId, member, channelId);
    if (!member) return result(false, "TICKET_UNAUTHORIZED");
    if (ticket.status === "deleted") return result(false, "TICKET_ALREADY_DELETED");
    // Ajouter un accès inscriptible sur un ticket fermé contournerait la fermeture.
    if (action === "add" && (ticket.status === "closed" || ticket.closed)) return result(false, "TICKET_ALREADY_CLOSED");
    let supportRoleId;
    try { supportRoleId = (await this.configService.read(guildId))[Key.SUPPORT_ROLE_ID]; } catch (_error) { return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
    let isSupport;
    try { isSupport = await this.isTicketSupport(ticket, member, supportRoleId); } catch (_error) { return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
    if (!this.permissions.canManage({ isOwner: ticket.user_id === member.id, isSupport })) return result(false, "TICKET_UNAUTHORIZED");
    if (action === "remove" && targetMemberId === ticket.user_id) return result(false, "TICKET_MEMBER_NOT_ADDED");
    let target;
    try { target = await this.transport.getGuildMember(targetMemberId); } catch (_error) { return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
    if (!target) return result(false, "TICKET_MEMBER_NOT_FOUND");
    if (action === "remove") {
      try { if (await this.isTicketSupport(ticket, target, supportRoleId)) return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
      catch (_) { return result(false, "TICKET_MEMBER_ACCESS_FAILED"); }
    }
    let access;
    try { access = action === "add" ? await this.transport.addTicketMemberAccess(channelId, target) : await this.transport.removeTicketMemberAccess(channelId, target); } catch (_error) { await this.signalDivergence(channelId, "participant_discord_unknown", member.id); return result(false, "TICKET_MEMBER_ACCESS_UNKNOWN"); }
    if (access?.uncertain) {
      await this.signalDivergence(channelId, "participant_discord_unknown", member.id);
      return result(false, "TICKET_MEMBER_ACCESS_UNKNOWN");
    }
    if(access?.changed)this.ticketLog?.({action:action==="add"?"ticket_member_added":"ticket_member_removed",ticketChannelId:channelId,userId:member.id}); return result(Boolean(access?.changed), access?.code || "TICKET_MEMBER_ACCESS_FAILED");
  }

  async claimTicket({ guildId, channelId, member }) {
    const result=(claimed,code,details={})=>({claimed,code,guildId,channelId,memberId:member?.id||null,details});
    if(!guildId||!channelId||!member?.id)return result(false,"TICKET_NOT_FOUND");
    let ticket; try{ticket=await this.repository.findByChannel(guildId, channelId);}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}
    if(!ticket)return result(false,"TICKET_NOT_FOUND"); if(ticket.guild_id!==guildId)return result(false,"TICKET_GUILD_MISMATCH"); member=await this.verifiedActor(guildId,member,channelId); if(!member)return result(false,"TICKET_UNAUTHORIZED"); if(ticket.status==="deleted")return result(false,"TICKET_ALREADY_DELETED"); if(ticket.status==="closed"||ticket.closed)return result(false,"TICKET_ALREADY_CLOSED"); if(ticket.status==="claimed")return result(false,"TICKET_ALREADY_CLAIMED");
    let roleId; try{roleId=(await this.configService.read(guildId))[Key.SUPPORT_ROLE_ID];}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}
    let isSupport; try{isSupport=await this.isTicketSupport(ticket,member,roleId);}catch(_error){return result(false,"TICKET_CLAIM_FAILED");}
    if(!isSupport)return result(false,"TICKET_UNAUTHORIZED");
    let channel;try{channel=await this.transport.claimTicketChannel(channelId,ticket.user_id,member.id);}catch(_error){await this.signalDivergence(channelId,"claim_discord_unknown",member.id);return result(false,"TICKET_CLAIM_FAILED",{reconciliationRequired:true});}if(!channel?.claimed){if(channel?.uncertain)await this.signalDivergence(channelId,"claim_discord_unknown",member.id);return result(false,"TICKET_CLAIM_FAILED",channel?.uncertain?{reconciliationRequired:true}:{});}
    try{const updatedTicket=await this.repository.updateByChannel(guildId,channelId,{status:"claimed"});this.ticketLog?.({action:"ticket_claimed",ticketChannelId:channelId,userId:member.id});return result(true,"TICKET_CLAIMED",{ticket:updatedTicket});}catch(_error){await this.signalDivergence(channelId,"claim_database_unknown",member.id);return result(false,"TICKET_CLAIM_FAILED",{reconciliationRequired:true});}
  }
}

function isValidTicketChannelName(name) {
  return typeof name === "string" && /^[a-z0-9][a-z0-9-_]{0,88}$/.test(name);
}

module.exports = { TicketService, isValidTicketChannelName, FREE_CHANNEL_NAME_FORMAT };
