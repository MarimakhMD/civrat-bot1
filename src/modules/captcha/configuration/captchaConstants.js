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
 * lecture : toute valeur absente ou hors-bornes retombe sur ces défauts.
 */
const CaptchaSessionDefaults = Object.freeze({
  EXPIRY_MINUTES: 5,
  ATTEMPTS: 3,
  COOLDOWN_SECONDS: 10,
});

/** Presets de durée (minutes) acceptés par le select DURATION — whitelist. */
const CAPTCHA_DURATION_PRESETS = Object.freeze([1, 5, 10, 15, 30]);

/** Presets [attempts, cooldownSeconds] acceptés par le select LIMITS — whitelist. */
const CAPTCHA_LIMITS_PRESETS = Object.freeze([
  Object.freeze({ attempts: 5, cooldownSeconds: 5 }),
  Object.freeze({ attempts: 3, cooldownSeconds: 10 }),
  Object.freeze({ attempts: 3, cooldownSeconds: 30 }),
  Object.freeze({ attempts: 2, cooldownSeconds: 60 }),
]);

function resolveCaptchaSessionSettings(config) {
  const expiry = Number(config?.[CaptchaConfigKey.EXPIRY_MINUTES]);
  const attempts = Number(config?.[CaptchaConfigKey.ATTEMPTS]);
  const cooldown = Number(config?.[CaptchaConfigKey.COOLDOWN_SECONDS]);
  const expiryMinutes = Number.isFinite(expiry) && expiry > 0 ? expiry : CaptchaSessionDefaults.EXPIRY_MINUTES;
  const maxAttempts = Number.isInteger(attempts) && attempts >= 1 && attempts <= 10 ? attempts : CaptchaSessionDefaults.ATTEMPTS;
  const cooldownSeconds = Number.isFinite(cooldown) && cooldown >= 0 && cooldown <= 600 ? cooldown : CaptchaSessionDefaults.COOLDOWN_SECONDS;
  return Object.freeze({
    expiryMs: expiryMinutes * 60 * 1000,
    maxAttempts,
    cooldownMs: cooldownSeconds * 1000,
    // Blocage temporaire : durée dérivée des réglages (aucune magie).
    blockMs: cooldownSeconds * 1000 * maxAttempts,
  });
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
};
