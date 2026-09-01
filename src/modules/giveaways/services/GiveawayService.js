"use strict";

const ENTRIES_UNAVAILABLE = "GIVEAWAY_ENTRIES_UNAVAILABLE";

class GiveawayService {
  constructor({ configService, repository, transport, logsRuntime }) {
    if (!configService || typeof configService.read !== "function") {
      throw new TypeError("GiveawayService requires a configService");
    }
    if (!repository) throw new TypeError("GiveawayService requires a repository");
    this.configService = configService;
    this.repository = repository;
    this.transport = transport;
    this.logsRuntime = logsRuntime;
  }

  /**
   * Crée un giveaway.
   *
   * @param {string} title  Lot du giveaway. Provient de l'option de commande
   *   `prize`, conservée telle quelle pour ne pas casser l'interface de
   *   /giveaway create ; c'est la colonne réelle `giveaways.title`.
   * @param {string} channelId  Salon de publication = salon où la commande est
   *   exécutée. Il n'existe aucune colonne giveaways_channel_id et aucune ne
   *   doit être créée.
   * @param {number} durationMinutes  Stocké dans `giveaways.duration` (minutes).
   */
  async create({ guildId, channelId, title, winnersCount, durationMinutes }) {
    const config = await this.configService.read(guildId);
    // C1 : nom réel de la colonne guild_configs.
    if (!config.giveaways_enabled) return { ok: false, code: "GIVEAWAY_DISABLED" };
    if (!title || title.trim().length < 2) return { ok: false, code: "GIVEAWAY_INVALID_PRIZE" };
    if (!channelId) return { ok: false, code: "GIVEAWAY_NO_CHANNEL" };

    const minutes = Number.isFinite(durationMinutes) ? durationMinutes : 1440;
    const endsAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    let giveaway;
    try {
      giveaway = await this.repository.create({
        guildId,
        channelId,
        title: title.trim(),
        winnersCount: winnersCount || 1,
        duration: minutes,
        endsAt,
      });
    } catch {
      return { ok: false, code: "GIVEAWAY_CREATE_FAILED" };
    }

    if (this.transport) {
      try {
        await this.transport.sendGiveaway({
          guildId,
          channelId: giveaway.channel_id,
          title: giveaway.title,
          giveawayId: giveaway.id,
          endsAt,
        });
        // C1 : plus aucune écriture de message_id. La colonne n'existe pas, et
        // l'ancien accès direct this.repository.supabase (C5) échouait en
        // silence dans un catch vide. La branche this.repository.updateMessageId
        // était morte : cette méthode n'a jamais existé sur le dépôt.
        // Le bouton Join porte l'id de base, donc rien à stocker.
      } catch {
        // L'échec d'envoi Discord n'annule pas un giveaway déjà persisté.
      }
    }

    if (this.logsRuntime && !this.logsRuntime.disabled) {
      try {
        await this.logsRuntime.handleModerationEvent({ guild: { id: guildId }, action: "giveaway_created", targetId: null });
      } catch {}
    }
    return { ok: true, code: "GIVEAWAY_CREATED", giveaway };
  }

  async join({ guildId, giveawayId, userId }) {
    let giveaway;
    try {
      giveaway = await this.repository.findById(giveawayId);
    } catch {
      return { ok: false, code: "GIVEAWAY_NOT_FOUND" };
    }
    if (!giveaway || giveaway.guild_id !== guildId) return { ok: false, code: "GIVEAWAY_NOT_FOUND" };
    // C1 : garde sur le booléen réel `active`, et non sur status !== "open".
    // La valeur réelle par défaut de status est 'active', jamais 'open' :
    // l'ancienne comparaison était donc toujours vraie et refusait TOUTE
    // participation, y compris sur un giveaway ouvert.
    if (giveaway.active !== true) return { ok: false, code: "GIVEAWAY_CLOSED" };
    try {
      const result = await this.repository.join(giveawayId, userId);
      if (result.alreadyJoined) return { ok: false, code: "GIVEAWAY_ALREADY_JOINED" };
      return { ok: true, code: "GIVEAWAY_JOINED", giveawayId, userId };
    } catch (error) {
      if (error && error.code === ENTRIES_UNAVAILABLE) return { ok: false, code: ENTRIES_UNAVAILABLE };
      return { ok: false, code: "GIVEAWAY_JOIN_FAILED" };
    }
  }

  async draw({ guildId, giveawayId }) {
    let giveaway;
    try {
      giveaway = await this.repository.findById(giveawayId);
    } catch {
      return { ok: false, code: "GIVEAWAY_NOT_FOUND" };
    }
    if (!giveaway || giveaway.guild_id !== guildId) return { ok: false, code: "GIVEAWAY_NOT_FOUND" };

    // C1 — GARDE ANTI-DOUBLE-TIRAGE.
    // Avant C1, draw() ne vérifiait AUCUN état : deux /giveaway draw successifs
    // tiraient deux fois, d'autant que close() était appelé en .catch(() => {})
    // et que son échec restait invisible. `active` est désormais posé à false
    // par close(), ce qui rend la clôture effectivement opposable.
    if (giveaway.active !== true) return { ok: false, code: "GIVEAWAY_CLOSED" };

    try {
      const { winners } = await this.repository.draw(giveawayId);
      await this.repository.close(giveawayId).catch(() => {});
      if (this.transport) {
        try {
          await this.transport.announceWinners({ guildId, channelId: giveaway.channel_id, title: giveaway.title, winners });
        } catch {}
      }
      if (this.logsRuntime && !this.logsRuntime.disabled) {
        try {
          await this.logsRuntime.handleModerationEvent({ guild: { id: guildId }, action: "giveaway_drawn", targetId: null });
        } catch {}
      }
      return { ok: true, code: "GIVEAWAY_DRAWN", winners };
    } catch (error) {
      if (error && error.code === ENTRIES_UNAVAILABLE) return { ok: false, code: ENTRIES_UNAVAILABLE };
      return { ok: false, code: "GIVEAWAY_DRAW_FAILED" };
    }
  }
}

module.exports = { GiveawayService };
