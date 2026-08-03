const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, ChannelType, ModalBuilder, AttachmentBuilder,
  TextInputBuilder, TextInputStyle, PermissionsBitField,
} = require("discord.js");
const commandHandler = require("../handlers/commandHandler");
const guildConfigService = require("../services/guildConfig");
const { supabase } = require("../config/database");
const logger = require("../utils/logger");
const giveawayService = require("../services/giveawayService");
const suggestionService = require("../services/suggestionService");
const captchaService = require("../services/captchaService");

const TICKET_TOPIC_PREFIX = "civrat-ticket:";

module.exports = {
  name: "interactionCreate",
  once: false,
  async execute(interaction) {
    if (interaction.isChatInputCommand()) return commandHandler.handleCommand(interaction);
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "ticket_create") return handleTicketCreate(interaction);
      if (interaction.customId === "ticket_options") return handleTicketOption(interaction);
    }
    if (interaction.isButton()) {
    if (interaction.customId === "captcha_verify") return captchaService.verify(interaction);
    if (interaction.customId.startsWith("giveaway_join:")) return giveawayService.joinGiveaway(interaction, Number(interaction.customId.split(":")[1]));
    if (interaction.customId.startsWith("suggestion_")) { const [, action, id] = interaction.customId.split(":")[0].split("_").concat(interaction.customId.split(":")[1]); if (action === "up") return suggestionService.vote(interaction, Number(id), 1); if (action === "down") return suggestionService.vote(interaction, Number(id), -1); return suggestionService.staffAction(interaction, Number(id), action); }
    return handleTicketButton(interaction);
  }
    if (interaction.isModalSubmit()) return handleTicketModal(interaction);
  },
};

async function handleTicketCreate(interaction) {
  try {
    const config = await guildConfigService.getGuildConfig(interaction.guild.id);
    if (!config.tickets_enabled) return interaction.reply({ content: "❌ Le système de tickets est désactivé.", ephemeral: true });
    if (!config.ticket_category_id || !config.ticket_support_role_id) return interaction.reply({ content: "❌ Le système de tickets n’est pas entièrement configuré.", ephemeral: true });

    const category = interaction.guild.channels.cache.get(config.ticket_category_id);
    const supportRole = interaction.guild.roles.cache.get(config.ticket_support_role_id);
    if (!category || category.type !== ChannelType.GuildCategory || !supportRole) {
      return interaction.reply({ content: "❌ La catégorie ou le rôle support configuré est introuvable.", ephemeral: true });
    }

    const existing = await findOpenTicket(interaction.guild, interaction.user.id, category.id);
    if (existing) return interaction.reply({ content: `❌ Vous avez déjà un ticket ouvert : ${existing}`, ephemeral: true });

    const number = await nextTicketNumber(interaction.guild.id);
    const topic = ticketTopic(interaction.user.id);
    const channel = await interaction.guild.channels.create({
      name: `ticket-${String(number).padStart(4, "0")}`,
      type: ChannelType.GuildText,
      parent: category.id,
      topic,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: supportRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      ],
    });

    await createTicketRecord({ guildId: interaction.guild.id, userId: interaction.user.id, channelId: channel.id, category: interaction.values[0] || "support" });
    const controls = ticketControls(false);
    const embed = new EmbedBuilder()
      .setColor(config.ticket_panel_color)
      .setTitle("🎫 Nouveau ticket")
      .setDescription(`Bonjour ${interaction.user}, l’équipe ${supportRole} va vous répondre dès que possible.\n\nUtilisez le menu ci-dessous pour gérer ce ticket.`)
      .addFields({ name: "Numéro", value: `#${number}`, inline: true }, { name: "Catégorie", value: interaction.values[0] || "support", inline: true })
      .setTimestamp();
    await channel.send({ content: `${interaction.user} ${supportRole}`, embeds: [embed], components: controls });
    await sendTicketLog(interaction.guild, config, "Création", `🎫 Ticket créé par ${interaction.user} : ${channel}`);
    return interaction.reply({ content: `✅ Ticket créé : ${channel}`, ephemeral: true });
  } catch (error) {
    logger.error("Ticket creation failed:", error);
    if (interaction.replied || interaction.deferred) return interaction.followUp({ content: "❌ Erreur lors de la création du ticket.", ephemeral: true });
    return interaction.reply({ content: "❌ Erreur lors de la création du ticket.", ephemeral: true });
  }
}

async function handleTicketOption(interaction) {
  const action = interaction.values[0];
  if (action === "close") return closeTicket(interaction);
  if (action === "claim") return claimTicket(interaction);
  if (action === "rename") return openRenameModal(interaction);
  if (action === "add_user") return openMemberModal(interaction, "add");
  if (action === "remove_user") return openMemberModal(interaction, "remove");
}

async function handleTicketButton(interaction) {
  if (interaction.customId === "ticket_reopen") return reopenTicket(interaction);
  if (interaction.customId === "ticket_delete") return deleteTicket(interaction);
}

