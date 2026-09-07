"use strict";

const { TicketRepository } = require("./TicketRepository");

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
    if (error) throw error;
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
    if (error) throw error;
    return data;
  }

  async create(record) {
    const { data, error } = await this.supabase.from("tickets").insert(record).select(TICKET_COLUMNS).single();
    if (error) throw error;
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
    if (error) throw error;
    return data;
  }

  async updateTicketRecord(guildId, channelId, updates) { return this.updateByChannel(guildId, channelId, updates); }
}

module.exports = { SupabaseTicketRepository, TICKET_COLUMNS };
