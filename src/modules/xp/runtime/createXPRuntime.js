"use strict";

const { XPService } = require("../services/XPService");
const { LevelService } = require("../services/LevelService");
const { XPLevelRewardService } = require("../services/XPLevelRewardService");
const { InMemoryXPRepository } = require("../persistence/XPRepository");

function createXPRuntime({ configService, repository, levelService, xpService, logsRuntimeFactory, rewardServiceFactory, clock } = {}) {
  if (!configService || typeof configService.read !== "function") {
    throw new TypeError("createXPRuntime requires configService");
  }
  // B3 — le dépôt par défaut partage l'horloge du service : lastXpAt (dépôt)
  // et la garde locale (service) doivent avancer ensemble, sinon les tests à
  // horloge figée valideraient deux lignes de temps différentes.
  const repo = repository || new InMemoryXPRepository({ clock });
  const levels = levelService || new LevelService();
  const service = xpService || new XPService({ repository: repo, levelService: levels, clock });
  const makeLogs = typeof logsRuntimeFactory === "function" ? logsRuntimeFactory : () => null;
  // A3 — le service de récompenses est injectable pour les tests ; par défaut
  // il compose la matrice d'éligibilité et le pipeline d'attribution autorole.
  const makeRewardService = typeof rewardServiceFactory === "function"
    ? rewardServiceFactory
    : () => new XPLevelRewardService();

  return Object.freeze({
    handleMessage: async (message) => {
      if (!message || !message.guild || !message.author) return { handled: false, code: "XP_IGNORED" };
      const guildId = message.guild.id;
      const userId = message.author.id;
      const isBot = Boolean(message.author.bot);
      const config = await configService.read(guildId);
      if (!config || !config.xp_enabled) return { handled: false, code: "XP_DISABLED" };
      // A2 (DCA4) — le filtre « restreindre l'XP à un salon » est supprimé.
      // Il s'appuyait sur la colonne xp_channel_id, qui n'existe pas en base :
      // le réglage n'a jamais pu être persisté et échouait en
      // PERSISTENCE_SCHEMA_MISMATCH. Aucune colonne n'est créée pour le
      // remplacer, et aucun comportement fantôme n'est conservé.
      const result = await service.handleMessage({ guildId, userId, isBot, config });
      if (result.leveledUp) {
        const logs = makeLogs();
        if (logs && !logs.disabled) {
          try {
            await logs.handleModerationEvent({
              guild: message.guild,
              action: "xp_level_up",
              targetId: userId,
              reason: `Leveled up to ${result.level}`,
              rule: "XP_LEVEL_UP",
              rules: ["XP_LEVEL_UP"],
            });
          } catch {}
        }

        // ── A3 — attribution des rôles de récompense ──
        // Décision 9 : toutes les récompenses dont le niveau est dans
        // ]previousLevel, level] sont attribuées, ce qui couvre le saut
        // multi-niveaux. Décision 11 : grant() ne lève jamais et n'annule
        // jamais le gain — le try/catch est un filet supplémentaire, car ce
        // bloc s'exécute APRÈS que l'XP a été acquise en base.
        //
        // `message.member` est toujours peuplé par discord.js pour un message
        // de guilde ; le garde-fou évite de lever sur un double de test ou un
        // message partiel, et laisse alors le résultat inchangé.
        if (message.member) {
          try {
            result.rewardOutcome = await makeRewardService().grant({
              guild: message.guild,
              member: message.member,
              previousLevel: result.previousLevel,
              level: result.level,
              config,
            });
          } catch {
            /* une récompense ne doit jamais casser le traitement du message */
          }
        }
      }
      return result;
    },
    _service: service,
    _repository: repo,
  });
}

module.exports = { createXPRuntime };