async function handleTicketModal(interaction) {
  if (interaction.customId === "ticket_rename") {
    if (!(await requireStaff(interaction))) return;
    const name = sanitizeChannelName(interaction.fields.getTextInputValue("ticket_name"));
    if (!name) return interaction.reply({ content: "❌ Nom de ticket invalide.", ephemeral: true });
    await interaction.channel.setName(name, `Ticket renommé par ${interaction.user.tag}`);
    await ticketActionLog(interaction, "Renommage", `✏️ ${interaction.user} a renommé le ticket en ${interaction.channel}`);
    return interaction.reply({ content: "✅ Ticket renommé.", ephemeral: true });
  }
  const add = interaction.customId === "ticket_add_user";
  if (!add && interaction.customId !== "ticket_remove_user") return;
  if (!(await requireStaff(interaction))) return;
  const userId = interaction.fields.getTextInputValue("member_id").trim();
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) return interaction.reply({ content: "❌ Membre introuvable dans ce serveur.", ephemeral: true });
  const meta = ticketMeta(interaction.channel);
  if (member.id === meta.ownerId) return interaction.reply({ content: "❌ Le propriétaire du ticket conserve toujours son accès.", ephemeral: true });
  await interaction.channel.permissionOverwrites.edit(member.id, add ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } : { ViewChannel: null, SendMessages: null, ReadMessageHistory: null });
  await ticketActionLog(interaction, add ? "Ajout membre" : "Retrait membre", `${add ? "➕" : "➖"} ${interaction.user} a ${add ? "ajouté" : "retiré"} ${member} du ticket.`);
  return interaction.reply({ content: `✅ Accès ${add ? "ajouté pour" : "retiré à"} ${member}.`, ephemeral: true });
}

async function closeTicket(interaction) {
  const meta = ticketMeta(interaction.channel);
  if (!(await canManageTicket(interaction, meta.ownerId))) return;
  await interaction.channel.permissionOverwrites.edit(meta.ownerId, { SendMessages: false });
  await updateTicketRecord(interaction.channel.id, { status: "closed", closed: true, closed_at: new Date().toISOString() });
  await sendTranscript(interaction.channel, interaction.guild, await guildConfigService.getGuildConfig(interaction.guild.id));
  await interaction.channel.send({ content: `🔒 Ticket fermé par ${interaction.user}. Seul le staff peut désormais le gérer.`, components: ticketControls(true) });
  await ticketActionLog(interaction, "Fermeture", `🔒 ${interaction.user} a fermé ${interaction.channel}.`);
  return interaction.reply({ content: "✅ Ticket fermé.", ephemeral: true });
}

async function reopenTicket(interaction) {
  if (!(await requireStaff(interaction))) return;
  const meta = ticketMeta(interaction.channel);
  if (!meta.ownerId) return interaction.reply({ content: "❌ Ce salon n’est pas un ticket CIVRAT valide.", ephemeral: true });
  await interaction.channel.permissionOverwrites.edit(meta.ownerId, { SendMessages: true });
  await updateTicketRecord(interaction.channel.id, { status: "open", closed: false, closed_at: null });
  await interaction.channel.send(`🔓 Ticket réouvert par ${interaction.user}.`);
  await ticketActionLog(interaction, "Réouverture", `🔓 ${interaction.user} a réouvert ${interaction.channel}.`);
  return interaction.reply({ content: "✅ Ticket réouvert.", ephemeral: true });
}

async function deleteTicket(interaction) {
  if (!(await requireStaff(interaction))) return;
  const channel = interaction.channel;
  await interaction.reply({ content: "🗑️ Suppression du ticket dans 5 secondes…", ephemeral: true });
  await ticketActionLog(interaction, "Suppression", `🗑️ ${interaction.user} a supprimé le ticket #${channel.name}.`);
  await updateTicketRecord(channel.id, { status: "deleted", closed: true, closed_at: new Date().toISOString() });
  setTimeout(() => channel.delete(`Ticket supprimé par ${interaction.user.tag}`).catch((error) => logger.error("Ticket delete failed:", error.message)), 5000);
}

async function claimTicket(interaction) {
  if (!(await requireStaff(interaction))) return;
  const meta = ticketMeta(interaction.channel);
  if (!meta.ownerId) return interaction.reply({ content: "❌ Ce salon n’est pas un ticket CIVRAT valide.", ephemeral: true });
  await interaction.channel.setTopic(ticketTopic(meta.ownerId, interaction.user.id));
  await ticketActionLog(interaction, "Claim", `🙋 ${interaction.user} a pris en charge ${interaction.channel}.`);
  return interaction.reply({ content: "✅ Ticket pris en charge.", ephemeral: true });
}

