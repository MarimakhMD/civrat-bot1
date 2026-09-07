"use strict";

const { InMemoryTicketPanelRepository } = require("../persistence/TicketPanelRepository");

let repository;

/**
 * M8 — Résolution du dépôt de panels de tickets.
 *
 * Chaîne : Supabase (durable) > InMemory (dégradé).
 *
 * AUCUN repli Mongo : il n'y a jamais eu de modèle mongoose pour les panels
 * (0 occurrence de `require("mongoose")` dans src/modules/tickets), et en
 * inventer un créerait un second stockage divergent.
 *
 * ⚠️ Supabase exige le client PRIVILÉGIÉ (supabaseAdmin) : la RLS de
 *    public.ticket_panels n'accorde rien à anon/authenticated, et un client
 *    anon échouerait en 42501 sur chaque écriture. C'est une divergence
 *    VOLONTAIRE avec le reste du module tickets, qui utilise le client non
 *    privilégié `supabase` parce que public.tickets porte encore la policy
 *    `public / ALL` (corrigée en 4G, pas en M8).
 *
 * supabaseAdmin vaut null si la clé de service est absente
 * (src/config/database.js) — c'est exactement le signal « ne pas tenter
 * d'écrire ».
 */
function getTicketPanelRepository() {
  if (!repository) {
    try {
      const { supabaseAdmin } = require("../../../config/database");
      if (supabaseAdmin && typeof supabaseAdmin.from === "function") {
        const { SupabaseTicketPanelRepository } = require("../persistence/SupabaseTicketPanelRepository");
        repository = new SupabaseTicketPanelRepository({ supabase: supabaseAdmin });
        return repository;
      }
    } catch {
      repository = null;
    }
    // Mode dégradé : les panels sont perdus au redémarrage. Ce n'est pas le
    // comportement nominal, mais /ticketpanel doit rester utilisable hors ligne
    // plutôt que d'échouer silencieusement.
    repository = new InMemoryTicketPanelRepository();
  }
  return repository;
}

/** Réservé aux tests. */
function _resetForTests() {
  repository = null;
}

module.exports = { getTicketPanelRepository, _resetForTests };
