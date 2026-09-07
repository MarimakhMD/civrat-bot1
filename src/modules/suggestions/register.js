"use strict";

const { PermissionName } = require("../../core/permissions");
const { prefix } = require("../../core/interactions/routeMatchers");
const { SuggestionComponentId: Id } = require("./configuration/suggestionConstants");
const { suggestionView } = require("./interactions/suggestionViews");
const { toggleSuggestion, selectSuggestionChannel } = require("./interactions/configureSuggestions");
const { SuggestionService } = require("./services/SuggestionService");
const { SupabaseSuggestionRepository } = require("./persistence/SupabaseSuggestionRepository");
const { DiscordSuggestionTransport } = require("../../adapters/discord/DiscordSuggestionTransport");

function registerSuggestions({ registry, configService, supabase, logsRuntimeFactory, settingsHome = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  const render = async (context) => context.envelope.transport.update({ view: suggestionView({ t: context.t, config: await configService.read(context.guildId) }) });

  registry.registerButton({ customId: Id.SECTION, permissions, execute: render });
  registry.registerButton({
    customId: Id.TOGGLE,
    permissions,
    execute: async (context) => {
      await toggleSuggestion({ service: configService, guildId: context.guildId });
      return render(context);
    },
  });
  registry.registerSelectMenu({
    customId: Id.CHANNEL,
    permissions,
    execute: async (context) => {
      await selectSuggestionChannel({ service: configService, guildId: context.guildId, values: context.envelope.values });
      return render(context);
    },
  });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });

  const suggestCommand = {
    name: "suggest",
    description: "Create a suggestion",
    permissions: null,
    options: [{ type: "string", name: "content", description: "Suggestion content", required: true }],
    execute: async (context) => {
      // Déferrement immédiat : la création fait de l'I/O Supabase avant de
      // répondre (évite l'expiration de l'interaction).
      await context.envelope.transport.deferReply?.({ ephemeral: true });
      const content = context.envelope.options.getString("content");
      const guildId = context.guildId;
      const authorId = context.envelope.discordMember.id;
      const guild = context.envelope.discordMember.guild;
      const repository = new SupabaseSuggestionRepository({ supabase: supabase || context.envelope.supabase });
      const transport = new DiscordSuggestionTransport({ guild });
      const logsRuntime = logsRuntimeFactory ? logsRuntimeFactory() : null;
      const service = new SuggestionService({ configService, repository, transport, logsRuntime });
      const result = await service.create({ guildId, channelId: null, authorId, content });
      const key = result.ok ? "suggestion.created" : result.code === "SUGGESTION_INVALID_CONTENT" ? "suggestion.invalidContent" : result.code === "SUGGESTION_NO_CHANNEL" ? "suggestion.noChannel" : "suggestion.notFound";
      await context.envelope.transport.reply({ view: { title: context.t(key), content: "", components: [] }, ephemeral: true });
      return result;
    },
  };
  registry.registerCommand(suggestCommand);

  const voteUpId = `${Id.VOTE_UP}:`;
  const voteDownId = `${Id.VOTE_DOWN}:`;
  const approveId = `${Id.APPROVE}:`;
  const rejectId = `${Id.REJECT}:`;
  const deleteId = `${Id.DELETE}:`;

  registry.registerButton({
    matcher: prefix(voteUpId),
    permissions: null,
    execute: async (context) => {
      const suggestionId = context.envelope.customId.split(":")[1];
      const guildId = context.guildId;
      const userId = context.envelope.discordMember.id;
      const guild = context.envelope.discordMember.guild;
      const repository = new SupabaseSuggestionRepository({ supabase: supabase || context.envelope.supabase });
      const transport = new DiscordSuggestionTransport({ guild });
      const service = new SuggestionService({ configService, repository, transport });
      // C2 : le message cliqué remplace l'ancien suggestion.message_id.
      const result = await service.vote({ guildId, suggestionId, userId, value: 1, message: context.envelope.message });
      const key = result.ok ? "suggestion.voted" : result.code === "SUGGESTION_ALREADY_VOTED" ? "suggestion.alreadyVoted" : "suggestion.notFound";
      await context.envelope.transport.reply({ view: { title: context.t(key), content: "", components: [] }, ephemeral: true });
      return result;
    },
  });

  registry.registerButton({
    matcher: prefix(voteDownId),
    permissions: null,
    execute: async (context) => {
      const suggestionId = context.envelope.customId.split(":")[1];
      const guildId = context.guildId;
      const userId = context.envelope.discordMember.id;
      const guild = context.envelope.discordMember.guild;
      const repository = new SupabaseSuggestionRepository({ supabase: supabase || context.envelope.supabase });
      const transport = new DiscordSuggestionTransport({ guild });
      const service = new SuggestionService({ configService, repository, transport });
      // C2 : le message cliqué remplace l'ancien suggestion.message_id.
      const result = await service.vote({ guildId, suggestionId, userId, value: -1, message: context.envelope.message });
      const key = result.ok ? "suggestion.voted" : result.code === "SUGGESTION_ALREADY_VOTED" ? "suggestion.alreadyVoted" : "suggestion.notFound";
      await context.envelope.transport.reply({ view: { title: context.t(key), content: "", components: [] }, ephemeral: true });
      return result;
    },
  });

  const staffPerms = { allOf: [PermissionName.MANAGE_GUILD] };
  for (const [action, customId] of [
    ["approve", approveId],
    ["reject", rejectId],
    ["delete", deleteId],
  ]) {
    registry.registerButton({
      matcher: prefix(customId),
      permissions: staffPerms,
      execute: async (context) => {
        const suggestionId = context.envelope.customId.split(":")[1];
        const guildId = context.guildId;
        const actorId = context.envelope.discordMember.id;
        const guild = context.envelope.discordMember.guild;
        const repository = new SupabaseSuggestionRepository({ supabase: supabase || context.envelope.supabase });
        const transport = new DiscordSuggestionTransport({ guild });
        const service = new SuggestionService({ configService, repository, transport });
        // C2 : le message cliqué permet de supprimer/éditer le message réel.
        const result = await service.staffAction({ guildId, suggestionId, action, actorId, message: context.envelope.message });
        const key = result.ok ? `suggestion.${action}d` : "suggestion.notFound";
        // Handle approve/reject/delete key mapping
        const tKey = result.ok ? (action === "approve" ? "suggestion.approved" : action === "reject" ? "suggestion.rejected" : "suggestion.deleted") : "suggestion.notFound";
        await context.envelope.transport.reply({ view: { title: context.t(tKey), content: "", components: [] }, ephemeral: true });
        return result;
      },
    });
  }

  return { commands: [suggestCommand] };
}

module.exports = { registerSuggestions };
