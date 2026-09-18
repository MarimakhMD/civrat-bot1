"use strict";

/**
 * Contrat de stockage de l'image Welcome personnalisée (Premium).
 *
 * Un seul module définit le bucket, le nom d'objet et la forme de la clé, afin
 * que la validation de configuration et le stockage ne puissent pas diverger.
 * Ce module n'importe rien : il ne peut créer aucun cycle.
 *
 * La clé est DÉTERMINISTE (`{guildId}/welcome.png`) :
 *  - le remplacement est un simple upsert sur le même objet, donc il n'y a
 *    jamais d'objet orphelin ni de table de suivi ;
 *  - le préfixe `{guildId}` est la garantie d'isolation : une guilde ne peut
 *    ni lire ni écrire l'objet d'une autre, la clé n'étant jamais fournie par
 *    l'appelant mais toujours dérivée du guildId authentifié.
 */

const WELCOME_IMAGE_BUCKET = "civrat-welcome-images";
const WELCOME_IMAGE_OBJECT_NAME = "welcome.png";

/** Un identifiant Discord est un snowflake : 15 à 22 chiffres. */
const GUILD_ID_PATTERN = /^\d{15,22}$/;
const WELCOME_IMAGE_KEY_PATTERN = /^\d{15,22}\/welcome\.png$/;

function isDiscordGuildId(value) {
  return typeof value === "string" && GUILD_ID_PATTERN.test(value);
}

/**
 * Construit la clé d'objet d'une guilde. Refuse tout guildId qui n'est pas un
 * snowflake : c'est ce qui empêche une traversée de chemin (`../`) ou une clé
 * forgée d'atteindre un objet d'une autre guilde.
 */
function buildWelcomeImageObjectKey(guildId) {
  if (!isDiscordGuildId(guildId)) {
    throw new TypeError("welcome image object key requires a valid guildId");
  }
  return `${guildId}/${WELCOME_IMAGE_OBJECT_NAME}`;
}

function isWelcomeImageObjectKey(value) {
  return typeof value === "string" && WELCOME_IMAGE_KEY_PATTERN.test(value);
}

/**
 * Extrait le guildId d'une clé, ou null. Utilisé en LECTURE pour ignorer une
 * clé dont le préfixe ne correspond pas à la guilde courante : une valeur
 * copiée d'un autre serveur en base ne peut donc jamais être servie.
 */
function guildIdOfWelcomeImageKey(value) {
  if (!isWelcomeImageObjectKey(value)) return null;
  return value.slice(0, value.indexOf("/"));
}

module.exports = {
  WELCOME_IMAGE_BUCKET,
  WELCOME_IMAGE_OBJECT_NAME,
  WELCOME_IMAGE_KEY_PATTERN,
  isDiscordGuildId,
  buildWelcomeImageObjectKey,
  isWelcomeImageObjectKey,
  guildIdOfWelcomeImageKey,
};
