"use strict";

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const {
  InteractionAlreadyAcknowledgedError,
} = require("../../core/errors");
const {
  DiscordErrorCategory,
  classifyDiscordError,
  toCivratError,
} = require("./discordErrorClassifier");

const MAX_ACTION_ROWS = 5;
const MAX_BUTTONS_PER_ROW = 5;
const MAX_COMPONENTS_PER_ROW = MAX_BUTTONS_PER_ROW;

const AcknowledgementState = Object.freeze({
  PENDING: "pending",
  DEFERRED_REPLY: "deferredReply",
  DEFERRED_UPDATE: "deferredUpdate",
  REPLIED: "replied",
  MODAL: "modal",
});

const style = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  link: ButtonStyle.Link,
};

function normalizeComponentType(type) {
  if (type === "select" || type === "stringSelect" || type === "string-select") return "stringSelect";
  if (type === "channelSelect" || type === "channel-select") return "channelSelect";
  if (type === "roleSelect" || type === "role-select") return "roleSelect";
  return type;
}

function component(value) {
  const type = normalizeComponentType(value.type);
  if (type === "button") {
    const button = new ButtonBuilder()
      .setLabel(value.label)
      .setStyle(style[value.style] || ButtonStyle.Secondary)
      .setDisabled(Boolean(value.disabled));
    if (value.url) button.setURL(value.url);
    else button.setCustomId(value.customId);
    if (value.emoji) button.setEmoji(value.emoji);
    return button;
  }
  if (type === "stringSelect") {
    return new StringSelectMenuBuilder()
      .setCustomId(value.customId)
      .setPlaceholder(value.placeholder || value.customId || "Select")
      .setMinValues(value.minValues ?? 1)
      .setMaxValues(value.maxValues ?? 1)
      .setOptions((value.options || []).map((option) => ({
        label: option.label,
        value: option.value,
        description: option.description,
        emoji: option.emoji,
        default: Boolean(option.default),
      })));
  }
  if (type === "channelSelect") {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(value.customId)
      .setPlaceholder(value.placeholder || value.customId || "Select")
      .setMinValues(value.minValues ?? 0)
      .setMaxValues(value.maxValues ?? 1);
    select.setChannelTypes(value.channelTypes?.length ? value.channelTypes : [ChannelType.GuildText]);
    return select;
  }
  if (type === "roleSelect") {
    return new RoleSelectMenuBuilder()
      .setCustomId(value.customId)
      .setPlaceholder(value.placeholder || value.customId || "Select")
      .setMinValues(value.minValues ?? 0)
      .setMaxValues(value.maxValues ?? 1);
  }
  throw new TypeError(`Unsupported view component: ${value.type}`);
}

function componentToRow(value) {
  return new ActionRowBuilder().addComponents(component(value));
}

function rows(components = []) {
  const result = [];
  let pendingButtons = [];
  const flushButtons = () => {
    while (pendingButtons.length) {
      result.push(new ActionRowBuilder().addComponents(
        ...pendingButtons.splice(0, MAX_BUTTONS_PER_ROW).map(component)
      ));
    }
    pendingButtons = [];
  };

  for (const value of components) {
    if (normalizeComponentType(value.type) === "button") {
      pendingButtons.push(value);
      continue;
    }
    flushButtons();
    result.push(componentToRow(value));
  }
  flushButtons();

  if (result.length > MAX_ACTION_ROWS) {
    throw new Error(
      `Discord views are limited to ${MAX_ACTION_ROWS} action rows per message (got ${result.length}). Split the view into sub-views.`
    );
  }
  return result;
}

function renderView(view) {
  const data = {};
  if (view.title) data.content = view.content ? `${view.title}\n\n${view.content}` : view.title;
  else if (view.content) data.content = view.content;
  if (view.embed) {
    const embed = new EmbedBuilder().setTitle(view.embed.title || view.title || "CIVRAT");
    if (view.embed.description || view.content) embed.setDescription(view.embed.description || view.content);
    if (view.embed.color) embed.setColor(view.embed.color);
    if (view.embed.image) embed.setImage(view.embed.image);
    if (Array.isArray(view.embed.fields) && view.embed.fields.length) embed.addFields(view.embed.fields);
    data.embeds = [embed];
  }
  data.components = rows(view.components || []);
  return data;
}

function payload(view, ephemeral = true) {
  return { ...renderView(view), ephemeral };
}

function withoutEphemeral(data) {
  const copy = { ...data };
  delete copy.ephemeral;
  return copy;
}

