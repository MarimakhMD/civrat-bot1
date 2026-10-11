"use strict";

const { getLogsRuntime } = require("../../logs/runtime/getLogsRuntime");
const { RATE_LIMITS, sharedRateLimitGuard } = require("../../../core/rateLimit/ActionRateLimitGuard");
const { CaptchaSessionStore, CaptchaSessionState } = require("../services/CaptchaSessionStore");
const { CaptchaChallengeService, ChallengeStatus } = require("../services/CaptchaChallengeService");
const { resolveCaptchaEntitlement } = require("../services/captchaEntitlement");
const { captchaChallengeView } = require("./captchaViews");
const {
  CaptchaConfigKey: Key,
  CaptchaComponentId,
  CaptchaMode,
  CAPTCHA_CHALLENGE_DUPLICATE_WINDOW_MS,
  parseCaptchaChallengeCustomId,
  resolveCaptchaSessionSettings,
  resolveCaptchaRequestedPlan,
  resolveCaptchaPlan,
} = require("../configuration/captchaConstants");

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
 * P-CAPT L1 + L3 — flux de vérification sur session.
 *
 * Deux entrées, UNE seule session (aucun système parallèle) :
 *  • ID `VERIFY` simple  → démarrage de session (comportement L1 inchangé) :
 *    en mode bouton le membre est vérifié immédiatement ; en mode challenge
 *    (Premium) un challenge serveur est émis dans la même session ;
 *  • ID `VERIFY:<type>:<challengeId>:<index>` → réponse à un challenge ;
 *    validée côté serveur, dans la session du membre uniquement.
 *
 * Ordre garanti au démarrage :
 *  1. deferUpdate immédiat ; 2. lecture config ; 3. machine à états (section
 *  sans await entre get et create) ; 4. rate-limit P6 puis create ; 5. mode
 *  effectif (entitlement fail-closed) ; 6. log central ; 7. réponse unique.
 */

/** Fabrique des réponses éphémères (codes service en namespace captcha). */
function replyHelpers(context, guildId, memberId) {
  const replyWith = async (code, details = {}) => {
    await context.envelope.transport.reply({
      view: { content: context.t(`captcha.${code}`), components: [] },
      ephemeral: true,
    });
    return { verified: false, code, guildId, memberId, details };
  };
  return { replyWith };
}

/** Lecture de config : jamais fatale (une panne ne bloque pas le membre). */
async function readConfig(configService, guildId) {
  if (!configService || !guildId) return null;
  try {
    return await configService.read(guildId);
  } catch {
    return null;
  }
}

/**
 * Plan effectif du serveur. L'entitlement n'est interrogé QUE pour une
 * expérience Premium demandée : les serveurs Free ne paient aucun aller-retour
 * supplémentaire (aucune régression de latence L1).
 */
async function resolveEffectivePlan({ config, guildId, entitlementService }) {
  const requested = resolveCaptchaRequestedPlan(config || {});
  if (!requested.premium) return resolveCaptchaPlan(config || {}, { granted: false });
  const decision = await resolveCaptchaEntitlement({ guildId, entitlementService });
  return resolveCaptchaPlan(config || {}, { granted: decision.granted });
}

/** Trace centralisée L1 (comportement historique, jamais bloquant). */
async function logCaptchaEvent(member, action, result) {
  if (!member?.guild) return;
  await getLogsRuntime().handleCaptchaEvent({
    guild: member.guild,
    action,
    memberId: result.memberId,
    roleId: result.details?.roleId || null,
  });
}

/**
 * Échec imputable (mauvaise réponse OU échec d'attribution) : mécanique L1
 * strictement conservée — tentatives, cooldown, blocage temporaire.
 */
async function consumeAttempt(context, { store, guildId, memberId, now, settings, result }) {
  if (store && guildId && memberId) {
    const session = store.get(guildId, memberId);
    if (session) {
      const attempts = session.attempts + 1;
      if (attempts >= settings.maxAttempts) {
        store.setState(guildId, memberId, {
          state: CaptchaSessionState.BLOCKED,
          attempts,
          blockedUntil: now + settings.blockMs,
          challenge: null,
          challengeId: null,
          lastAnswer: null,
        });
        await context.envelope.transport.reply({ view: { content: context.t("captcha.CAPTCHA_TOO_MANY_ATTEMPTS"), components: [] }, ephemeral: true });
        return { ...result, blocked: true };
      }
      const nextAttemptAt = now + settings.cooldownMs;
      // Correctif RAID — une tentative consommée doit laisser une fenêtre
      // RÉELLEMENT utilisable. Si le cooldown atteint ou dépasse l'expiration
      // en cours (RAID : 60 s de cooldown pour 1 min d'expiration), la session
      // est prolongée d'UNE fenêtre complète après la fin du cooldown ; sinon
      // l'expiration d'origine est conservée à l'identique (LOW/NORMAL/HIGH
      // inchangés, aucune protection retirée). Bornage : au plus une
      // prolongation par tentative, tentatives elles-mêmes bornées par le
      // preset ou la configuration — jamais de session infinie.
      store.setState(guildId, memberId, {
        state: CaptchaSessionState.FAILED,
        attempts,
        nextAttemptAt,
        expiresAt: session.expiresAt <= nextAttemptAt ? nextAttemptAt + settings.expiryMs : session.expiresAt,
        challenge: null,
        challengeId: null,
        lastAnswer: null,
        pendingFinalization: false,
        pendingFailure: false,
      });
    }
  }
  await context.envelope.transport.reply({ view: { content: context.t(`captcha.${result.code}`), components: [] }, ephemeral: true });
  return result;
}

