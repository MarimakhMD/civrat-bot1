"use strict";

// Adapte un GuildMember discord.js (ou un membre partiel) vers la forme plate
// consommée par le module welcome/goodbye.
//
// Un membre qui vient de quitter la guilde arrive en « partiel »
// (Partials.GuildMember) avec `member.user === null`. L'ancienne version lisait
// `member.user.id` sans garde et levait un TypeError qui interrompait toute la
// chaîne guildMemberRemove (goodbye ET log de départ). Tous les champs liés à
// l'utilisateur sont désormais optionnels et valent `null` quand indisponibles.
function adaptGuildMember(member) {
  const user = member && member.user ? member.user : null;
  return {
    guildId: member.guild.id,
    userId: user ? user.id : (member.id || null),
    user: user ? user.toString() : null,
    username: user ? user.username : null,
    displayName: member.displayName ?? null,
    avatarUrl: user && typeof user.displayAvatarURL === "function"
      ? safeAvatarUrl(user)
      : null,
    server: member.guild.name,
    memberCount: member.guild.memberCount ?? null,
    joinDate: member.joinedAt?.toLocaleDateString?.() ?? null,
    accountAge: user?.createdAt?.toLocaleDateString?.() ?? null,
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString(),
  };
}

function safeAvatarUrl(user) {
  try {
    return user.displayAvatarURL({ extension: "png", size: 256 }) || null;
  } catch {
    return null;
  }
}

module.exports = { adaptGuildMember };
