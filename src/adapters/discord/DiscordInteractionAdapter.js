"use strict";
const { InteractionKind } = require("../../core/interactions");
const { createDiscordMemberCapability } = require("./DiscordMemberCapability");
const { DiscordResponseTransport } = require("./DiscordResponseTransport");
class DiscordInteractionAdapter {
  constructor({ router, registry }) { this.router = router; this.registry = registry; }
  async tryHandle(interaction) { const envelope = this.normalize(interaction); if (!envelope || !this.registry.find(envelope)) return false; await this.router.handle(envelope); return true; }
  normalize(interaction) {
    const kind = interaction.isChatInputCommand?.() ? InteractionKind.COMMAND : interaction.isAutocomplete?.() ? InteractionKind.AUTOCOMPLETE : interaction.isButton?.() ? InteractionKind.BUTTON : (interaction.isStringSelectMenu?.() || interaction.isChannelSelectMenu?.() || interaction.isRoleSelectMenu?.()) ? InteractionKind.SELECT_MENU : interaction.isModalSubmit?.() ? InteractionKind.MODAL : null;
    if (!kind) return null;
    return { kind, name: interaction.commandName || null, customId: interaction.customId || null, options: interaction.options || null, values: interaction.values || [], modalValues: kind === InteractionKind.MODAL ? Object.fromEntries(interaction.fields?.fields?.map((field) => [field.customId, field.value]) || []) : {}, guildId: interaction.guildId || null, userId: interaction.user?.id || null, member: createDiscordMemberCapability(interaction.member, interaction.guild?.ownerId), discordMember: interaction.member, discordChannel: interaction.channel, discordClient: interaction.client, transport: new DiscordResponseTransport(interaction) };
  }
}
module.exports = { DiscordInteractionAdapter };
