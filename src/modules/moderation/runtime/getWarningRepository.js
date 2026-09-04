"use strict";

const { InMemoryWarningRepository } = require("../persistence/WarningRepository");

let repository;

/**
 * B1 — Résolution du dépôt de warnings.
 *
 * Chaîne : Supabase (durable) > InMemory (dégradé).
 *
 * AUCUN repli Mongo : le dépôt ne possède que deux modèles Mongoose, UserXP et
 * InviteStats. Il n'existe aucun modèle de warning et B1 n'en crée pas — un
 * double stockage incohérent serait pire qu'un mode dégradé assumé.
 *
 * Supabase exige le client PRIVILÉGIÉ : la RLS de public.warnings n'accorde
 * rien à anon/authenticated. supabaseAdmin vaut null si
 * SUPABASE_SERVICE_ROLE_KEY est absent (src/config/database.js), ce qui est
 * exactement le signal « ne pas tenter d'écrire ».
 */
function getWarningRepository() {
  if (!repository) {
    try {
      const { supabaseAdmin } = require("../../../config/database");
      if (supabaseAdmin && typeof supabaseAdmin.from === "function") {
        const { SupabaseWarningRepository } = require("../persistence/SupabaseWarningRepository");
        repository = new SupabaseWarningRepository({ supabase: supabaseAdmin });
        return repository;
      }
    } catch {
      repository = null;
    }
    // Mode dégradé : les warnings sont perdus au redémarrage. Ce n'est pas le
    // comportement nominal, mais un avertissement doit rester possible hors
    // ligne plutôt que d'échouer silencieusement.
    repository = new InMemoryWarningRepository();
  }
  return repository;
}

/** Réservé aux tests. */
function _resetForTests() {
  repository = null;
}

module.exports = { getWarningRepository, _resetForTests };
