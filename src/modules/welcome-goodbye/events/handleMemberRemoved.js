"use strict";

/**
 * Départ d'un membre : Goodbye en salon.
 *
 * PHASE 2 (B10) — les bots ne reçoivent pas de Goodbye. Un membre partiel
 * (`user === null`) n'est pas identifiable comme bot : il est traité
 * normalement, sans rien inventer.
 *
 * @param {object} deps
 * @param {object} deps.member contexte membre (sortie de `adaptGuildMember`)
 * @param {object} [deps.config] configuration déjà lue par le runtime
 */
async function handleMemberRemoved({ member, config, service, delivery, transport }) {
  if (member && member.isBot === true) return null;
  const resolved = config !== undefined && config !== null ? config : await service.get(member.guildId);
  return delivery.goodbye(member, resolved, transport);
}

module.exports = { handleMemberRemoved };
