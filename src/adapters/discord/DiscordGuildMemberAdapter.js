"use strict";

// Adapte un GuildMember discord.js (ou un membre partiel) vers la forme plate
// consommée par le module welcome/goodbye.
//
// Un membre qui vient de quitter la guilde arrive en « partiel »
// (Partials.GuildMember) avec `member.user === null`. L'ancienne version lisait
// `member.user.id` sans garde et levait un TypeError qui interrompait toute la
// chaîne guildMemberRemove (goodbye ET log de départ). Tous les champs liés à
// l'utilisateur sont désormais optionnels et valent `null` quand indisponibles.

/**
 * PHASE 2 (B7) — DATES LOCALISÉES.
 *
 * `toLocaleDateString()` sans argument utilise la locale du CONTENEUR, pas celle
 * de la guilde : une guilde française recevait `5/1/2024` et `10:52:03 AM`
 * (format US). La locale est désormais dérivée de `config.language`, la même
 * colonne que celle utilisée par les interactions (`InteractionContext`).
 *
 * Sans `language` (appel direct, tests), le comportement historique est
 * conservé : locale du conteneur.
 */
const DATE_LOCALE_BY_LANGUAGE = Object.freeze({ fr: "fr-FR", en: "en-GB" });

function resolveDateLocale(language) {
  return DATE_LOCALE_BY_LANGUAGE[language] || null;
}

function formatDate(value, locale) {
  if (!value || typeof value.toLocaleDateString !== "function") return null;
  return locale ? value.toLocaleDateString(locale) : value.toLocaleDateString();
}

function formatTime(value, locale) {
  if (!value || typeof value.toLocaleTimeString !== "function") return null;
  return locale ? value.toLocaleTimeString(locale) : value.toLocaleTimeString();
}

/**
 * @param {object} member GuildMember discord.js (éventuellement partiel)
 * @param {{language?: string}} [options] `language` = `"fr"` | `"en"` (colonne
 *   `guild_configs.language`) ; pilote le format des dates.
 */
function adaptGuildMember(member, { language = null } = {}) {
  const user = member && member.user ? member.user : null;
  const locale = resolveDateLocale(language);
  const now = new Date();
  return {
    guildId: member.guild.id,
    userId: user ? user.id : (member.id || null),
    user: user ? user.toString() : null,
    username: user ? user.username : null,
    displayName: member.displayName ?? null,
    // PHASE 2 (B10) — les bots ne doivent recevoir ni Welcome ni Goodbye. Le
    // drapeau est porté par le contexte pour que la décision soit testable sans
    // objet discord.js.
    isBot: Boolean(user && user.bot === true),
    avatarUrl: user && typeof user.displayAvatarURL === "function"
      ? safeAvatarUrl(user)
      : null,
    server: member.guild.name,
    memberCount: member.guild.memberCount ?? null,
    joinDate: formatDate(member.joinedAt, locale),
    accountAge: formatDate(user?.createdAt, locale),
    date: formatDate(now, locale),
    time: formatTime(now, locale),
  };
}

function safeAvatarUrl(user) {
  try {
    return user.displayAvatarURL({ extension: "png", size: 256 }) || null;
  } catch {
    return null;
  }
}

module.exports = { adaptGuildMember, resolveDateLocale, DATE_LOCALE_BY_LANGUAGE };
