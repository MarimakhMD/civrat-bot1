"use strict";

/**
 * Arrivée d'un membre : Welcome en salon PUIS Welcome en DM.
 *
 * PHASE 2 (B1) — ISOLATION SALON / DM.
 *
 * L'ancienne version enchaînait les deux `await` sans protection :
 * `WelcomeDeliveryService` lève sur tout échec de salon, donc le DM n'était
 * JAMAIS tenté. Un simple `welcome_channel_id` absent (Welcome activé sans salon
 * choisi) suffisait à faire perdre le DM, sans aucune trace côté utilisateur.
 *
 * Chaque livraison est désormais tentée indépendamment. Les échecs sont
 * collectés puis remontés ensemble : l'observabilité existante (le `catch` du
 * runtime) est conservée, et un échec ne peut plus en masquer un autre.
 *
 * PHASE 2 (B10) — les bots ne reçoivent ni Welcome ni DM.
 *
 * @param {object} deps
 * @param {object} deps.member contexte membre (sortie de `adaptGuildMember`)
 * @param {object} [deps.config] configuration déjà lue par le runtime
 * @param {object} deps.service service de configuration
 * @param {object} deps.delivery `WelcomeDeliveryService`
 * @param {object} deps.transport transport Discord
 */
async function handleMemberAdded({ member, config, service, delivery, transport }) {
  if (member && member.isBot === true) return null;

  const resolved = config !== undefined && config !== null ? config : await service.get(member.guildId);
  const failures = [];

  try {
    await delivery.welcome(member, resolved, transport);
  } catch (error) {
    failures.push(error);
  }

  // Toujours tenté : le DM ne dépend pas du salon.
  try {
    await delivery.dm(member, resolved, transport);
  } catch (error) {
    failures.push(error);
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, `Welcome delivery failed on ${failures.length} targets`);
  }
  return null;
}

module.exports = { handleMemberAdded };