/**
 * Vérification finale (rôle) : passe TOUJOURS par le service L1.
 * @returns {{resolved: boolean, result: object|null}} `resolved: false` ⇒ échec
 *   imputable, à traiter par l'appelant avec le résultat RÉEL du service.
 */
async function finalizeVerification(context, verificationService, { config, member, guildId, memberId, store, session }) {
  const verificationMember = member
    ? {
        id: member.id,
        roleIds: [...(member.roles?.cache?.keys?.() || [])],
        discordMember: member,
      }
    : null;
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

  const action = result.verified && result.code === "CAPTCHA_VERIFIED"
    ? "captcha_verified"
    : "captcha_verification_failed";
  await logCaptchaEvent(member, action, result);

  if (result.verified) {
    if (session) store.delete(guildId, memberId);
    // P-CAPT L2 — DM de statut « vérifié » (best-effort, jamais un canal de
    // vérification parallèle ; les DM fermés ne bloquent rien).
    if (typeof member?.user?.send === "function") {
      try {
        await member.user.send(context.t("captcha.dmVerified"));
      } catch {
        // DM fermé / refusé : sans gravité.
      }
    }
    await context.envelope.transport.reply({ view: { content: context.t(`captcha.${result.code}`), components: [] }, ephemeral: true });
    return { resolved: true, result };
  }

  if (SYSTEM_CODES.includes(result.code)) {
    // Erreur système/config : la session ne doit jamais pénaliser le membre.
    if (session) store.delete(guildId, memberId);
    await context.envelope.transport.reply({ view: { content: context.t(`captcha.${result.code}`), components: [] }, ephemeral: true });
    return { resolved: true, result };
  }

  return { resolved: false, result }; // échec imputable → tentatives/cooldown
}

/** Émission d'un challenge serveur dans la session du membre (mode challenge). */
async function issueChallenge(context, { store, guildId, memberId, plan, challenges }) {
  const challenge = challenges.generate({ type: plan.challengeType, guildId, memberId });
  store.setState(guildId, memberId, {
    state: CaptchaSessionState.CHALLENGE,
    challengeId: challenge.id,
    challenge,
    lastAnswer: null,
  });
  await context.envelope.transport.reply({ view: captchaChallengeView({ t: context.t, challenge }), ephemeral: true });
  return {
    verified: false,
    code: "CAPTCHA_CHALLENGE_ISSUED",
    guildId,
    memberId,
    pending: true,
    details: {
      level: plan.level,
      mode: plan.mode,
      challengeType: challenge.type,
      premiumFallback: plan.fellBack === true,
    },
  };
}

/**
 * Démarrage de session (clic sur le panneau officiel) — corps L1 + branche L3.
 */
