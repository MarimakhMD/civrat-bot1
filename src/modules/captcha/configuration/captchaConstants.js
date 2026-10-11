"use strict";

const CaptchaConfigKey = Object.freeze({
  ENABLED: "captcha_enabled",
  CHANNEL_ID: "captcha_channel_id",
  ROLE_ID: "captcha_role_id",
  // P-CAPT L1 — réglages de session (valeurs absentes ⇒ défauts NORMAL).
  EXPIRY_MINUTES: "captcha_expiry_minutes",
  ATTEMPTS: "captcha_attempts",
  COOLDOWN_SECONDS: "captcha_cooldown_seconds",
  // P-CAPT L2 — rôle non vérifié, force-existing, panneau officiel persisté.
  UNVERIFIED_ROLE_ID: "captcha_unverified_role_id",
  FORCE_EXISTING: "captcha_force_existing",
  PANEL_CHANNEL_ID: "captcha_panel_channel_id",
  PANEL_MESSAGE_ID: "captcha_panel_message_id",
  // P-CAPT L3 — niveau de sécurité, mode de vérification, type de challenge.
  LEVEL: "captcha_level",
  MODE: "captcha_mode",
  CHALLENGE: "captcha_challenge",
});

const CaptchaComponentId = Object.freeze({
  SECTION: "civrat:v1:captcha:section",
  TOGGLE: "civrat:v1:captcha:toggle",
  CHANNEL: "civrat:v1:captcha:channel",
  ROLE: "civrat:v1:captcha:role",
  PREVIEW: "civrat:v1:captcha:preview",
  RESET: "civrat:v1:captcha:reset",
  BACK: "civrat:v1:captcha:back",
  VERIFY: "civrat:v1:captcha:verify",
  // P-CAPT L1 — sous-vue « Avancé » (durée + tentatives/cooldown).
  ADVANCED: "civrat:v1:captcha:advanced",
  DURATION: "civrat:v1:captcha:duration",
  LIMITS: "civrat:v1:captcha:limits",
  // P-CAPT L2 — rôle non vérifié + force-existing.
  UNVERIFIED_ROLE: "civrat:v1:captcha:unverified-role",
  FORCE_EXISTING: "civrat:v1:captcha:force-existing",
  // P-CAPT L3 — niveau, mode, type de challenge.
  LEVEL: "civrat:v1:captcha:level",
  MODE: "civrat:v1:captcha:mode",
  CHALLENGE: "civrat:v1:captcha:challenge",
});

/**
 * P-CAPT L2 — éléments provisionnés par l'auto-réparation.
 * Les IDs restent la source de vérité : on ne recrée QUE l'élément manquant,
 * jamais ceux déjà présents.
 */
const CaptchaProvisionDefaults = Object.freeze({
  UNVERIFIED_ROLE_NAME: "CIVRAT • Non vérifié",
  VERIFIED_ROLE_NAME: "CIVRAT • Vérifié",
  CHANNEL_NAME: "captcha-verification",
});

/** P-CAPT L2 — force-existing : plafond dur par exécution (jamais infini). */
const CAPTCHA_FORCE_EXISTING_MAX_MEMBERS = 1000;

/**
 * Défauts de session = preset NORMAL (niveau par défaut validé P-CAPT).
 * Modifiables par l'admin via la vue Avancé ; jamais de valeur inventée à la
 * lecture : toute valeur absente ou hors-bornes retombe sur le repli du niveau
 * configuré (NORMAL ⇒ ces valeurs — comportement L1 inchangé).
 */
const CaptchaSessionDefaults = Object.freeze({
  EXPIRY_MINUTES: 5,
  ATTEMPTS: 3,
  COOLDOWN_SECONDS: 10,
});

/**
 * Presets de durée (minutes) acceptés par le select DURATION — whitelist.
 * P-CAPT L3 : 2 min ajouté pour que le preset HIGH du plan validé (2 minutes)
 * soit une valeur de la whitelist L1 — aucune valeur de niveau n'est écrite
 * hors des presets L1 (et aucune durée L1 existante n'est retirée).
 */
const CAPTCHA_DURATION_PRESETS = Object.freeze([1, 2, 5, 10, 15, 30]);

