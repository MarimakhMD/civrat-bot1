"use strict";

const { InMemoryInviteStatsRepository } = require("../persistence/InviteStatsRepository");

let repository;

/**
 * B2 — Résolution du dépôt d'invitations.
 *
 * Chaîne : Supabase (durable) > InMemory (dégradé).
 *
 * AUCUN repli Mongo, conformément à la décision B2. `MongoInviteStatsRepository`
 * reste présent dans persistence/InviteStatsRepository.js — il n'est pas
 * supprimé dans cette étape — mais il n'est référencé nulle part : avant B2 il
 * était déjà `require`d sans jamais être instancié, donc l'activer maintenant
 * créerait un second stockage divergent au lieu de corriger quoi que ce soit.
 *
 * Supabase exige le client PRIVILÉGIÉ : la RLS de public.invite_links n'accorde
 * rien à anon/authenticated. supabaseAdmin vaut null si la clé de service est
 * absente (src/config/database.js), ce qui est exactement le signal
 * « ne pas tenter d'écrire ».
 */
function getInviteRepository() {
  if (!repository) {
    try {
      const { supabaseAdmin } = require("../../../config/database");
      if (supabaseAdmin && typeof supabaseAdmin.from === "function") {
        const { SupabaseInviteStatsRepository } = require("../persistence/SupabaseInviteStatsRepository");
        repository = new SupabaseInviteStatsRepository({ supabase: supabaseAdmin });
        return repository;
      }
    } catch {
      repository = null;
    }
    // Mode dégradé : les invitations sont perdues au redémarrage. Ce n'est pas
    // le comportement nominal, mais un join doit rester attribuable hors ligne
    // plutôt que d'échouer silencieusement.
    repository = new InMemoryInviteStatsRepository();
  }
  return repository;
}

/** Réservé aux tests. */
function _resetForTests() {
  repository = null;
}

module.exports = { getInviteRepository, _resetForTests };
