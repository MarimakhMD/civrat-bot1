"use strict";

const { getLogsRuntime } = require("../../logs/runtime/getLogsRuntime");
const { RATE_LIMITS, sharedRateLimitGuard } = require("../../../core/rateLimit/ActionRateLimitGuard");
const { CaptchaSessionStore, CaptchaSessionState } = require("../services/CaptchaSessionStore");
const { CaptchaConfigKey: Key, resolveCaptchaSessionSettings } = require("../configuration/captchaConstants");

/** Échecs « système / configuration » : n'imputent AUCUNE tentative au membre
 *  et annulent la session (jamais de blocage pour une faute d'admin). */
const SYSTEM_CODES = Object.freeze([
  "CAPTCHA_DISABLED",
  "CAPTCHA_GUILD_OR_MEMBER_MISSING",
  "CAPTCHA_ROLE_NOT_CONFIGURED",
  "CAPTCHA_ROLE_MISSING",
  "CAPTCHA_ROLE_UNMANAGEABLE",
]);

/**
 * P-CAPT L1 — flux Free sur session.
 *
 * Ordre garanti :
 *  1. deferUpdate immédiat ;
 *  2. lecture config (réglages de session) ;
 *  3. machine à états sur la source de vérité (store mémoire) ;
 *  4. création = rate-limit P6 puis create — section SANS await entre le get
 *     et le create : deux clics simultanés ne créent jamais deux sessions ;
 *  5. validation immédiate (mode bouton Free) ;
 *  6. log central existant (comportement inchangé) ;
 *  7. réponse éphémère unique.
 */
