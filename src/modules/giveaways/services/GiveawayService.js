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

  /**
   * Tire les gagnants et clôture le giveaway.
   *
   * ORDRE DES OPÉRATIONS — M5, anti-double-tirage.
   *
   *   1. lecture du giveaway + garde sur `active` ;
   *   2. tirage au sort ;
   *   3. closeIfActive() : update conditionnel `.eq("active", true)` ;
   *   4. annonce UNIQUEMENT si la clôture a réellement eu lieu.
   *
   * Pourquoi tirer AVANT de clôturer : l'inverse (clôturer puis tirer) laisserait
   * un giveaway définitivement clos et sans gagnants si le tirage échouait —
   * état irrécupérable, puisque tout draw suivant serait refusé par la garde.
   * Ici, un échec du tirage laisse le giveaway ouvert et réessayable.
   *
   * Pourquoi annoncer APRÈS la clôture : deux /giveaway draw concurrents tirent
   * tous les deux, mais un seul obtient une ligne de closeIfActive(). L'autre
   * reçoit false, renvoie GIVEAWAY_CLOSED et n'annonce rien. Exactement un
   * gagnant est annoncé, sans RPC ni verrou applicatif.
   *
   * L'échec de clôture n'est plus jamais avalé : l'ancien
   * `close(id).catch(() => {})` laissait active à true en silence, donc le
   * giveaway restait tirable indéfiniment.
   *
   * @returns gagnants, total exact de participations, et drapeau de troncature.
   *   Si `entriesTruncated` est true, `entriesTotal` est un PLANCHER : le
   *   plafond de 50 000 a été atteint et le tirage est signalé comme partiel.
   */
  async draw({ guildId, giveawayId }) {
    let giveaway;
    try {
      giveaway = await this.repository.findById(giveawayId);
    } catch {
      return { ok: false, code: "GIVEAWAY_NOT_FOUND" };
    }
    if (!giveaway || giveaway.guild_id !== guildId) return { ok: false, code: "GIVEAWAY_NOT_FOUND" };

    // C1 — GARDE ANTI-DOUBLE-TIRAGE (lecture). La vraie atomicité vient de
    // closeIfActive() plus bas : cette garde évite seulement un tirage inutile
    // sur un giveaway manifestement déjà clos.
    if (giveaway.active !== true) return { ok: false, code: "GIVEAWAY_CLOSED" };

    let drawn;
    try {
      drawn = await this.repository.draw(giveawayId, { winnersCount: giveaway.winners_count });
    } catch (error) {
      if (error && error.code === ENTRIES_UNAVAILABLE) return { ok: false, code: ENTRIES_UNAVAILABLE };
      return { ok: false, code: "GIVEAWAY_DRAW_FAILED" };
    }

    // Décision K4 : 0 participant n'est pas un tirage réussi. L'ancien code
    // renvoyait GIVEAWAY_DRAWN avec une liste vide, puis close() : le message
    // annonçait « Gagnants : » sans personne, et le giveaway était clos.
    // Il reste ici OUVERT, pour que des membres puissent encore participer.
    if (!drawn.winners.length) {
      return { ok: false, code: "GIVEAWAY_NO_PARTICIPANTS", entriesTotal: drawn.entriesTotal };
    }

    let closed;
    try {
      closed = await this.repository.closeIfActive(giveawayId);
    } catch (error) {
      // Échec RÉEL de clôture : propagé en échec, jamais avalé. Le giveaway
      // reste ouvert et le tirage peut être relancé.
      return { ok: false, code: "GIVEAWAY_DRAW_FAILED" };
    }
    // Un draw concurrent (ou une clôture manuelle) a gagné la course.
    if (!closed) return { ok: false, code: "GIVEAWAY_CLOSED" };

    if (this.transport) {
      try {
        await this.transport.announceWinners({ guildId, channelId: giveaway.channel_id, title: giveaway.title, winners: drawn.winners });
      } catch {
        // L'annonce Discord a échoué mais le tirage est persisté et le giveaway
        // clos : les gagnants sont renvoyés au modérateur dans la réponse.
      }
    }

    if (this.logsRuntime && !this.logsRuntime.disabled) {
      try {
        await this.logsRuntime.handleModerationEvent({ guild: { id: guildId }, action: "giveaway_drawn", targetId: null });
      } catch {}
    }
    return {
      ok: true,
      code: "GIVEAWAY_DRAWN",
      winners: drawn.winners,
      entriesTotal: drawn.entriesTotal,
      entriesTruncated: drawn.truncated === true,
    };
  }
}

module.exports = { GiveawayService };
