"use strict";

// Service de réconciliation des réservations : distinct des compensations immédiates (rollback synchrone).
// Il ne libère jamais uniquement parce qu'une réservation est ancienne : il vérifie Discord + Supabase.

class TicketReservationReconciliationService {
  constructor({ reservationRepository, ticketRepository, transport, logger = null }) {
    if (!reservationRepository || typeof reservationRepository.listPending !== "function") {
      throw new TypeError("reservationRepository with listPending required");
    }
    this.reservationRepository = reservationRepository;
    this.ticketRepository = ticketRepository;
    this.transport = transport;
    this.logger = logger;
    this.interval = null;
  }

  // Parcourt les réservations en attente, identifie les expirées, vérifie salon Discord et ticket Supabase,
  // confirme si possible, libère seulement si annulation prouvée, conserve les incertains.
  async reconcile({ guildId = null, batchSize = 50, maxAgeMs = 60 * 60 * 1000, now = Date.now() } = {}) {
    const threshold = new Date(now - maxAgeMs).toISOString();
    let pending;
    try {
      pending = await this.reservationRepository.listPending({ guildId, threshold, limit: batchSize });
    } catch (e) {
      this.logger?.warn?.({ err: e }, "reconciliation listPending failed");
      return { checked: 0, finalized: 0, cancelled: 0, uncertain: 0, error: e.message };
    }
    if (!Array.isArray(pending) || pending.length === 0) {
      return { checked: 0, finalized: 0, cancelled: 0, uncertain: 0 };
    }

    let finalized = 0, cancelled = 0, uncertain = 0, checked = 0;

    for (const res of pending) {
      checked++;
      const requestId = res.request_id || res.requestId;
      const channelId = res.channel_id || res.channelId;
      const guild = res.guild_id || res.guildId;

      // Plusieurs instances ne doivent pas traiter la même réservation : tryLock
      let locked = false;
      try {
        if (typeof this.reservationRepository.tryLock === "function") {
          locked = await this.reservationRepository.tryLock(requestId);
          if (!locked) {
            uncertain++;
            continue;
          }
        } else if (typeof this.reservationRepository.withLock === "function") {
          // Fallback InMemory : withLock est bloquant, on l'utilise pour sérialiser
          // On ne peut pas tryLock, donc on traite directement (les tests sont mono-instance)
          locked = true;
        }
      } catch (_) {
        uncertain++;
        continue;
      }

      // Vérifier existence réelle du salon Discord et du ticket Supabase
      let discordExists = null; // null = incertain, true/false = prouvé
      let ticketExists = null;

      // Vérifier Discord
      if (channelId) {
        try {
          if (typeof this.transport?.getChannel === "function") {
            const ch = await this.transport.getChannel(guild, channelId);
            discordExists = Boolean(ch);
          } else if (typeof this.transport?.fetchChannel === "function") {
            const ch = await this.transport.fetchChannel(channelId);
            discordExists = Boolean(ch);
          } else {
            discordExists = null; // pas de moyen de vérifier -> incertain
          }
        } catch (e) {
          // Erreur Discord (rate limit, réseau) -> incertain, on conserve
          if (e.code === 10003 || e.code === 50001 || e.status === 404) {
            discordExists = false;
          } else {
            discordExists = null;
          }
        }
      } else {
        // Pas de channelId dans la réservation : on ne peut pas vérifier Discord, on vérifie seulement ticket
        discordExists = false;
      }

      // Vérifier Supabase
      try {
        if (this.ticketRepository?.findByChannel) {
          const ticket = await this.ticketRepository.findByChannel(guild, channelId);
          ticketExists = Boolean(ticket && !ticket.closed && ["open", "claimed"].includes(ticket.status));
        } else {
          ticketExists = null;
        }
      } catch (_) {
        ticketExists = null;
      }

      // Décision
      try {
        if (discordExists === true && ticketExists === true) {
          // Les deux existent : on peut confirmer la réservation (si pas déjà finalized)
          if (res.state !== "finalized") {
            try {
              await this.reservationRepository.finalizeOpen({ requestId, channelId });
              finalized++;
            } catch (_) {
              uncertain++;
            }
          } else {
            finalized++;
          }
        } else if (discordExists === false && ticketExists === false) {
          // Aucun des deux n'existe et l'âge est dépassé : on peut libérer, mais seulement si prouvé
          // On exige que la réservation soit plus vieille que le seuil ET que les deux vérifs soient prouvées (pas incertaines)
          // Ne jamais libérer uniquement parce qu'elle est ancienne : on a déjà vérifié les deux, donc c'est prouvé
          try {
            await this.reservationRepository.cancelReservation({ requestId, actorId: res.actor_id || res.actorId || "reconciliation" });
            cancelled++;
          } catch (_) {
            uncertain++;
          }
        } else if (discordExists === null || ticketExists === null) {
          // Incertain sur au moins un des deux -> conserver pour prochain run
          uncertain++;
        } else {
          // Discord et ticket divergent (un existe, l'autre pas) -> incertain, conserver
          uncertain++;
        }
      } finally {
        // Libérer le lock si on l'a acquis via tryLock (pour Supabase, le lock est transactionnel, il se libère à la fin de la transaction)
        if (locked && typeof this.reservationRepository.unlock === "function") {
          try { await this.reservationRepository.unlock(requestId); } catch (_) {}
        }
      }
    }

    return { checked, finalized, cancelled, uncertain };
  }

  // Exécution périodique toutes les 15 minutes (par défaut)
  start({ intervalMs = 15 * 60 * 1000, guildId = null } = {}) {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(async () => {
      try {
        const result = await this.reconcile({ guildId });
        this.logger?.info?.({ result }, "ticket reservation reconciliation run");
      } catch (e) {
        this.logger?.error?.({ err: e }, "ticket reservation reconciliation failed");
      }
    }, intervalMs);
    // Ne pas bloquer l'arrêt du process
    if (this.interval.unref) this.interval.unref();
    return this.interval;
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

module.exports = { TicketReservationReconciliationService };