async function startSession(context, verificationService, runtime = {}) {
  const {
    configService = null,
    sessionStore = null,
    rateLimitGuard = null,
    entitlementService = null,
    challenges = null,
    clock = Date.now,
  } = runtime;

  // 1. Accusé de réception immédiat (latence Supabase/Discord).
  await context.envelope.transport.deferUpdate?.();

  const guildId = context.guildId;
  const member = context.envelope?.discordMember ?? null;
  const memberId = context.userId || member?.id || null;
  const { replyWith } = replyHelpers(context, guildId, memberId);

  // Store local isolé si aucun store injecté (tests hors runtime).
  const store = sessionStore || new CaptchaSessionStore({ clock });
  const challengeService = challenges || new CaptchaChallengeService({ clock });

  // 2. Config : réglages (durée/tentatives/cooldown) + transmission à verify.
  const config = await readConfig(configService, guildId);
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
      store.delete(guildId, memberId);
      return replyWith("CAPTCHA_SESSION_EXPIRED");
    }
    if (live) {
      return replyWith("CAPTCHA_SESSION_IN_PROGRESS");
    }
    if (session.state === CaptchaSessionState.BLOCKED) {
      if (session.blockedUntil > now) {
        return replyWith("CAPTCHA_TOO_MANY_ATTEMPTS");
      }
      store.delete(guildId, memberId);
      session = null;
    } else if (session.state === CaptchaSessionState.FAILED) {
      if (session.nextAttemptAt > now) {
        return replyWith("CAPTCHA_COOLDOWN");
      }
      // Cooldown passé : on réutilise la session (tentatives conservées).
    } else {
      store.delete(guildId, memberId);
      session = null;
    }
  }

  // 4. Création : rate-limit P6 (5 créations / 30 s / membre / serveur).
  if (!session && guildId && memberId) {
    const guard = rateLimitGuard || sharedRateLimitGuard;
    const { group, limit, windowMs } = RATE_LIMITS.CAPTCHA;
    const gate = guard.check({ guildId, userId: memberId, group, limit, windowMs });
    if (!gate.allowed) return replyWith("ratelimit.retry");
    guard.record({ guildId, userId: memberId, group, limit, windowMs });
    session = store.create(guildId, memberId, { expiresAt: now + settings.expiryMs });
  }

  // 5. Mode effectif (entitlement fail-closed) : challenge uniquement si accordé.
  const plan = await resolveEffectivePlan({ config, guildId, entitlementService });
  if (plan.mode === CaptchaMode.CHALLENGE && session && guildId && memberId) {
    return issueChallenge(context, { store, guildId, memberId, plan, challenges: challengeService });
  }

  // 5 bis. Mode bouton : validation immédiate L1 (comportement inchangé).
  const final = await finalizeVerification(context, verificationService, { config, member, guildId, memberId, store, session });
  if (final.resolved) return final.result;

  // 6. Échec imputable → tentatives, cooldown, blocage.
  return consumeAttempt(context, { store, guildId, memberId, now, settings, result: final.result });
}

/**
 * Réponse à un challenge (bouton `VERIFY:<type>:<challengeId>:<index>`).
 * Aucune session n'est créée ici : sans session vivante du membre, la réponse
 * est refusée (un panneau périmé ne peut jamais faire contourner l'expiration).
 */