/** Presets [attempts, cooldownSeconds] acceptés par le select LIMITS — whitelist. */
const CAPTCHA_LIMITS_PRESETS = Object.freeze([
  Object.freeze({ attempts: 5, cooldownSeconds: 5 }),
  Object.freeze({ attempts: 3, cooldownSeconds: 10 }),
  Object.freeze({ attempts: 3, cooldownSeconds: 30 }),
  Object.freeze({ attempts: 2, cooldownSeconds: 60 }),
]);

/**
 * P-CAPT L3 — repli de session du niveau configuré.
 * NORMAL ⇒ valeurs identiques aux défauts L1 (aucun changement pour les
 * configurations existantes) ; LOW/HIGH/RAID ⇒ limites de leur preset. Les
 * clés L1 explicites restent prioritaires : elles surchargent toujours le
 * repli, jamais l'inverse.
 */
function captchaSessionFallback(level) {
  const preset = CaptchaLevelPresets[level] || CaptchaLevelPresets[CAPTCHA_DEFAULT_LEVEL];
  return {
    EXPIRY_MINUTES: preset.expiryMinutes,
    ATTEMPTS: preset.attempts,
    COOLDOWN_SECONDS: preset.cooldownSeconds,
  };
}

function resolveCaptchaSessionSettings(config, { defaults = null } = {}) {
  const fallback = defaults || captchaSessionFallback(resolveCaptchaLevel(config));
  const expiry = Number(config?.[CaptchaConfigKey.EXPIRY_MINUTES]);
  const attempts = Number(config?.[CaptchaConfigKey.ATTEMPTS]);
  const cooldown = Number(config?.[CaptchaConfigKey.COOLDOWN_SECONDS]);
  const expiryMinutes = Number.isFinite(expiry) && expiry > 0 ? expiry : fallback.EXPIRY_MINUTES;
  const maxAttempts = Number.isInteger(attempts) && attempts >= 1 && attempts <= 10 ? attempts : fallback.ATTEMPTS;
  const cooldownSeconds = Number.isFinite(cooldown) && cooldown >= 0 && cooldown <= 600 ? cooldown : fallback.COOLDOWN_SECONDS;
  return Object.freeze({
    expiryMs: expiryMinutes * 60 * 1000,
    maxAttempts,
    cooldownMs: cooldownSeconds * 1000,
    // Blocage temporaire : durée dérivée des réglages (aucune magie).
    blockMs: cooldownSeconds * 1000 * maxAttempts,
  });
}

/* ─────────────────────────── P-CAPT L3 ───────────────────────────
 * Niveaux de sécurité, modes et challenges Premium.
 * Aucune valeur n'est inventée à l'exécution : toute valeur absente ou hors
 * whitelist retombe sur le défaut validé (NORMAL, bouton simple).
 */

/** Niveaux de sécurité (plan validé : NORMAL = défaut). */
const CaptchaLevel = Object.freeze({
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  RAID: "RAID",
});

/** Modes de vérification. */
const CaptchaMode = Object.freeze({
  BUTTON: "BUTTON",
  CHALLENGE: "CHALLENGE",
});

/** Les TROIS types de challenge Premium du plan validé (jamais une 4e). */
const CaptchaChallengeType = Object.freeze({
  CHOICE: "CHOICE", // choix parmi plusieurs réponses
  ORDER: "ORDER", // sélection d'un ordre correct
  PICK: "PICK", // sélection dynamique
});

const CAPTCHA_LEVEL_LIST = Object.freeze(Object.values(CaptchaLevel));
const CAPTCHA_MODE_LIST = Object.freeze(Object.values(CaptchaMode));
const CAPTCHA_CHALLENGE_TYPE_LIST = Object.freeze(Object.values(CaptchaChallengeType));
const CAPTCHA_DEFAULT_LEVEL = CaptchaLevel.NORMAL;
const CAPTCHA_DEFAULT_CHALLENGE_TYPE = CaptchaChallengeType.CHOICE;

/**
 * Presets validés : niveau → mode + limites de session (clés L1 réutilisées).
 *
 * Fenêtre de session : l'expiration est mesurée depuis la création et n'est
 * JAMAIS prolongée tant que la prochaine tentative reste possible avant elle.
 * Exception bornée (RAID : cooldown 60 s = expiration 1 min) : une tentative
 * consommée prolonge la session d'UNE fenêtre complète après la fin du
 * cooldown, afin que les tentatives restantes soient réellement utilisables et
 * que le blocage temporaire puisse se déclencher.
 */
