"use strict";

const { premiumRequiredView } = require("../../../core/entitlements");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { WelcomeAdminAction } = require("../services/WelcomeAdminLogService");
const { buildWelcomeCardRequest } = require("../image/pipeline/buildWelcomeCardRequest");
const { resolveWelcomeImageTemplate } = require("../services/welcomeImageResource");
const { resolveWelcomeImageEntitlement } = require("../services/welcomeImageEntitlement");
const { buildWelcomeCardMember, buildWelcomeCardSubtitle } = require("../services/welcomeCardMember");
const {
  WelcomeImageRejectReason,
  checkWelcomeImageAttachment,
  fetchWelcomeImageBuffer,
  decodeWelcomeImage,
  formatImageSize,
  ACCEPTED_IMAGE_CONTENT_TYPES,
} = require("../services/welcomeImageUploadValidation");
const { detectAvatarCircle, AvatarCircleVerdict } = require("../image/analysis/detectAvatarCircle");

const DEFAULT_TEMPLATE_ID = "template-1";

/** Raison de refus → clé de traduction. Aucune chaîne dure dans les réponses. */
const REJECT_MESSAGE_KEY = Object.freeze({
  [WelcomeImageRejectReason.MISSING_ATTACHMENT]: "welcomeGoodbye.welcomeImageRejectMissing",
  [WelcomeImageRejectReason.UNSUPPORTED_FORMAT]: "welcomeGoodbye.welcomeImageRejectFormat",
  [WelcomeImageRejectReason.EMPTY_FILE]: "welcomeGoodbye.welcomeImageRejectEmpty",
  [WelcomeImageRejectReason.TOO_LARGE]: "welcomeGoodbye.welcomeImageRejectTooLarge",
  [WelcomeImageRejectReason.FETCH_FAILED]: "welcomeGoodbye.welcomeImageRejectFetch",
  [WelcomeImageRejectReason.CDN_UNEXPECTED_CONTENT]: "welcomeGoodbye.welcomeImageRejectCdn",
  [WelcomeImageRejectReason.NOT_AN_IMAGE]: "welcomeGoodbye.welcomeImageRejectNotAnImage",
  [WelcomeImageRejectReason.DECODE_FAILED]: "welcomeGoodbye.welcomeImageRejectDecode",
  [WelcomeImageRejectReason.TOO_MANY_PIXELS]: "welcomeGoodbye.welcomeImageRejectTooManyPixels",
});

/**
 * `/welcomeimage` — téléverse l'image Welcome personnalisée (Premium).
 *
 * Ordre des garde-fous, du moins cher au plus cher :
 *  1. métadonnées de la pièce jointe (aucun octet téléchargé si invalides) ;
 *  2. entitlement Premium — AVANT tout téléchargement et toute écriture, donc
 *     une guilde Free ne stocke rien et n'écrit rien ;
 *  3. disponibilité du stockage ;
 *  4. téléchargement ;
 *  5. décodage RÉEL de l'image (un contentType mensonger ne suffit pas) ;
 *  6. écriture dans le bucket privé (upsert sur `{guildId}/welcome.png`) ;
 *  7. écriture de `welcome_image_key` ;
 *  8. aperçu rendu par le MÊME chemin que la livraison.
 *
 * Le téléversement n'active PAS `welcome_image_enabled` : le toggle reste un
 * prérequis distinct, conformément au choix produit.
 */