async function handleChallengeAnswer(context, verificationService, runtime) {
  const {
    configService = null,
    sessionStore = null,
    entitlementService = null,
    challenges = null,
    clock = Date.now,
    parsed,
  } = runtime;

  await context.envelope.transport.deferUpdate?.();

  const guildId = context.guildId;
  const member = context.envelope?.discordMember ?? null;
  const memberId = context.userId || member?.id || null;
  const { replyWith } = replyHelpers(context, guildId, memberId);

  const store = sessionStore || new CaptchaSessionStore({ clock });
  const challengeService = challenges || new CaptchaChallengeService({ clock });
  const now = clock();

  // Isolation stricte : la session lue est TOUJOURS celle du membre qui clique.
  if (!guildId || !memberId) return replyWith("CAPTCHA_SESSION_EXPIRED");

  const config = await readConfig(configService, guildId);
  const settings = resolveCaptchaSessionSettings(config || {});

  // Entitlement re-vérifié (fail-closed) AVANT le chemin critique : un droit
  // retiré en cours de session ne laisse jamais consommer une expérience
  // Premium. Placé ici, il ne sépare JAMAIS la lecture d'état de la validation.
  const requested = resolveCaptchaRequestedPlan(config || {});
  if (requested.premium) {
    const decision = await resolveCaptchaEntitlement({ guildId, entitlementService });
    if (!decision.granted) {
      store.delete(guildId, memberId);
      return replyWith("CAPTCHA_SESSION_EXPIRED", { premiumRevoked: true });
    }
  }

  // ── Chemin critique SYNCHRONE : lecture → contrôles → validation → verrou.
  // Aucun await jusqu'au verrou de finalisation : deux réponses concurrentes
  // ne peuvent pas valider deux fois la même session.
  const session = store.get(guildId, memberId);
  if (!session) return replyWith("CAPTCHA_SESSION_EXPIRED");
  if (session.state === CaptchaSessionState.BLOCKED) {
    return session.blockedUntil > now
      ? replyWith("CAPTCHA_TOO_MANY_ATTEMPTS")
      : replyWith("CAPTCHA_SESSION_EXPIRED");
  }
  if (session.expiresAt <= now) {
    store.delete(guildId, memberId);
    return replyWith("CAPTCHA_SESSION_EXPIRED");
  }
  if (session.state === CaptchaSessionState.FAILED) {
    // Nouvelle tentative uniquement via le panneau (nouveau challenge).
    return session.nextAttemptAt > now ? replyWith("CAPTCHA_COOLDOWN") : replyWith("CAPTCHA_SESSION_EXPIRED");
  }
  if (session.state !== CaptchaSessionState.CHALLENGE) return replyWith("CAPTCHA_SESSION_EXPIRED");

  // Verrou SYNCHRONE (posé sans await) : deux clics concurrents sur la même
  // réponse ne peuvent jamais créditer deux fois (deux attributions de rôle ni
  // deux tentatives consommées pour un seul geste).
  if (session.pendingFinalization || session.pendingFailure) {
    return replyWith("CAPTCHA_SESSION_IN_PROGRESS");
  }

  const challenge = session.challenge;
  // Challenge périmé / rejoué / d'un autre membre / d'un autre serveur : refus.
  if (!challenge || challenge.id !== parsed.challengeId || challenge.type !== parsed.type) {
    return replyWith("CAPTCHA_CHALLENGE_STALE", { challengeType: parsed.type });
  }

  // Anti double-clic : une même étape rejouée dans la fenêtre ne crédite rien.
  const last = session.lastAnswer;
  if (last && last.challengeId === challenge.id && last.value === parsed.value && now - last.at <= CAPTCHA_CHALLENGE_DUPLICATE_WINDOW_MS) {
    return replyWith("CAPTCHA_CHALLENGE_DUPLICATE");
  }

  // Validation SYNCHRONE (aucun await) : deux réponses concurrentes ne peuvent
  // pas valider deux fois la même session.
  const outcome = challengeService.validate({ challenge, value: parsed.value });

  if (outcome.status === ChallengeStatus.INVALID) {
    return replyWith("CAPTCHA_CHALLENGE_INVALID", { value: parsed.value });
  }

  if (outcome.status === ChallengeStatus.PROGRESS) {
    store.setState(guildId, memberId, {
      challenge: outcome.challenge,
      lastAnswer: { challengeId: challenge.id, value: parsed.value, at: now },
    });
    await context.envelope.transport.reply({ view: captchaChallengeView({ t: context.t, challenge: outcome.challenge }), ephemeral: true });
    return {
      verified: false,
      code: "CAPTCHA_CHALLENGE_PROGRESS",
      guildId,
      memberId,
      pending: true,
      details: { progress: outcome.challenge.progress, total: outcome.challenge.stepCount },
    };
  }

  if (outcome.status === ChallengeStatus.FAILURE) {
    // Réclamation synchrone : une seule tentative consommée par geste, même
    // si deux clics identiques arrivent dans la même boucle d'événements.
    store.setState(guildId, memberId, {
      lastAnswer: { challengeId: challenge.id, value: parsed.value, at: now },
      pendingFailure: true,
    });
    try {
      await logCaptchaEvent(member, "captcha_verification_failed", { memberId });
    } catch (error) {
      // L'échec de journalisation remonte, mais la session reste utilisable.
      store.setState(guildId, memberId, { pendingFailure: false });
      throw error;
    }
    return consumeAttempt(context, {
      store,
      guildId,
      memberId,
      now,
      settings,
      result: { verified: false, code: "CAPTCHA_CHALLENGE_FAILED", guildId, memberId, details: { challengeType: challenge.type } },
    });
  }

  // SUCCESS → vérification finale par LE service L1 (aucun second système).
  // Le verrou est posé AVANT le premier await de finalisation.
  store.setState(guildId, memberId, {
    pendingFinalization: true,
    lastAnswer: { challengeId: challenge.id, value: parsed.value, at: now },
  });
  let final;
  try {
    final = await finalizeVerification(context, verificationService, { config, member, guildId, memberId, store, session });
  } catch (error) {
    // Échec inattendu : le verrou est levé pour que le membre puisse réessayer.
    store.setState(guildId, memberId, { pendingFinalization: false, lastAnswer: null });
    throw error;
  }
  if (final.resolved) return final.result;

  return consumeAttempt(context, { store, guildId, memberId, now, settings, result: final.result });
}

async function handleCaptchaVerify(context, verificationService, runtime = {}) {
  const customId = context.envelope?.customId;
  const parsed = parseCaptchaChallengeCustomId(customId);
  if (parsed) return handleChallengeAnswer(context, verificationService, { ...runtime, parsed });

  // Charge préfixée mais malformée : réponse de challenge invalide — JAMAIS un
  // démarrage de session implicite (aucune session créée par un ID forgé).
  if (typeof customId === "string" && customId.length > CaptchaComponentId.VERIFY.length && customId.startsWith(CaptchaComponentId.VERIFY)) {
    await context.envelope.transport.deferUpdate?.();
    const guildId = context.guildId;
    const memberId = context.userId || context.envelope?.discordMember?.id || null;
    const { replyWith } = replyHelpers(context, guildId, memberId);
    return replyWith("CAPTCHA_CHALLENGE_INVALID", { malformedCustomId: true });
  }

  return startSession(context, verificationService, runtime);
}

module.exports = { handleCaptchaVerify, SYSTEM_CODES };
