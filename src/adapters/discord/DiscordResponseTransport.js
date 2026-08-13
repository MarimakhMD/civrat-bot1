"use strict";
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require("discord.js");
const styles = Object.freeze({ primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger });

// Discord hard limits for message components (V1): at most 5 action rows per
// message, at most 5 buttons per row, exactly 1 select menu per row.
const MAX_ACTION_ROWS = 5;
const MAX_BUTTONS_PER_ROW = 5;

function buildButton(component) {
  return new ButtonBuilder().setCustomId(component.customId).setLabel(component.label).setStyle(styles[component.style] || ButtonStyle.Secondary);
}

function componentToRow(component) {
  if (component.type === "button") return new ActionRowBuilder().addComponents(buildButton(component));
  if (component.type === "role-select") return new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(component.customId).setPlaceholder(component.placeholder).setMinValues(component.minValues || 0).setMaxValues(component.maxValues || 1));
  if (component.type === "channel-select") return new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(component.customId).setPlaceholder(component.placeholder).setChannelTypes((component.channelTypes || [ChannelType.GuildText])));
  if (component.type === "select") return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(component.customId).setPlaceholder(component.placeholder || component.customId).addOptions(component.options));
  throw new Error(`Unsupported view component: ${component.type}`);
}

// Packs consecutive buttons into rows of up to 5 (a select menu always gets its
// own row) and enforces the Discord limit of 5 action rows per message. Failing
// loudly here is intentional: a local error replaces an opaque Discord
// "Invalid Form Body" rejection and pinpoints the offending view.
function toActionRows(components = []) {
  const rows = [];
  let pendingButtons = [];
  const flushButtons = () => {
    while (pendingButtons.length) {
      rows.push(new ActionRowBuilder().addComponents(...pendingButtons.splice(0, MAX_BUTTONS_PER_ROW).map(buildButton)));
    }
    pendingButtons = [];
  };
  for (const component of components) {
    if (component.type === "button") { pendingButtons.push(component); continue; }
    flushButtons();
    rows.push(componentToRow(component));
  }
  flushButtons();
  if (rows.length > MAX_ACTION_ROWS) {
    throw new Error(`Discord views are limited to ${MAX_ACTION_ROWS} action rows per message (got ${rows.length}). Split the view into sub-views.`);
  }
  return rows;
}

function payload(view, ephemeral = true) { return { content: [view.title, view.content].filter(Boolean).join("\n\n"), components: toActionRows(view.components || []), ephemeral }; }

class DiscordResponseTransport {
  constructor(interaction) { this.interaction = interaction; }
  async reply({ view, ephemeral }) { const data = payload(view, ephemeral); if (this.interaction.replied || this.interaction.deferred) return this.interaction.followUp(data); return this.interaction.reply(data); }
  async update({ view }) { const data = payload(view, true); delete data.ephemeral; if (this.interaction.deferred) return this.interaction.editReply(data); if (this.interaction.replied) return this.interaction.editReply(data); return this.interaction.update(data); }
  async replyImagePreview({ image, content, ephemeral }) { const data = { content, files: [{ attachment: image.buffer, name: "welcome-preview.png" }], ephemeral }; if (this.interaction.replied || this.interaction.deferred) return this.interaction.followUp(data); return this.interaction.reply(data); }
  async showModal(modal) { const builder = new ModalBuilder().setCustomId(modal.customId).setTitle(modal.title); for (const field of modal.fields) builder.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(field.id).setLabel(field.label).setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short).setValue(field.value || "").setRequired(field.required))); return this.interaction.showModal(builder); }
  // Ajout Phase 10.2 (aperçu du panneau Tickets Premium) : réponse éphémère
  // rendue en embed, avec les mêmes garanties de packing que payload().
  async replyEmbed({ embed, components = [], ephemeral = true }) { const builder = new EmbedBuilder(); if (embed.title) builder.setTitle(embed.title); if (embed.description) builder.setDescription(embed.description); if (embed.color) builder.setColor(embed.color); if (embed.image) builder.setImage(embed.image); if (Array.isArray(embed.fields) && embed.fields.length) builder.addFields(embed.fields); const data = { embeds: [builder], components: toActionRows(components), ephemeral }; if (this.interaction.replied || this.interaction.deferred) return this.interaction.followUp(data); return this.interaction.reply(data); }
  async sendTestWelcomeDm({ content }) { return this.interaction.user.send({ content }); }
  // Contrat miroir de DiscordWelcomeGoodbyeTransport.sendChannelMessage, adossé
  // à l'interaction : permet aux actions du panneau /settings (ex. « Tester
  // Goodbye ») d'envoyer réellement dans le salon configuré.
  async sendChannelMessage(channelId, payload) { const channel = this.interaction.guild.channels.cache.get(channelId); if (!channel?.isTextBased()) throw new Error("channel_unavailable"); const options = payload.embed ? { embeds: [new EmbedBuilder().setColor(payload.embed.color || "#5865f2").setDescription(payload.embed.description)] } : { content: payload.content }; if (Array.isArray(payload.files) && payload.files.length) options.files = payload.files; return channel.send(options); }
  async sendTestWelcome({ channelId, content, embed }) { const channel = this.interaction.guild.channels.cache.get(channelId); if (!channel?.isTextBased()) throw new Error("welcome_channel_unavailable"); return channel.send(embed ? { embeds: [new EmbedBuilder().setColor(embed.color).setDescription(embed.description)] } : { content }); }
  async replyError({ message, ephemeral }) { const data = { content: message, ephemeral }; if (this.interaction.replied || this.interaction.deferred) return this.interaction.followUp(data); return this.interaction.reply(data); }
}

module.exports = { DiscordResponseTransport, payload, componentToRow, toActionRows, MAX_ACTION_ROWS, MAX_BUTTONS_PER_ROW };