const CaptchaLevelPresets = Object.freeze({
  [CaptchaLevel.LOW]: Object.freeze({ mode: CaptchaMode.BUTTON, expiryMinutes: 10, attempts: 5, cooldownSeconds: 5 }),
  [CaptchaLevel.NORMAL]: Object.freeze({ mode: CaptchaMode.BUTTON, expiryMinutes: 5, attempts: 3, cooldownSeconds: 10 }),
  [CaptchaLevel.HIGH]: Object.freeze({ mode: CaptchaMode.CHALLENGE, expiryMinutes: 2, attempts: 3, cooldownSeconds: 30 }),
  [CaptchaLevel.RAID]: Object.freeze({ mode: CaptchaMode.CHALLENGE, expiryMinutes: 1, attempts: 2, cooldownSeconds: 60 }),
});

/** Expérience Premium : niveaux HIGH/RAID ou mode challenge. */
const CAPTCHA_PREMIUM_LEVELS = Object.freeze([CaptchaLevel.HIGH, CaptchaLevel.RAID]);
function isCaptchaPremiumLevel(level) {
  return CAPTCHA_PREMIUM_LEVELS.includes(level);
}

/** Bornes des challenges (limites Discord : 4 boutons = 1 ligne). */
const CAPTCHA_CHALLENGE_OPTIONS = 4;
const CAPTCHA_CHALLENGE_ORDER_STEPS = 4;
const CAPTCHA_CHALLENGE_HISTORY = 8;
const CAPTCHA_CHALLENGE_ID_BYTES = 4;
const CAPTCHA_CHALLENGE_MAX_GENERATION_ATTEMPTS = 12;
/** Fenêtre anti double-clic sur la même réponse (jamais deux crédits). */
const CAPTCHA_CHALLENGE_DUPLICATE_WINDOW_MS = 2500;

function isCaptchaLevel(value) {
  return CAPTCHA_LEVEL_LIST.includes(value);
}

function isCaptchaMode(value) {
  return CAPTCHA_MODE_LIST.includes(value);
}

function isCaptchaChallengeType(value) {
  return CAPTCHA_CHALLENGE_TYPE_LIST.includes(value);
}

/** Niveau configuré — absent/invalide ⇒ NORMAL (défaut validé). */
function resolveCaptchaLevel(config) {
  const value = config?.[CaptchaConfigKey.LEVEL];
  return isCaptchaLevel(value) ? value : CAPTCHA_DEFAULT_LEVEL;
}

/** Mode configuré (surcharge explicite) sinon mode du preset du niveau. */
function resolveCaptchaMode(config) {
  const value = config?.[CaptchaConfigKey.MODE];
  if (isCaptchaMode(value)) return value;
  return CaptchaLevelPresets[resolveCaptchaLevel(config)].mode;
}

/** Type de challenge configuré — absent/invalide ⇒ CHOICE. */
function resolveCaptchaChallengeType(config) {
  const value = config?.[CaptchaConfigKey.CHALLENGE];
  return isCaptchaChallengeType(value) ? value : CAPTCHA_DEFAULT_CHALLENGE_TYPE;
}

/**
 * Écritures d'une sélection de niveau : le preset applique mode + limites de
 * session dans les clés L1 existantes (aucune nouvelle mécanique). `null` si
 * le niveau n'appartient pas à la whitelist (valeur invalide jamais écrite).
 */
function captchaLevelSelection(level) {
  const preset = CaptchaLevelPresets[level];
  if (!preset) return null;
  return Object.freeze({
    [CaptchaConfigKey.LEVEL]: level,
    [CaptchaConfigKey.MODE]: preset.mode,
    [CaptchaConfigKey.EXPIRY_MINUTES]: preset.expiryMinutes,
    [CaptchaConfigKey.ATTEMPTS]: preset.attempts,
    [CaptchaConfigKey.COOLDOWN_SECONDS]: preset.cooldownSeconds,
  });
}

/**
 * Expérience DEMANDÉE par la configuration, avant tout entitlement.
 * `premium: true` = niveau HIGH/RAID ou mode challenge.
 */