function inferInitialState(interaction) {
  if (interaction?.replied) return AcknowledgementState.REPLIED;
  if (!interaction?.deferred) return AcknowledgementState.PENDING;
  const isComponent = interaction.isMessageComponent?.()
    || interaction.isButton?.()
    || interaction.isAnySelectMenu?.();
  return isComponent ? AcknowledgementState.DEFERRED_UPDATE : AcknowledgementState.DEFERRED_REPLY;
}

class DiscordResponseTransport {
  constructor(interaction) {
    if (!interaction) throw new TypeError("DiscordResponseTransport requires an interaction");
    this.interaction = interaction;
    this.state = inferInitialState(interaction);
    this.queue = Promise.resolve();
  }

  supports(method) {
    return typeof this.interaction?.[method] === "function";
  }

  isAcknowledged() {
    this.syncState();
    return this.state !== AcknowledgementState.PENDING;
  }

  acknowledgementState() {
    this.syncState();
    return this.state;
  }

  deferReply(options = { ephemeral: true }) {
    return this.enqueue(async () => {
      this.syncState();
      if (this.state !== AcknowledgementState.PENDING) return this.reusedAcknowledgement();
      if (!this.supports("deferReply")) return this.unsupportedAcknowledgement();
      try {
        const result = await this.invoke("deferReply", options, "deferReply");
        this.state = AcknowledgementState.DEFERRED_REPLY;
        return result;
      } catch (error) {
        return this.handleConcurrentAcknowledgement(error);
      }
    });
  }

  deferUpdate() {
    return this.enqueue(async () => {
      this.syncState();
      if (this.state !== AcknowledgementState.PENDING) return this.reusedAcknowledgement();
      if (!this.supports("deferUpdate")) return this.unsupportedAcknowledgement();
      try {
        const result = await this.invoke("deferUpdate", undefined, "deferUpdate");
        this.state = AcknowledgementState.DEFERRED_UPDATE;
        return result;
      } catch (error) {
        return this.handleConcurrentAcknowledgement(error);
      }
    });
  }

  reply({ view, ephemeral = true }) {
    return this.enqueue(() => this.sendReply(payload(view, ephemeral), "reply"));
  }

  update({ view }) {
    return this.enqueue(() => this.sendUpdate(renderView(view)));
  }

  replyError({ message }) {
    return this.enqueue(() => this.sendReply({ content: message, ephemeral: true }, "replyError"));
  }

  replyImagePreview({ image = null, buffer = null, filename = null, title = null, content = "", ephemeral = true }) {
    const attachment = buffer || image?.buffer || image;
    const file = new AttachmentBuilder(attachment, { name: filename || image?.filename || "welcome-preview.png" });
    const text = [title, content].filter(Boolean).join("\n\n");
    return this.enqueue(() => this.sendReply({ content: text, files: [file], ephemeral }, "replyImagePreview"));
  }

  replyEmbed({ embed = {}, components = [], ephemeral = true }) {
    const builder = new EmbedBuilder();
    if (embed.title) builder.setTitle(embed.title);
    if (embed.description) builder.setDescription(embed.description);
    if (embed.color) builder.setColor(embed.color);
    if (embed.image) builder.setImage(embed.image);
    if (Array.isArray(embed.fields) && embed.fields.length) builder.addFields(embed.fields);
    return this.enqueue(() => this.sendReply({ embeds: [builder], components: rows(components), ephemeral }, "replyEmbed"));
  }

  showModal({ customId, title, fields = [] }) {
    return this.enqueue(async () => {
      this.syncState();
      if (this.state !== AcknowledgementState.PENDING) {
        throw new InteractionAlreadyAcknowledgedError({ operation: "showModal", resource: "discord_interaction" });
      }

      const modal = new ModalBuilder().setCustomId(customId).setTitle(String(title).slice(0, 45));
      modal.addComponents(fields.slice(0, MAX_ACTION_ROWS).map((field) => {
        const input = new TextInputBuilder()
          .setCustomId(field.id)
          .setLabel(String(field.label).slice(0, 45))
          .setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(field.required !== false);
        if (field.value) input.setValue(String(field.value).slice(0, 4000));
        if (field.placeholder) input.setPlaceholder(String(field.placeholder).slice(0, 100));
        return new ActionRowBuilder().addComponents(input);
      }));

      try {
        const result = await this.invoke("showModal", modal, "showModal");
        this.state = AcknowledgementState.MODAL;
        return result;
      } catch (error) {
        const classified = classifyDiscordError(error?.cause || error);
        if (
          error instanceof InteractionAlreadyAcknowledgedError
          || classified.category === DiscordErrorCategory.INTERACTION_ALREADY_ACKNOWLEDGED
        ) {
          this.state = AcknowledgementState.REPLIED;
        }
        throw toCivratError(error, { operation: "showModal", resource: "discord_interaction" });
      }
    });
  }

  async sendTestWelcomeDm({ content }) {
    return this.interaction.user.send({ content });
  }

