// ═══════════════════════════════════════════════════
// PLACEHOLDER SERVICE - Template engine for messages
// ═══════════════════════════════════════════════════
// Reusable across all modules (welcome, goodbye, tickets, etc.)

/**
 * Replace placeholders in a message template
 * @param {string} template - Message template with placeholders
 * @param {Object} context - Context object with replacement values
 * @returns {string} Processed message
 */
function parse(template, context = {}) {
  if (!template) return "";

  let result = template;

  const replacements = {
    "{user}": context.user ? `<@${context.user.id}>` : "",
    "{mention}": context.user ? `<@${context.user.id}>` : "",
    "{username}": context.user?.username || context.user?.tag || "",
    "{displayName}": context.member?.displayName || context.user?.username || "",
    "{discriminator}": context.user?.discriminator || "0",
    "{userAvatar}": context.user?.displayAvatarURL?.({ size: 256 }) || "",
    "{userId}": context.user?.id || "",

    "{server}": context.guild?.name || "",
    "{guildId}": context.guild?.id || "",
    "{guildIcon}": context.guild?.iconURL?.({ size: 256 }) || "",
    "{memberCount}": context.guild?.memberCount?.toString() || "0",
    "{boostCount}": context.guild?.premiumSubscriptionCount?.toString() || "0",
    "{boostLevel}": context.guild?.premiumTier?.toString() || "0",

    "{channel}": context.channel ? `<#${context.channel.id}>` : "",
    "{channelName}": context.channel?.name || "",

    "{date}": new Date().toLocaleDateString("fr-FR"),
    "{time}": new Date().toLocaleTimeString("fr-FR"),
    "{timestamp}": `<t:${Math.floor(Date.now() / 1000)}:F>`,
    "{joinDate}": context.member?.joinedAt
      ? `<t:${Math.floor(context.member.joinedAt.getTime() / 1000)}:F>`
      : "",
    "{accountAge}": context.user?.createdAt
      ? `<t:${Math.floor(context.user.createdAt.getTime() / 1000)}:R>`
      : "",

    "{inviter}": context.inviter ? `<@${context.inviter.id}>` : "Inconnu",
    "{inviteCode}": context.inviteCode || "Inconnue",

    "{role}": context.role ? `<@&${context.role.id}>` : "",
    "{ticketNumber}": context.ticketNumber || "0",
    "{ticketOwner}": context.ticketOwner ? `<@${context.ticketOwner.id}>` : "",
    "{ticketCategory}": context.ticketCategory || "",
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.split(placeholder).join(value);
  }

  return result;
}

/**
 * Get list of available placeholders for documentation
 */
function getAvailablePlaceholders() {
  return [
    { placeholder: "{user}", description: "Mention de l'utilisateur" },
    { placeholder: "{mention}", description: "Mention de l'utilisateur" },
    { placeholder: "{username}", description: "Nom d'utilisateur" },
    { placeholder: "{displayName}", description: "Nom affiché sur le serveur" },
    { placeholder: "{server}", description: "Nom du serveur" },
    { placeholder: "{memberCount}", description: "Nombre de membres" },
    { placeholder: "{joinDate}", description: "Date d'arrivée sur le serveur" },
    { placeholder: "{accountAge}", description: "Âge du compte Discord" },
    { placeholder: "{inviter}", description: "Mention de l'inviteur" },
    { placeholder: "{inviteCode}", description: "Code d'invitation utilisé" },
    { placeholder: "{channel}", description: "Mention du salon" },
    { placeholder: "{date}", description: "Date actuelle" },
    { placeholder: "{time}", description: "Heure actuelle" },
    { placeholder: "{guildIcon}", description: "Icône du serveur" },
    { placeholder: "{userAvatar}", description: "Avatar de l'utilisateur" },
    { placeholder: "{boostCount}", description: "Nombre de boosts" },
    { placeholder: "{boostLevel}", description: "Niveau de boost" },
    { placeholder: "{ticketNumber}", description: "Numéro du ticket" },
    { placeholder: "{ticketOwner}", description: "Propriétaire du ticket" },
    { placeholder: "{ticketCategory}", description: "Catégorie du ticket" },
  ];
}

module.exports = { parse, getAvailablePlaceholders };