async function uploadWelcomeImage(context) {
  const { guildId, userId, t, envelope, settings, imageStore, imagePipeline, templateRegistry, resourceCache, logger = null } = context;

  // Chaque branche répond à l'utilisateur ET renvoie un résultat structuré :
  // le même objet sert aux tests et à un éventuel journal d'audit, sans que le
  // message affiché dépende de qui appelle.
  const reject = async (reason, detail = null) => {
    // Aucun refus n'est silencieux : c'est ce silence qui rendait ce chemin
    // impossible à diagnostiquer. Le détail technique reste dans les journaux,
    // jamais dans la réponse (aucune URL, en-tête ou contenu interne n'est
    // renvoyé à l'utilisateur).
    logger?.warn?.("Welcome image upload rejected", { guildId, actorId: userId, reason, detail: detail || null });
    await envelope.transport.reply({
      view: {
        content: t(REJECT_MESSAGE_KEY[reason] || "welcomeGoodbye.welcomeImageRejectNotAnImage", {
          limit: formatImageSize(Number(envelope?.attachmentSizeLimit)),
          formats: ACCEPTED_IMAGE_CONTENT_TYPES.map((type) => type.replace("image/", "").toUpperCase()).join(", "),
        }),
        components: [],
      },
      ephemeral: true,
    });
    return { ok: false, code: "WELCOME_IMAGE_REJECTED", reason };
  };

  const storageUnavailable = async () => {
    await envelope.transport.reply({
      view: { content: t("welcomeGoodbye.welcomeImageStorageUnavailable"), components: [] },
      ephemeral: true,
    });
    return { ok: false, code: "WELCOME_IMAGE_STORAGE_UNAVAILABLE" };
  };

  // 1) Métadonnées — aucune I/O si elles sont mauvaises.
  const attachment = envelope.options?.getAttachment?.("image") ?? null;
  const checked = checkWelcomeImageAttachment({
    attachment,
    attachmentSizeLimit: envelope?.attachmentSizeLimit ?? null,
  });
  if (!checked.ok) {
    return await reject(checked.reason, {
      name: attachment?.name ?? null,
      contentType: attachment?.contentType ?? null,
      size: Number.isFinite(Number(attachment?.size)) ? Number(attachment.size) : null,
      limit: Number.isFinite(Number(envelope?.attachmentSizeLimit)) ? Number(envelope.attachmentSizeLimit) : null,
    });
  }

  // 2) Premium — avant tout téléchargement et toute écriture.
  const entitlement = await resolveWelcomeImageEntitlement({
    guildId,
    entitlementService: context.entitlementService,
  });
  if (!entitlement.granted) {
    await envelope.transport.reply({
      view: premiumRequiredView(t, { decision: entitlement.code }),
      ephemeral: true,
    });
    logger?.warn?.("Welcome image upload refused by entitlement", { guildId, actorId: userId, code: entitlement.code });
    return { ok: false, code: entitlement.code, granted: false };
  }

  // 3) Stockage réellement disponible.
  if (!imageStore?.available) {
    logger?.warn?.("Welcome image upload rejected: storage unavailable", { guildId, actorId: userId });
    return await storageUnavailable();
  }

  // 4) Téléchargement de la pièce jointe.
  const fetched = await fetchWelcomeImageBuffer(attachment, { logger, guildId });
  if (!fetched.ok) return await reject(fetched.reason, fetched.detail);

  // 5) Décodage réel : dimensions incluses, bombe de pixels incluse.
  const decoded = await decodeWelcomeImage(fetched.buffer, { logger, guildId });
  if (!decoded.ok) return await reject(decoded.reason, decoded.detail);

  // 6) Écriture dans le bucket privé, remplacement par upsert.
  let stored;
  try {
    stored = await imageStore.upload(guildId, fetched.buffer, {
      contentType: String(attachment.contentType).split(";")[0].trim().toLowerCase(),
    });
  } catch (error) {
    logger?.warn?.("Welcome image storage upload failed", {
      guildId,
      actorId: userId,
      errorName: error?.name || null,
      errorMessage: error?.message || null,
      causeMessage: error?.causeMessage || null,
      causeCode: error?.causeCode || null,
    });
    return await storageUnavailable();
  }

  // 6bis) Détection de la zone avatar, APRÈS le stockage de l'image.
  // L'ordre compte : l'image est déjà enregistrée, donc un échec ou une
  // ambiguïté de la détection ne peut ni l'annuler ni la supprimer. En cas de
  // verdict autre que CONFIRME, aucun sidecar n'est écrit et le rendu
  // conservera la géométrie du gabarit.
  const detection = await detectAvatarCircle(fetched.buffer, { logger, guildId });
  logger?.info?.("Welcome avatar circle detection", {
    guildId,
    verdict: detection.verdict,
    score: detection.score,
    candidates: detection.candidates,
    ...detection.detail,
  });
  if (detection.verdict === AvatarCircleVerdict.CONFIRMED && detection.geometry) {
    // Échec toléré : l'image reste utilisable, seule la géométrie automatique
    // est perdue. `uploadMeta` ne lève jamais.
    await imageStore.uploadMeta?.(guildId, {
      version: 1,
      verdict: detection.verdict,
      score: detection.score,
      avatar: detection.geometry,
      detectedAt: new Date().toISOString(),
    });
  } else {
    // Verdict non confirmé : il faut PURGER un éventuel sidecar laissé par
    // une image précédente. Sans cela la géométrie de l'ancienne image
    // serait appliquée à la nouvelle, ce qui est exactement ce que la règle
    // « jamais de géométrie incertaine » interdit.
    await imageStore.removeMeta?.(guildId);
  }

  // 7) Persistance de la clé. Le schéma refuse toute clé malformée.
  const config = await settings.update(guildId, { [Key.WELCOME_IMAGE_KEY]: stored.key });
  context.adminLogService?.record?.({
    action: WelcomeAdminAction.IMAGE_UPLOADED,
    guildId,
    actorId: userId,
    metadata: { bytes: fetched.buffer.length, width: decoded.width, height: decoded.height },
  });

  // 8) Aperçu : rendu réel via le chemin de livraison.
  const preview = await renderUploadedCardPreview({ config, guildId, userId, envelope, entitlement, imageStore, imagePipeline, templateRegistry, resourceCache, logger });

  // L'administrateur doit savoir si la zone avatar a été reconnue : sans ce
  // retour, un avatar mal placé resterait inexplicable. Le message diffère
  // selon le verdict, mais l'upload est confirmé dans les trois cas.
  const avatarMessageKey = detection.verdict === AvatarCircleVerdict.CONFIRMED
    ? "welcomeGoodbye.welcomeImageAvatarDetected"
    : "welcomeGoodbye.welcomeImageAvatarUnconfirmed";
  const content = `${t("welcomeGoodbye.welcomeImageUploaded")}\n${t(avatarMessageKey)}`;

  if (preview) {
    await envelope.transport.replyImagePreview({
      image: preview,
      content,
      ephemeral: true,
    });
  } else {
    await envelope.transport.reply({
      view: { content, components: [] },
      ephemeral: true,
    });
  }
  return {
    ok: true,
    code: "WELCOME_IMAGE_UPLOADED",
    key: stored.key,
    width: decoded.width,
    height: decoded.height,
    bytes: fetched.buffer.length,
    preview: Boolean(preview),
    avatarCircle: {
      verdict: detection.verdict,
      geometry: detection.geometry,
      score: detection.score,
    },
  };
}