function resolveCaptchaRequestedPlan(config) {
  const level = resolveCaptchaLevel(config);
  const mode = resolveCaptchaMode(config);
  return Object.freeze({
    level,
    mode,
    challengeType: mode === CaptchaMode.CHALLENGE ? resolveCaptchaChallengeType(config) : null,
    premium: mode === CaptchaMode.CHALLENGE || isCaptchaPremiumLevel(level),
  });
}

/**
 * Plan EFFECTIF d'une session. Fail-closed : sans entitlement accordé, une
 * expérience Premium demandée retombe sur NORMAL/bouton (`fellBack`) — la
 * configuration enregistrée n'est jamais altérée et aucune session incohérente
 * n'est créée.
 */
function resolveCaptchaPlan(config, { granted = false } = {}) {
  const requested = resolveCaptchaRequestedPlan(config);
  if (requested.premium && granted !== true) {
    return Object.freeze({
      level: CAPTCHA_DEFAULT_LEVEL,
      mode: CaptchaMode.BUTTON,
      challengeType: null,
      premium: false,
      requestedPremium: true,
      fellBack: true,
    });
  }
  return Object.freeze({ ...requested, requestedPremium: requested.premium, fellBack: false });
}

/** Suffixe de routage d'une réponse de challenge (la route VERIFY est prefix). */
const CAPTCHA_CHALLENGE_CUSTOM_ID_SEPARATOR = ":";

function buildCaptchaChallengeCustomId({ type, challengeId, value }) {
  return [
    CaptchaComponentId.VERIFY,
    type,
    challengeId,
    String(value),
  ].join(CAPTCHA_CHALLENGE_CUSTOM_ID_SEPARATOR);
}

/**
 * Décode une réponse de challenge. Retourne `null` pour l'ID simple (démarrage
 * de session) et pour toute charge malformée — l'appelant décide.
 * Aucune réponse correcte ne transite par le customId : seul l'index cliqué.
 */
function parseCaptchaChallengeCustomId(customId) {
  if (typeof customId !== "string" || !customId.startsWith(CaptchaComponentId.VERIFY)) return null;
  const parts = customId.split(CAPTCHA_CHALLENGE_CUSTOM_ID_SEPARATOR);
  if (parts.length !== 7) return null;
  const [, , , , type, challengeId, rawValue] = parts;
  if (!isCaptchaChallengeType(type)) return null;
  if (!/^[0-9a-f]{8}$/.test(challengeId)) return null;
  if (!/^\d{1,2}$/.test(rawValue)) return null;
  return Object.freeze({ type, challengeId, value: Number(rawValue) });
}

module.exports = {
  CaptchaConfigKey,
  CaptchaComponentId,
  CaptchaSessionDefaults,
  CaptchaProvisionDefaults,
  CAPTCHA_DURATION_PRESETS,
  CAPTCHA_LIMITS_PRESETS,
  CAPTCHA_FORCE_EXISTING_MAX_MEMBERS,
  resolveCaptchaSessionSettings,
  // P-CAPT L3
  CaptchaLevel,
  CaptchaMode,
  CaptchaChallengeType,
  CaptchaLevelPresets,
  CAPTCHA_LEVEL_LIST,
  CAPTCHA_MODE_LIST,
  CAPTCHA_CHALLENGE_TYPE_LIST,
  CAPTCHA_DEFAULT_LEVEL,
  CAPTCHA_DEFAULT_CHALLENGE_TYPE,
  CAPTCHA_PREMIUM_LEVELS,
  CAPTCHA_CHALLENGE_OPTIONS,
  CAPTCHA_CHALLENGE_ORDER_STEPS,
  CAPTCHA_CHALLENGE_HISTORY,
  CAPTCHA_CHALLENGE_ID_BYTES,
  CAPTCHA_CHALLENGE_MAX_GENERATION_ATTEMPTS,
  CAPTCHA_CHALLENGE_DUPLICATE_WINDOW_MS,
  isCaptchaLevel,
  isCaptchaMode,
  isCaptchaChallengeType,
  isCaptchaPremiumLevel,
  resolveCaptchaLevel,
  resolveCaptchaMode,
  resolveCaptchaChallengeType,
  captchaLevelSelection,
  resolveCaptchaRequestedPlan,
  resolveCaptchaPlan,
  buildCaptchaChallengeCustomId,
  parseCaptchaChallengeCustomId,
};