  async sendTestWelcome({ channelId, content, embed }) {
    const channel = this.interaction.guild?.channels?.cache?.get(channelId);
    if (!channel?.isTextBased?.()) throw new Error("welcome_channel_unavailable");
    if (!embed) return channel.send({ content });
    const builder = new EmbedBuilder().setDescription(embed.description || content);
    if (embed.color) builder.setColor(embed.color);
    return channel.send({ embeds: [builder] });
  }

  async sendChannelMessage(channelId, { content, embed, files = [] }) {
    const channel = this.interaction.guild?.channels?.cache?.get(channelId);
    if (!channel?.isTextBased?.()) throw new Error("channel_unavailable");
    const message = {};
    if (embed) {
      const builder = new EmbedBuilder().setDescription(embed.description || content || "");
      builder.setColor(embed.color || "#5865F2");
      message.embeds = [builder];
    } else {
      message.content = content;
    }
    if (files.length) message.files = files;
    return channel.send(message);
  }

  enqueue(task) {
    const execution = this.queue.then(task, task);
    this.queue = execution.then(() => undefined, () => undefined);
    return execution;
  }

  syncState() {
    if (this.state !== AcknowledgementState.PENDING) return;
    if (this.interaction.replied) {
      this.state = AcknowledgementState.REPLIED;
      return;
    }
    if (this.interaction.deferred) this.state = inferInitialState(this.interaction);
  }

  async sendReply(data, operation) {
    this.syncState();

    if (this.state === AcknowledgementState.PENDING) {
      try {
        const result = await this.invoke("reply", data, operation);
        this.state = AcknowledgementState.REPLIED;
        return result;
      } catch (error) {
        const classified = classifyDiscordError(error?.cause || error);
        if (
          !(error instanceof InteractionAlreadyAcknowledgedError)
          && classified.category !== DiscordErrorCategory.INTERACTION_ALREADY_ACKNOWLEDGED
        ) throw error;
        this.state = AcknowledgementState.REPLIED;
        return this.invoke("followUp", data, `${operation}.followUp`);
      }
    }

    if (this.state === AcknowledgementState.DEFERRED_REPLY) {
      if (this.supports("editReply")) {
        const result = await this.invoke("editReply", withoutEphemeral(data), `${operation}.editReply`);
        this.state = AcknowledgementState.REPLIED;
        return result;
      }
      const result = await this.invoke("followUp", data, `${operation}.followUp`);
      this.state = AcknowledgementState.REPLIED;
      return result;
    }

    return this.invoke("followUp", data, `${operation}.followUp`);
  }

  async sendUpdate(data) {
    this.syncState();

    if (this.state === AcknowledgementState.PENDING) {
      try {
        const result = await this.invoke("update", data, "update");
        this.state = AcknowledgementState.REPLIED;
        return result;
      } catch (error) {
        const classified = classifyDiscordError(error?.cause || error);
        if (
          !(error instanceof InteractionAlreadyAcknowledgedError)
          && classified.category !== DiscordErrorCategory.INTERACTION_ALREADY_ACKNOWLEDGED
        ) throw error;
        this.state = AcknowledgementState.REPLIED;
        return this.invoke("editReply", data, "update.editReply");
      }
    }

    const result = await this.invoke("editReply", data, "update.editReply");
    this.state = AcknowledgementState.REPLIED;
    return result;
  }

  async invoke(method, argument, operation) {
    if (!this.supports(method)) {
      throw new TypeError(`Discord interaction does not support ${method}`);
    }
    try {
      return argument === undefined
        ? await this.interaction[method]()
        : await this.interaction[method](argument);
    } catch (error) {
      throw toCivratError(error, { operation, resource: "discord_interaction" });
    }
  }

  handleConcurrentAcknowledgement(error) {
    const classified = classifyDiscordError(error?.cause || error);
    if (
      error instanceof InteractionAlreadyAcknowledgedError
      || classified.category === DiscordErrorCategory.INTERACTION_ALREADY_ACKNOWLEDGED
    ) {
      this.state = AcknowledgementState.REPLIED;
      return this.reusedAcknowledgement();
    }
    throw error;
  }

  reusedAcknowledgement() {
    return Object.freeze({ acknowledged: true, reused: true, state: this.state });
  }

  unsupportedAcknowledgement() {
    return Object.freeze({ acknowledged: false, unsupported: true, state: this.state });
  }
}

module.exports = {
  DiscordResponseTransport,
  AcknowledgementState,
  payload,
  renderView,
  rows,
  componentToRow,
  toActionRows: rows,
  MAX_ACTION_ROWS,
  MAX_BUTTONS_PER_ROW,
  MAX_COMPONENTS_PER_ROW,
};
