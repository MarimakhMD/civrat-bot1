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
    if (!config.suggestion_enabled) return { ok: false, code: "SUGGESTION_DISABLED" };
    if (!content || content.trim().length < 2) return { ok: false, code: "SUGGESTION_INVALID_CONTENT" };
    const targetChannelId = channelId || config.suggestion_channel_id;
    if (!targetChannelId) return { ok: false, code: "SUGGESTION_NO_CHANNEL" };
    let suggestion;
    try {
      suggestion = await this.repository.create({ guildId, channelId: targetChannelId, messageId: null, authorId, content: content.trim() });
    } catch {
      return { ok: false, code: "SUGGESTION_CREATE_FAILED" };
    }
    if (this.transport) {
      try {
        const msg = await this.transport.sendSuggestion({ guildId, channelId: targetChannelId, suggestionId: suggestion.id, content: suggestion.content, authorId });
        // Update message_id best-effort
        if (msg && msg.id) {
          try {
            await this.repository.supabase.from("suggestions").update({ message_id: msg.id }).eq("id", suggestion.id);
            suggestion.message_id = msg.id;
          } catch {}
        }
      } catch {}
    }
    if (this.logsRuntime && !this.logsRuntime.disabled) {
      try {
        await this.logsRuntime.handleModerationEvent({ guild: { id: guildId }, action: "suggestion_created", targetId: authorId });
      } catch {}
    }
    return { ok: true, code: "SUGGESTION_CREATED", suggestion };
  }

  async vote({ guildId, suggestionId, userId, value }) {
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
          await this.transport.updateSuggestion({ guildId, suggestion: updated });
        } catch {}
      }
      return { ok: true, code: "SUGGESTION_VOTED", suggestionId, userId, value };
    } catch {
      return { ok: false, code: "SUGGESTION_VOTE_FAILED" };
    }
  }

  async staffAction({ guildId, suggestionId, action, actorId }) {
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
        if (this.transport) await this.transport.deleteSuggestion({ guildId, suggestion }).catch(() => {});
      } else {
        await this.repository.updateStatus(suggestionId, status);
        if (this.transport) await this.transport.updateSuggestion({ guildId, suggestion: { ...suggestion, status } }).catch(() => {});
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
