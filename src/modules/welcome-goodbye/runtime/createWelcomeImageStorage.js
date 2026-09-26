"use strict";

const { WelcomeImageStore } = require("../services/WelcomeImageStore");
const { WelcomeResourceCache } = require("../rendering/WelcomeResourceCache");

/**
 * Composition du stockage d'images Welcome personnalisées.
 *
 * Une fabrique, pas un singleton : chaque composition (livraison et panneau
 * d'administration) reçoit ses propres instances, ce qui garde les tests
 * isolés. Le cache dupliqué est négligeable devant le coût d'un rendu.
 *
 * Le client Supabase est requis de façon LAZY et enveloppé : sans variables
 * d'environnement (tests hors ligne, installation partielle), `storage` vaut
 * null et `WelcomeImageStore` applique son fail-closed — la livraison retombe
 * alors sur le template standard, jamais d'exception propagée.
 *
 * `supabaseAdmin` est préféré : le bucket est PRIVÉ, donc la clé anon serait
 * bloquée par la RLS. Quand SUPABASE_SERVICE_ROLE_KEY est définie, `supabase`
 * et `supabaseAdmin` sont de toute façon le même objet privilégié.
 */
function createWelcomeImageStorage({ logger = null } = {}) {
  let storage = null;
  try {
    const { supabaseAdmin, supabase } = require("../../../config/database");
    const client = supabaseAdmin || supabase;
    storage = client?.storage || null;
  } catch {
    storage = null;
  }

  return {
    imageStore: new WelcomeImageStore({ storage, logger }),
    resourceCache: new WelcomeResourceCache(),
  };
}

module.exports = { createWelcomeImageStorage };