function ticketControls(closed) {
  if (closed) return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_reopen").setLabel("Réouvrir").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("ticket_delete").setLabel("Supprimer").setStyle(ButtonStyle.Danger),
  )];
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("ticket_options").setPlaceholder("Gérer le ticket…").addOptions(
    { label: "Fermer", value: "close", emoji: "🔒" }, { label: "Prendre en charge", value: "claim", emoji: "🙋" },
    { label: "Renommer", value: "rename", emoji: "✏️" }, { label: "Ajouter un membre", value: "add_user", emoji: "➕" }, { label: "Retirer un membre", value: "remove_user", emoji: "➖" },
  ))];
}

function openRenameModal(interaction) {
  const modal = new ModalBuilder().setCustomId("ticket_rename").setTitle("Renommer le ticket").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("ticket_name").setLabel("Nouveau nom").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(90)));
  return interaction.showModal(modal);
}
function openMemberModal(interaction, action) {
  const modal = new ModalBuilder().setCustomId(`ticket_${action}_user`).setTitle(action === "add" ? "Ajouter un membre" : "Retirer un membre").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("member_id").setLabel("ID Discord du membre").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(17).setMaxLength(20)));
  return interaction.showModal(modal);
}

function ticketTopic(ownerId, claimedBy = "") { return `${TICKET_TOPIC_PREFIX}${ownerId}${claimedBy ? `:${claimedBy}` : ""}`; }
function ticketMeta(channel) { const [, ownerId = "", claimedBy = ""] = (channel.topic || "").split(":"); return { ownerId, claimedBy }; }
function sanitizeChannelName(value) { return value.toLowerCase().trim().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90); }

async function requireStaff(interaction) {
  const config = await guildConfigService.getGuildConfig(interaction.guild.id);
  const member = interaction.member;
  const authorized = member.permissions.has(PermissionsBitField.Flags.ManageChannels) || member.permissions.has(PermissionsBitField.Flags.Administrator) || Boolean(config.ticket_support_role_id && member.roles.cache.has(config.ticket_support_role_id));
  if (!authorized) await interaction.reply({ content: "❌ Cette action est réservée à l’équipe support.", ephemeral: true });
  return authorized;
}
async function canManageTicket(interaction, ownerId) {
  if (interaction.user.id === ownerId) return true;
  return requireStaff(interaction);
}
async function ticketActionLog(interaction, action, description) { const config = await guildConfigService.getGuildConfig(interaction.guild.id); return sendTicketLog(interaction.guild, config, action, description); }
async function sendTicketLog(guild, config, action, description) {
  if (!config.ticket_log_channel_id) return;
  const channel = guild.channels.cache.get(config.ticket_log_channel_id);
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ embeds: [new EmbedBuilder().setColor("#5865F2").setTitle(`🎫 Ticket · ${action}`).setDescription(description).setTimestamp()] }).catch((error) => logger.error("Ticket log failed:", error.message));
}
async function sendTranscript(ticketChannel, guild, config) {
  if (!config.ticket_log_channel_id) return;
  const logChannel = guild.channels.cache.get(config.ticket_log_channel_id);
  if (!logChannel || !logChannel.isTextBased()) return;
  try {
    const messages = await ticketChannel.messages.fetch({ limit: 100 });
    const content = [...messages.values()].reverse().map((message) => {
      const stamp = message.createdAt.toISOString();
      return `[${stamp}] ${message.author.tag}: ${message.content || "[pièce jointe / embed]"}`;
    }).join("\n");
    const transcript = new AttachmentBuilder(Buffer.from(content || "Aucun message dans ce ticket.", "utf8"), { name: `transcript-${ticketChannel.id}.txt` });
    await logChannel.send({ content: `📄 Transcript de ${ticketChannel} (100 derniers messages maximum).`, files: [transcript] });
  } catch (error) {
    logger.error("Ticket transcript failed:", error.message);
  }
}

async function findOpenTicket(guild, userId, categoryId) {
  if (supabase) {
    const { data } = await supabase.from("tickets").select("channel_id").eq("guild_id", guild.id).eq("user_id", userId).in("status", ["open", "claimed"]).maybeSingle();
    if (data?.channel_id) { const channel = guild.channels.cache.get(data.channel_id); if (channel) return channel; }
  }
  return guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.parentId === categoryId && ticketMeta(channel).ownerId === userId);
}
async function nextTicketNumber(guildId) {
  if (!supabase) return Date.now() % 10000;
  const { count } = await supabase.from("tickets").select("id", { count: "exact", head: true }).eq("guild_id", guildId);
  return (count || 0) + 1;
}
async function createTicketRecord({ guildId, userId, channelId, category }) {
  if (!supabase) return;
  const { error } = await supabase.from("tickets").insert({ guild_id: guildId, user_id: userId, channel_id: channelId, category, status: "open", closed: false });
  if (error) logger.error("Ticket record create failed:", error.message);
}
async function updateTicketRecord(channelId, updates) {
  if (!supabase) return;
  const { error } = await supabase.from("tickets").update(updates).eq("channel_id", channelId);
  if (error) logger.error("Ticket record update failed:", error.message);
}