async function handleCaptchaVerify(context, verificationService, runtime = {}) {
  const {
    configService = null,
    sessionStore = null,
    rateLimitGuard = null,
    clock = Date.now,
  } = runtime;

  // 1. Accusé de réception immédiat (latence Supabase/Discord).
  await context.envelope.transport.deferUpdate?.();

  const guildId = context.guildId;
  const member = context.envelope?.discordMember ?? null;
  const memberId = context.userId || member?.id || null;
  // Contrat du CaptchaVerificationService : wrapper {id, roleIds, discordMember}
  // (même patron que createCaptchaRuntime pour le reminder).
  const verificationMember = member
    ? {
        id: member.id,
        roleIds: [...(member.roles?.cache?.keys?.() || [])],
        discordMember: member,
      }
    : null;
  const replyKey = async (key) => {
    await context.envelope.transport.reply({ view: { content: context.t(key), components: [] }, ephemeral: true });
    return { verified: false, code: key, guildId, memberId, details: {} };
  };
  // Les codes service/état portent le namespace captcha ; ratelimit.retry est
  // une clé globale du cœur i18n.
  const replyWith = async (code) => {
    const reply = await replyKey(`captcha.${code}`);
    return { ...reply, code };
  };

  // Store local isolé si aucun store injecté (tests hors runtime) : le flux
  // complet reste exécutable, la session disparaît avec l'appel.
  const store = sessionStore || new CaptchaSessionStore({ clock });

  // 2. Config : réglages (durée/tentatives/cooldown) + transmission à verify.
  let config = null;
  if (configService && guildId) {
    try {
      config = await configService.read(guildId);
    } catch {
      config = null;
    }
  }
  const settings = resolveCaptchaSessionSettings(config || {});
  const now = clock();

  // Désactivé (config lue) : refus immédiat, AVANT toute session et tout crédit.
  if (config && Object.prototype.hasOwnProperty.call(config, Key.ENABLED) && !config[Key.ENABLED]) {
    return replyWith("CAPTCHA_DISABLED");
  }

  // 3. Machine à états (aucun await entre le get et le create — anti double-clic).
  let session = guildId && memberId ? store.get(guildId, memberId) : null;
  if (session) {
    const live = session.state === CaptchaSessionState.PENDING || session.state === CaptchaSessionState.CHALLENGE;
    const expirable = live || session.state === CaptchaSessionState.FAILED;
    if (expirable && session.expiresAt <= now) {
      // Toute session non terminée (hors blocage : blockedUntil fait foi) est
      // tuée par l'expiration — jamais réutilisable.
      store.delete(guildId, memberId);
      return replyWith("CAPTCHA_SESSION_EXPIRED");
    }
    if (live) {
      // Double clic / validation en cours : aucun crédit consommé, aucune session créée.
      return replyWith("CAPTCHA_SESSION_IN_PROGRESS");
    }
    if (session.state === CaptchaSessionState.BLOCKED) {
      if (session.blockedUntil > now) {
        return replyWith("CAPTCHA_TOO_MANY_ATTEMPTS");
      }
      // Blocage purgé : nouvelle session autorisée.
      store.delete(guildId, memberId);
      session = null;
    } else if (session.state === CaptchaSessionState.FAILED) {
      if (session.nextAttemptAt > now) {
        return replyWith("CAPTCHA_COOLDOWN");
      }
      // Cooldown passé : on réutilise la session (tentatives conservées), sans recréation.
    } else {
      // SUCCESS/EXPIRED résiduels : le rôle du membre est la vérité, on repart proprement.
      store.delete(guildId, memberId);
      session = null;
    }
  }

  // 4. Création : rate-limit P6 (5 créations / 30 s / membre / serveur).
  if (!session && guildId && memberId) {
    const guard = rateLimitGuard || sharedRateLimitGuard;
    const { group, limit, windowMs } = RATE_LIMITS.CAPTCHA;
    const gate = guard.check({ guildId, userId: memberId, group, limit, windowMs });
    if (!gate.allowed) return replyKey("ratelimit.retry");
    guard.record({ guildId, userId: memberId, group, limit, windowMs });
    session = store.create(guildId, memberId, { expiresAt: now + settings.expiryMs });
  }

  // 5. Validation immédiate (Free : pas de défi en L1).
  let result;
  try {
    result = await verificationService.verify({
      guildId,
      member: verificationMember,
      ...(config ? { config } : {}),
    });
  } catch (error) {
    // Session neuve jamais validée → on la retire pour ne pas bloquer le membre.
    if (session && session.state === CaptchaSessionState.PENDING) store.delete(guildId, memberId);
    throw error;
  }

  // 6. Log central — mapping EXACT du comportement historique (inchangé).
  const action = result.verified && result.code === "CAPTCHA_VERIFIED"
    ? "captcha_verified"
    : "captcha_verification_failed";
  if (member?.guild) {
    await getLogsRuntime().handleCaptchaEvent({
      guild: member.guild,
      action,
      memberId: result.memberId,
      roleId: result.details?.roleId || null,
    });
  }

  // 7. Transition d'état + réponse unique.
  if (result.verified) {
    // SUCCESS = terminal : supprimé (le rôle porte l'état « vérifié »).
    if (session) store.delete(guildId, memberId);
    await context.envelope.transport.reply({ view: { content: context.t(`captcha.${result.code}`), components: [] }, ephemeral: true });
    return result;
  }

  if (SYSTEM_CODES.includes(result.code)) {
    // Erreur système/config : la session ne doit jamais pénaliser le membre.
    if (session) store.delete(guildId, memberId);
    await context.envelope.transport.reply({ view: { content: context.t(`captcha.${result.code}`), components: [] }, ephemeral: true });
    return result;
  }

  // Échec imputable (L1 : échec d'attribution) → tentatives, cooldown, blocage.
  if (session && guildId && memberId) {
    const attempts = session.attempts + 1;
    if (attempts >= settings.maxAttempts) {
      store.setState(guildId, memberId, {
        state: CaptchaSessionState.BLOCKED,
        attempts,
        blockedUntil: now + settings.blockMs,
      });
      await context.envelope.transport.reply({ view: { content: context.t("captcha.CAPTCHA_TOO_MANY_ATTEMPTS"), components: [] }, ephemeral: true });
      return result;
    }
    store.setState(guildId, memberId, {
      state: CaptchaSessionState.FAILED,
      attempts,
      nextAttemptAt: now + settings.cooldownMs,
    });
  }
  await context.envelope.transport.reply({ view: { content: context.t(`captcha.${result.code}`), components: [] }, ephemeral: true });
  return result;
}

module.exports = { handleCaptchaVerify };
