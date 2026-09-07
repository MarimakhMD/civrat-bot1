"use strict";

const { TicketRepository } = require("./TicketRepository");
const { toPersistenceError } = require("../../../adapters/supabase/supabaseErrorClassifier");

// ─────────────────────────────────────────────────────────────────────────
// 4G C5 — projection minimale.
//
// Les deux lectures utilisaient select("*"), qui renvoyait la ligne entière
// (id, category, closed_at, created_at, panel_id…) alors que le code métier ne
// lit que cinq colonnes. Réduire la projection limite ce qui transite et ce
// qu'un log pourrait capturer accidentellement.
//
// Les colonnes ÉCRITES (category, panel_id, closed_at…) ne sont pas concernées :
// une projection ne restreint que le RETURNING, jamais l'INSERT ni l'UPDATE.
// Aucun consommateur ne lit details.ticket (vérifié : 0 lecteur en prod, 0
// assertion de test sur ses champs).
// ─────────────────────────────────────────────────────────────────────────
const TICKET_COLUMNS = "guild_id, user_id, channel_id, status, closed";

class SupabaseTicketRepository extends TicketRepository {
  constructor({ supabase }) { super(); this.supabase = supabase; }

  async findOpen(guildId, userId) {
    const { data, error } = await this.supabase.from("tickets").select(TICKET_COLUMNS).eq("guild_id", guildId).eq("user_id", userId).in("status", ["open", "claimed"]).maybeSingle();
    // 4F-2c — erreur PostgREST classifiée (42501 RLS, 42P01/42703 schéma, réseau).
    if (error) throw toPersistenceError(error, { operation: "findOpen", resource: "tickets" });
    return data;
  }

  // ───────────────────────────────────────────────────────────────────────
  // 4G C2 — lecture scopée par guilde.
  //
  // Avant, seul channel_id filtrait : la requête traversait les guildes et le
  // cloisonnement reposait uniquement sur la vérification
  // `ticket.guild_id !== guildId` effectuée ensuite par TicketService. Les
  // snowflakes Discord étant globalement uniques, l'exploitation pratique était
  // improbable — la faiblesse était structurelle, pas exploitable via Discord.
  //
  // Le filtre est désormais DANS la requête : defense in depth. La garde
  // applicative est conservée, elle n'est pas remplacée.
  //
  // Fail-closed : sans guilde ni salon, on ne requête pas, on renvoie null.
  // ───────────────────────────────────────────────────────────────────────
  async findByChannel(guildId, channelId) {
    if (!guildId || !channelId) return null;
    const { data, error } = await this.supabase.from("tickets").select(TICKET_COLUMNS).eq("guild_id", guildId).eq("channel_id", channelId).maybeSingle();
    // 4F-2c — erreur PostgREST classifiée.
    if (error) throw toPersistenceError(error, { operation: "findByChannel", resource: "tickets" });
    return data;
  }

  async create(record) {
    const { data, error } = await this.supabase.from("tickets").insert(record).select(TICKET_COLUMNS).single();
    // 4F-2c — anti-double-ouverture : le 23505 (index unique partiel
    // idx_tickets_open_unique) DOIT remonter avec son code brut, car
    // TicketService lit `error.code === "23505"` pour répondre
    // OPEN_TICKET_EXISTS et déclencher le rollback `unique_violation`.
    // Toute autre erreur est classifiée (42501 RLS, 42P01/42703 schéma,
    // réseau → BackendUnavailableError).
    if (error?.code === "23505") throw error;
    if (error) throw toPersistenceError(error, { operation: "create", resource: "tickets" });
    return data;
  }

  // ───────────────────────────────────────────────────────────────────────
  // 4G C2 — écriture scopée par guilde.
  //
  // Avant, seul channel_id filtrait l'UPDATE : la requête traversait les
  // guildes. Les quatre appelants de TicketService vérifiaient déjà
  // `ticket.guild_id !== guildId` après lecture, donc l'exploitation pratique
  // exigeait de contourner cette garde — la faiblesse était structurelle.
  //
  // Le filtre est désormais DANS la requête, comme pour findByChannel :
  // defense in depth. Les gardes applicatives de TicketService sont
  // CONSERVÉES, pas remplacées.
  //
  // Fail-closed : sans guilde ni salon, on n'émet AUCUNE requête. On lève
  // une TypeError plutôt que de renvoyer null — un UPDATE qui « réussit »
  // sans rien faire serait pire qu'un échec. Les quatre appelants sont dans
  // un try/catch qui renvoie TICKET_*_FAILED.
  // ───────────────────────────────────────────────────────────────────────
  async updateByChannel(guildId, channelId, updates) {
    if (!guildId || !channelId) {
      throw new TypeError("SupabaseTicketRepository.updateByChannel requires guildId and channelId");
    }
    const { data, error } = await this.supabase.from("tickets").update(updates).eq("guild_id", guildId).eq("channel_id", channelId).select(TICKET_COLUMNS).single();
    // 4F-2c — erreur PostgREST classifiée. Un `.single()` sur 0 ligne (PGRST116,
    // cross-guild) devient PERSISTENCE_FAILED ; le 23505 sur un update reste
    // classifié en PERSISTENCE_CONFLICT (jamais traduit en OPEN_TICKET_EXISTS,
    // conformément au contrat documenté dans TicketService).
    if (error) throw toPersistenceError(error, { operation: "updateByChannel", resource: "tickets" });
    return data;
  }

  async updateTicketRecord(guildId, channelId, updates) { return this.updateByChannel(guildId, channelId, updates); }
}

module.exports = { SupabaseTicketRepository, TICKET_COLUMNS };
