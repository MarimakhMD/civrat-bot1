"use strict";

const crypto = require("node:crypto");

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

  // Phase 2.2 — la géométrie détectée n'est plus lue. Le rendu est piloté par
  // le MODE réellement configuré (image personnalisée), jamais par la présence
  // accidentelle d'un `welcome.json` écrit par une version antérieure. Un
  // sidecar historique ne peut donc plus provoquer un rendu avec avatar.
  return deriveTemplateWithImage(baseTemplate, buffer);
}

/** Empreinte d'un buffer : la seule preuve exploitable de l'image réellement servie. */
function fingerprint(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { bytes: 0, sha256: null };
  return { bytes: buffer.length, sha256: crypto.createHash("sha256").update(buffer).digest("hex") };
}

/** Récupère l'image, avec le cache de ressources existant (TTL 300 s, LRU). */
async function loadWelcomeImageBuffer({ key, guildId, imageStore, resourceCache, logger }) {
  if (!imageStore) return null;

  const cached = resourceCache?.get?.(key);
  if (cached) {
    // `source: "cache"` : sans cette trace, un remplacement d'image servi par
    // une entrée périmée était indistinguable d'une image correctement relue.
    logger?.info?.("Welcome image background resolved", { guildId, key, source: "cache", ...fingerprint(cached) });
    return cached;
  }

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

  // Même trace côté stockage : comparer les deux empreintes dit immédiatement
  // si le bucket et le cache divergent.
  logger?.info?.("Welcome image background resolved", { guildId, key, source: "storage", ...fingerprint(buffer) });

  resourceCache?.set?.(key, buffer);
  return buffer;
}

/**
 * Construit le template dérivé du mode « image personnalisée ».
 *
 * `assetsPath` et `design.background.image` du template de base sont CONSERVÉS :
 * si le buffer personnalisé s'avère indécodable, le renderer retombe sur l'asset
 * standard plutôt que sur un dégradé nu.
 *
 * Phase 2.2 — deux champs portent la règle produit :
 *  - `customImage: true` pilote le renderer : image + pseudo/nom du membre, et
 *    rien d'autre (ni sous-titre, ni avatar, ni cercle, ni décoration ajoutée) ;
 *  - `avatar: null` retire toute zone avatar du design dérivé. Redondance
 *    volontaire : même un chemin de rendu qui ignorerait le drapeau ne pourrait
 *    plus dessiner d'avatar, la géométrie n'existant plus dans le design.
 *
 * Le template de base et le `WelcomeTemplateRegistry` global ne sont jamais
 * mutés : un objet distinct est dérivé, puis gelé.
 */
function deriveTemplateWithImage(baseTemplate, buffer) {
  const design = baseTemplate.design;
  const background = design.background || {};
  return Object.freeze({
    ...baseTemplate,
    design: Object.freeze({
      ...design,
      background: Object.freeze({ ...background, buffer }),
      customImage: true,
      avatar: null,
    }),
  });
}

/** Vrai si la configuration de la guilde référence une image personnalisée. */
function hasCustomWelcomeImage(config, guildId) {
  const key = config?.[Key.WELCOME_IMAGE_KEY];
  return isWelcomeImageObjectKey(key) && guildIdOfWelcomeImageKey(key) === guildId;
}

module.exports = { resolveWelcomeImageTemplate, hasCustomWelcomeImage };
