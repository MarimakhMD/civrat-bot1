"use strict";

const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const {
  isWelcomeImageObjectKey,
  guildIdOfWelcomeImageKey,
} = require("../configuration/welcomeImageStorage");

/**
 * Résolution de l'image Welcome personnalisée (Premium) en un template de rendu.
 *
 * CE MODULE EST LE CHEMIN UNIQUE : la livraison (`WelcomeDeliveryService`) et
 * l'aperçu admin (`previewWelcomeImage`) appellent exactement cette fonction.
 * C'est ce qui garantit qu'un aperçu ne peut pas différer du rendu réel.
 *
 * Trois règles structurantes :
 *
 *  1. Le `WelcomeTemplateRegistry` global n'est JAMAIS muté. On DÉRIVE un
 *     nouvel objet à partir du template de base ; le registre reste partagé et
 *     immuable pour toutes les guildes.
 *
 *  2. L'entitlement est un paramètre OBLIGATOIRE. Sans décision `granted`, la
 *     fonction renvoie le template de base : il est donc impossible d'appeler ce
 *     module en contournant la vérification Premium. La décision elle-même est
 *     produite en amont par l'appelant (livraison : `#buildCardFiles` ;
 *     aperçu : le bouton `PREVIEW_WELCOME_IMAGE`), ce qui préserve intactes les
 *     trois raisons existantes WELCOME_IMAGE_DISABLED / PREMIUM_REQUIRED /
 *     ENTITLEMENT_UNAVAILABLE, toutes émises AVANT cet appel.
 *
 *  3. Toute défaillance (backend absent, objet manquant, clé d'une autre guilde,
 *     image illisible) renvoie le template de base. Une image personnalisée ne
 *     peut donc jamais empêcher l'envoi du Welcome.
 */
async function resolveWelcomeImageTemplate({
  baseTemplate,
  config,
  guildId,
  entitlement,
  imageStore = null,
  resourceCache = null,
  logger = null,
} = {}) {
  if (!baseTemplate || !baseTemplate.design) return baseTemplate || null;
  // Barrière Premium : aucune décision accordée ⇒ template standard.
  if (!entitlement || entitlement.granted !== true) return baseTemplate;

  const key = config?.[Key.WELCOME_IMAGE_KEY];
  if (!isWelcomeImageObjectKey(key)) return baseTemplate;

  // Isolation : une clé dont le préfixe n'est pas la guilde courante est
  // ignorée. Une valeur recopiée d'un autre serveur en base ne sert à rien.
  if (guildIdOfWelcomeImageKey(key) !== guildId) {
    logger?.warn?.("Welcome image key ignored: guild mismatch", { guildId });
    return baseTemplate;
  }

  const buffer = await loadWelcomeImageBuffer({ key, guildId, imageStore, resourceCache, logger });
  if (!buffer) return baseTemplate;

  // La géométrie détectée vit dans un sidecar du même bucket privé. Toute
  // anomalie (absent, illisible, valeurs incohérentes) ramène à null, donc à
  // la géométrie du gabarit : une métadonnée corrompue ne casse jamais un Welcome.
  const avatarOverride = await loadDetectedAvatarGeometry({ guildId, imageStore, logger });

  return deriveTemplateWithImage(baseTemplate, buffer, avatarOverride);
}

/**
 * Lit la géométrie détectée et la valide. Les valeurs sont revérifiées ici
 * plutôt que d'être faites confiance : le sidecar est un objet stocké, il peut
 * avoir été écrit par une version antérieure ou altéré.
 * @returns {Promise<{cx:number,cy:number,radius:number}|null>}
 */
async function loadDetectedAvatarGeometry({ guildId, imageStore, logger }) {
  if (!imageStore || typeof imageStore.downloadMeta !== "function") return null;

  let meta = null;
  try {
    meta = await imageStore.downloadMeta(guildId);
  } catch (error) {
    logger?.warn?.("Welcome image meta could not be read", { guildId, errorType: error?.name || typeof error });
    return null;
  }
  if (!meta || meta.verdict !== "CONFIRME") return null;

  const avatar = meta.avatar;
  if (!avatar || typeof avatar !== "object") return null;
  const cx = Number(avatar.cx);
  const cy = Number(avatar.cy);
  const radius = Number(avatar.radius);
  if (![cx, cy, radius].every(Number.isFinite)) return null;
  if (radius <= 0) return null;
  // Un cercle qui ne tient pas du tout dans l'image est incohérent : on ignore
  // la géométrie plutôt que de dessiner l'avatar hors cadre.
  if (cx + radius <= 0 || cy + radius <= 0) return null;
  return { cx: Math.round(cx), cy: Math.round(cy), radius: Math.round(radius) };
}

/** Récupère l'image, avec le cache de ressources existant (TTL 300 s, LRU). */
async function loadWelcomeImageBuffer({ key, guildId, imageStore, resourceCache, logger }) {
  if (!imageStore) return null;

  const cached = resourceCache?.get?.(key);
  if (cached) return cached;

  let buffer = null;
  try {
    buffer = await imageStore.download(guildId);
  } catch (error) {
    logger?.warn?.("Welcome image could not be fetched", {
      guildId,
      errorType: error?.name || typeof error,
    });
    return null;
  }
  if (!buffer) return null;

  resourceCache?.set?.(key, buffer);
  return buffer;
}

/**
 * Construit le template dérivé. `assetsPath` et `design.background.image` du
 * template de base sont CONSERVÉS : si le buffer personnalisé s'avère
 * indécodable, le renderer retombe sur l'asset standard plutôt que sur un
 * dégradé nu.
 *
 * `avatarOverride` porte la zone circulaire détectée dans l'image
 * personnalisée. Il n'est appliqué que sur un verdict CONFIRME (validé par
 * `loadDetectedAvatarGeometry`) ; à défaut, `design.avatar` du gabarit est
 * conservé à l'identique, y compris `ringColor` et `ringWidth`.
 */
function deriveTemplateWithImage(baseTemplate, buffer, avatarOverride = null) {
  const design = baseTemplate.design;
  const background = design.background || {};
  const derivedDesign = { ...design, background: { ...background, buffer } };
  if (avatarOverride) {
    derivedDesign.avatar = { ...(design.avatar || {}), ...avatarOverride };
  }
  return Object.freeze({
    ...baseTemplate,
    design: Object.freeze(
      avatarOverride
        ? { ...derivedDesign, avatar: Object.freeze(derivedDesign.avatar) }
        : { ...derivedDesign, background: Object.freeze(derivedDesign.background) },
    ),
  });
}

/** Vrai si la configuration de la guilde référence une image personnalisée. */
function hasCustomWelcomeImage(config, guildId) {
  const key = config?.[Key.WELCOME_IMAGE_KEY];
  return isWelcomeImageObjectKey(key) && guildIdOfWelcomeImageKey(key) === guildId;
}

module.exports = { resolveWelcomeImageTemplate, hasCustomWelcomeImage };
