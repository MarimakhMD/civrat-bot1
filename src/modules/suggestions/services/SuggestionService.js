"use strict";

const { SuggestionStatus } = require("../configuration/suggestionConstants");

class SuggestionService {
  constructor({ configService, repository, transport, logsRuntime }) {
    if (!configService || typeof configService.read !== "function") {
      throw new TypeError("SuggestionService requires a configService");
    }
    if (!repository) throw new TypeError("SuggestionService requires a repository");
    this.configService = configService;
    this.repository = repository;
    this.transport = transport;
    this.logsRuntime = logsRuntime;
  }

  async create({ guildId, channelId, authorId, content }) {
    const config = await this.configService.read(guildId);
    // C2 : colonnes réelles de guild_configs (les noms au singulier n'existent
    // pas en base, la lecture renvoyait donc toujours undefined).
    if (!config.suggestions_enabled) return { ok: false, code: "SUGGESTION_DISABLED" };
    if (!content || content.trim().length < 2) return { ok: false, code: "SUGGESTION_INVALID_CONTENT" };
    const targetChannelId = channelId || config.suggestions_channel_id;
    if (!targetChannelId) return { ok: false, code: "SUGGESTION_NO_CHANNEL" };

    let suggestion;
    try {
      // C2 : le dépôt n'accepte plus channelId/messageId — suggestions n'a
      // aucune colonne de ce type.
      suggestion = await this.repository.create({ guildId, userId: authorId, content: content.trim() });
    } catch {
      return { ok: false, code: "SUGGESTION_CREATE_FAILED" };
    }

    if (this.transport) {
      try {
        await this.transport.sendSuggestion({
          guildId,
          channelId: targetChannelId,
          suggestionId: suggestion.id,
          content: suggestion.content,
          authorId,
        });
        // C2 : plus aucune mise à jour de message_id en base. La colonne
        // n'existe pas, et l'ancien accès direct this.repository.supabase
        // (C5) échouait en silence dans un catch vide. Le message n'a pas
        // besoin d'être stocké : les boutons portent l'id de base et
        // l'édition ultérieure se fait sur le message réellement cliqué.
      } catch {
        // L'échec d'envoi Discord n'annule pas une suggestion déjà persistée.
      }
    }

    if (this.logsRuntime && !this.logsRuntime.disabled) {
      try {
        await this.logsRuntime.handleModerationEvent({ guild: { id: guildId }, action: "suggestion_created", targetId: authorId });
      } catch {}
    }
    return { ok: true, code: "SUGGESTION_CREATED", suggestion };
  }

  /**
   * @param {object|null} message Message Discord réellement cliqué, fourni par
   *   l'enveloppe d'interaction. Remplace l'ancien `suggestion.message_id`.
   */
  async vote({ guildId, suggestionId, userId, value, message = null }) {
    let suggestion;
    try {
      suggestion = await this.repository.findById(suggestionId);
    } catch {
      return { ok: false, code: "SUGGESTION_NOT_FOUND" };
    }
    if (!suggestion || suggestion.guild_id !== guildId) return { ok: false, code: "SUGGESTION_NOT_FOUND" };
    if (suggestion.status === SuggestionStatus.DELETED) return { ok: false, code: "SUGGESTION_DELETED" };
    try {
      const result = await this.repository.vote(suggestionId, userId, value);
      if (result.alreadyVoted) return { ok: false, code: "SUGGESTION_ALREADY_VOTED" };
      if (this.transport) {
        try {
          const updated = await this.repository.findById(suggestionId);
          await this.transport.updateSuggestion({ guildId, suggestion: updated, message });
        } catch {}
      }
      return { ok: true, code: "SUGGESTION_VOTED", suggestionId, userId, value };
    } catch (error) {
      // C2 : distinguer « table suggestion_votes absente » (M4 non appliquée)
      // d'un échec réel — l'ancien catch nu renvoyait SUGGESTION_VOTE_FAILED
      // dans les deux cas, ce qui rendait la panne invisible.
      if (error && error.code === "SUGGESTION_VOTES_UNAVAILABLE") {
        return { ok: false, code: "SUGGESTION_VOTES_UNAVAILABLE" };
      }
      return { ok: false, code: "SUGGESTION_VOTE_FAILED" };
    }
  }

  async staffAction({ guildId, suggestionId, action, actorId, message = null }) {
    let suggestion;
    try {
      suggestion = await this.repository.findById(suggestionId);
    } catch {
      return { ok: false, code: "SUGGESTION_NOT_FOUND" };
    }
    if (!suggestion || suggestion.guild_id !== guildId) return { ok: false, code: "SUGGESTION_NOT_FOUND" };
    const statusMap = { approve: SuggestionStatus.APPROVED, reject: SuggestionStatus.REJECTED, delete: SuggestionStatus.DELETED };
    const status = statusMap[action];
    if (!status) return { ok: false, code: "SUGGESTION_INVALID_ACTION" };
    try {
      if (status === SuggestionStatus.DELETED) {
        await this.repository.delete(suggestionId);
        if (this.transport) await this.transport.deleteSuggestion({ guildId, suggestion, message }).catch(() => {});
      } else {
        await this.repository.updateStatus(suggestionId, status);
        if (this.transport) await this.transport.updateSuggestion({ guildId, suggestion: { ...suggestion, status }, message }).catch(() => {});
      }
      if (this.logsRuntime && !this.logsRuntime.disabled) {
        try {
          await this.logsRuntime.handleModerationEvent({ guild: { id: guildId }, action: `suggestion_${action}d`, targetId: actorId });
        } catch {}
      }
      return { ok: true, code: `SUGGESTION_${action.toUpperCase()}D`, suggestionId };
    } catch {
      return { ok: false, code: "SUGGESTION_ACTION_FAILED" };
    }
  }
}

module.exports = { SuggestionService };
