"use strict";

const { memberDisplayLabel, avatarUrl: resolveAvatarUrl } = require("../services/logLabels");
const { localizeTitle } = require("../services/logTitles");
const { resolveLanguage } = require("../services/logLanguage");

/**
 * PHASE 1 (correctif 1) — valeurs d'événement explicites.
 *
 * `guildMemberUpdate` capture l'état de l'événement AVANT tout `await` et
 * transmet ici des VALEURS (`member`, `before`, `after`, `avatarUrl`). C'est ce
 * qui empêche un log de pseudo d'afficher une modification ultérieure du membre
 * vivant.
 *
 * La forme historique `{ oldMember, newMember }` reste acceptée (tests et
 * appelants existants) : les valeurs sont alors dérivées des objets, avec la
 * même normalisation.
 */

/** `undefined`, `null` et `""` = « pas de pseudo ». Jamais de faux changement. */
function normalizeNickname(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function handleMemberNicknameChanged({
  guild = null,
  oldMember = null,
  newMember = null,
  memberId,
  member,
  before,
  after,
  avatarUrl,
  config,
  mapper,
  service,
  delivery,
}) {
  if (!config.logs_enabled) return null;

  const resolvedBefore = before === undefined ? normalizeNickname(oldMember && oldMember.nickname) : normalizeNickname(before);
  const resolvedAfter = after === undefined ? normalizeNickname(newMember && newMember.nickname) : normalizeNickname(after);

  // Pseudo inchangé → aucun log. Comparaison sur valeurs normalisées : un
  // changement de rôle seul ne peut plus produire de `member_nickname_changed`.
  if (resolvedBefore === resolvedAfter) return null;

  const resolvedMemberId = memberId !== undefined ? memberId : (newMember && newMember.id) || null;
  const resolvedMember = member !== undefined ? member : memberDisplayLabel(newMember);
  const resolvedAvatar = avatarUrl !== undefined ? avatarUrl : resolveAvatarUrl(newMember);
  const guildId = (guild && guild.id) || (newMember && newMember.guild && newMember.guild.id) || null;

  const entry = mapper.map({
    guildId,
    channelKey: "log_moderation_channel_id",
    // PHASE 1 — routage cohérent : ce log part dans le salon « modération »,
    // sa catégorie déclarée doit donc être la même (la catégorie sert au
    // diagnostic de livraison ; une divergence masquait la destination réelle).
    category: "moderation",
    language: resolveLanguage(config),
    action: "member_nickname_changed",
    title: localizeTitle(config, "logs.memberNicknameChanged"),
    // Pas de `who` : un membre peut modifier son propre pseudo, l'auteur n'est
    // donc pas attribuable de façon fiable sans Audit Log (non effectué ici).
    details: {
      member: resolvedMember,
      before: resolvedBefore,
      after: resolvedAfter,
      memberId: resolvedMemberId,
      avatarUrl: resolvedAvatar,
    },
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleMemberNicknameChanged, normalizeNickname };
