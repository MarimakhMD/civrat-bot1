"use strict";

const { InviteService } = require("../modules/invites/services/InviteService");
const { getInviteRepository } = require("../modules/invites/runtime/getInviteRepository");

// B2 — Chaîne de résolution Supabase (durable) > InMemory (dégradé), décidée
// une seule fois au chargement.
//
// L'ancien bloc `try { require(...MongoInviteStatsRepository...) } catch {}`
// est remplacé, et non simplement effacé : il ne faisait RIEN de la classe
// requise, et son commentaire annonçait un repli vers Mongo
// était faux — `new MongoInviteStatsRepository` n'apparaissait nulle part dans
// le dépôt. Les invitations restaient donc en mémoire quelle que soit la
// configuration, et étaient perdues à chaque redémarrage.
//
// La classe MongoInviteStatsRepository elle-même est CONSERVÉE dans
// persistence/InviteStatsRepository.js : B2 ne la supprime pas, elle cesse
// seulement d'être référencée — comme elle l'était déjà en pratique.
const statsRepository = getInviteRepository();

const inviteService = new InviteService({ statsRepository });

module.exports = inviteService;
module.exports.InviteService = InviteService;
module.exports.statsRepository = statsRepository;
