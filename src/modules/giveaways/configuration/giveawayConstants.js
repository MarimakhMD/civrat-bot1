"use strict";

// C1 — Clé de configuration alignée sur le schéma Supabase réel.
//
// La colonne réelle de guild_configs est « giveaways_enabled » (pluriel).
// L'ancien nom « giveaway_enabled » n'existe pas en base :
//   • service.update() envoyait une colonne inconnue, donc PostgREST REJETAIT
//     l'upsert guild_configs ENTIER — le toggle /settings ne persistait jamais
//     et faisait échouer au passage les réglages des autres modules écrits
//     dans le même appel ;
//   • GiveawayService lisait config.giveaway_enabled, toujours undefined, donc
//     /giveaway create répondait GIVEAWAY_DISABLED même une fois activé.
//
// CHANNEL_ID a été SUPPRIMÉ : il n'existe aucune colonne giveaways_channel_id
// et aucune ne doit être créée. Le salon de publication est celui où la
// commande /giveaway create est exécutée (décision validée). Le sélecteur de
// salon a donc disparu de l'écran de réglages.
const GiveawayConfigKey = Object.freeze({
  ENABLED: "giveaways_enabled",
});

const GiveawayComponentId = Object.freeze({
  SECTION: "civrat:v1:giveaway:section",
  TOGGLE: "civrat:v1:giveaway:toggle",
  BACK: "civrat:v1:giveaway:back",
  JOIN: "giveaway_join",
});

const GIVEAWAY_DEFAULTS = Object.freeze({
  giveaways_enabled: false,
});

module.exports = { GiveawayConfigKey, GiveawayComponentId, GIVEAWAY_DEFAULTS };