/**
 * Rend la carte telle qu'elle sera réellement envoyée : template dérivé par
 * `resolveWelcomeImageTemplate`, exactement comme dans `#buildCardFiles`.
 * Un échec de rendu ne fait jamais perdre la confirmation d'enregistrement.
 */
async function renderUploadedCardPreview({
  config, guildId, userId, envelope, entitlement, imageStore, imagePipeline, templateRegistry, resourceCache, logger = null,
}) {
  if (!imagePipeline || !templateRegistry) return null;
  try {
    const baseTemplate = templateRegistry.get(config?.[Key.WELCOME_TEMPLATE]) || templateRegistry.get(DEFAULT_TEMPLATE_ID);
    if (!baseTemplate?.design) return null;
    const template = await resolveWelcomeImageTemplate({
      baseTemplate, config, guildId, entitlement, imageStore, resourceCache,
    });
    if (!template?.design) return null;

    const member = { ...buildWelcomeCardMember(envelope?.discordMember), guildId, userId };
    const subtitleText = buildWelcomeCardSubtitle(config, member);
    const request = buildWelcomeCardRequest({ member, subtitleText, template });
    return await imagePipeline.generate(request, template);
  } catch (error) {
    // L'aperçu est un confort : son échec ne doit pas annuler l'upload, déjà
    // effectué. Mais il n'est plus silencieux.
    logger?.warn?.("Welcome image preview render failed", { guildId, errorName: error?.name || null, errorMessage: error?.message || null });
    return null;
  }
}

module.exports = { uploadWelcomeImage };
