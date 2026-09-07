"use strict";

const { TempVoiceService } = require("../services/TempVoiceService");
const { TempVoiceReconciliationService } = require("../services/TempVoiceReconciliationService");
const { DiscordTempVoiceTransport } = require("../../../adapters/discord/DiscordTempVoiceTransport");
const logger = require("../../../utils/logger");

function createTempVoiceRuntime({ configService, transportFactory, tempChannels, repository, reconciliationServiceFactory, logger: customLogger } = {}) {
  if (!configService || typeof configService.read !== "function") {
    throw new TypeError("createTempVoiceRuntime requires configService");
  }
  const channels = tempChannels instanceof Set ? tempChannels : new Set();
  const repo = repository || null;
  const log = customLogger || logger;
  const makeTransport = typeof transportFactory === "function" ? transportFactory : (guild) => new DiscordTempVoiceTransport({ guild });

  // B5-c — le service de réconciliation est injectable (tests), sinon construit
  // avec le dépôt du runtime (Supabase > InMemory résolu par getTempVoiceRuntime).
  const makeReconcile = typeof reconciliationServiceFactory === "function"
    ? reconciliationServiceFactory
    : (client) => new TempVoiceReconciliationService({ repository: repo, client, logger: log });

  // B5-c — garde contre un double run du cleanup (ready émis deux fois, restart).
  let reconcileStarted = false;

  return Object.freeze({
    handleVoiceStateUpdate: async (oldState, newState) => {
      const guild = (newState && newState.guild) || (oldState && oldState.guild);
      if (!guild) return { handled: false, code: "GUILD_MISSING" };
      const config = await configService.read(guild.id);
      if (!config || !config.tempvoice_enabled) return { handled: false, code: "TEMPVOICE_DISABLED" };
      const newChannelId = newState && newState.channelId ? newState.channelId : null;
      const oldChannelId = oldState && oldState.channelId ? oldState.channelId : null;
      const transport = makeTransport(guild);
      // B5-b — le service reçoit le dépôt durable ET le guildId, pour persister
      // avec un cloisonnement strict par guilde.
      const service = new TempVoiceService({ transport, config, tempChannels: channels, repository: repo, guildId: guild.id });

      // Join lobby → create temp
      if (newChannelId && service.isLobby(newChannelId)) {
        const member = newState.member;
        return service.handleJoin({ member, channelId: newChannelId });
      }
      // Leave temp → delete if empty
      if (oldChannelId && service.isTempChannel(oldChannelId)) {
        return service.handleLeave({ channelId: oldChannelId });
      }
      return { handled: false, code: "NOT_TEMPVOICE" };
    },

    // B5-c — réconciliation au démarrage. Best-effort : ne lève jamais, ne
    // bloque jamais le ready. Réinjecte les salons survivants dans le Set
    // partagé pour que isTempChannel() redevienne vrai après restart.
    reconcileOnStartup: async (client) => {
      if (reconcileStarted) {
        return { handled: false, code: "TEMPVOICE_RECONCILE_ALREADY_RUN" };
      }
      reconcileStarted = true;
      try {
        const service = makeReconcile(client);
        const result = await service.reconcile();
        if (result && Array.isArray(result.survivors)) {
          for (const channelId of result.survivors) {
            if (typeof channelId === "string" && channelId) channels.add(channelId);
          }
        }
        return { handled: true, code: "TEMPVOICE_RECONCILED", result };
      } catch (error) {
        // best-effort : une panne du cleanup n'empêche jamais le démarrage.
        log.warn("tempvoice reconciliation failed at startup", {
          event: "tempvoice_reconcile_failed",
          error: error && error.message ? error.message : String(error),
        });
        return { handled: false, code: "TEMPVOICE_RECONCILE_FAILED", error: error && error.message ? error.message : String(error) };
      }
    },

    _channels: channels,
    _repository: repo,
    _configService: configService,
  });
}

module.exports = { createTempVoiceRuntime };
