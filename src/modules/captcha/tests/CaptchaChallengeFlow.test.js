"use strict";

// P-CAPT L3 — flux de challenge bout en bout (sessions L1 uniquement) :
// émission, réponses, isolation entre membres, expiration, rejeu, doubles
// clics, blocage et séparation Free/Premium. Aucun accès Discord/Supabase.

const test = require("node:test");
const assert = require("node:assert/strict");
const { handleCaptchaVerify } = require("../interactions/captchaVerifyRoute");
const { CaptchaSessionStore, CaptchaSessionState } = require("../services/CaptchaSessionStore");
const { CaptchaChallengeService } = require("../services/CaptchaChallengeService");
const { CaptchaVerificationService } = require("../services/CaptchaVerificationService");
const {
  CaptchaComponentId: Id,
  CaptchaConfigKey: Key,
  CaptchaLevel,
  CaptchaMode,
  CaptchaChallengeType,
  buildCaptchaChallengeCustomId,
  parseCaptchaChallengeCustomId,
} = require("../configuration/captchaConstants");
const { registerCaptcha } = require("../register");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");

function seededRandomInt(seed = 3) {
  let state = seed >>> 0;
  return (min, max) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return min + (state % (max - min));
  };
}

function seededRandomBytes() {
  let counter = 0;
  return (size) => {
    counter += 1;
    const buffer = Buffer.alloc(size);
    buffer.writeUInt32BE(counter >>> 0, 0);
    return buffer;
  };
}

function buildContext({ guildId = "g", userId = "u", customId = Id.VERIFY } = {}) {
  const replies = [];
  const dms = [];
  let defers = 0;
  const member = {
    id: userId,
    guild: null,
    roles: { cache: new Map(), add: async () => {} },
    user: { send: async (content) => { dms.push(content); } },
  };
  const context = {
    guildId,
    userId,
    t: (key) => key,
    envelope: {
      userId,
      customId,
      values: [],
      discordMember: member,
      transport: {
        deferUpdate: async () => { defers += 1; },
        reply: async (payload) => { replies.push(payload); return payload; },
        update: async (payload) => { replies.push(payload); return payload; },
      },
    },
  };
  return { context, replies, dms, defers: () => defers };
}

/** Vrai service L1 + transport en mémoire : compte les attributions réelles. */
function realService(config, opts = {}) {
  const assigned = [];
  const svc = new CaptchaVerificationService({
    configService: { read: async () => config },
    transport: {
      getRole: async (id) => (opts.roleMissing ? null : { id, managed: false, position: 1 }),
      canManageRole: () => true,
      assignRole: async (_member, role) => {
        if (opts.failAssign) throw new Error("assign failure");
        assigned.push(role?.id || null);
      },
    },
  });
  const calls = [];
  return {
    assigned,
    calls,
    verify: async (input) => { calls.push(input); return svc.verify(input); },
  };
}

const HIGH = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r", [Key.LEVEL]: CaptchaLevel.HIGH };
const RAID = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r", [Key.LEVEL]: CaptchaLevel.RAID };

function harness({ config = HIGH, premium = true, readThrows = false, now = 0 } = {}) {
  const clockState = { now };
  const clock = () => clockState.now;
  const store = new CaptchaSessionStore({ clock });
  const records = [];
  const guard = { check: () => ({ allowed: true }), record: (args) => records.push(args) };
  const challenges = new CaptchaChallengeService({ randomInt: seededRandomInt(11), randomBytes: seededRandomBytes(), clock });
  const entitlementChecks = [];
  const entitlementService = {
    requireFeature: async () => {
      entitlementChecks.push(true);
      return premium
        ? { ok: true, granted: true, code: "ENTITLEMENT_GRANTED" }
        : { ok: true, granted: false, code: "PREMIUM_REQUIRED" };
    },
  };
  const configService = readThrows
    ? { read: async () => { throw new Error("supabase down"); } }
    : { read: async () => ({ ...config }) };
  return {
    store, records, guard, challenges, entitlementChecks, clockState, entitlementService, configService,
    runtime: () => ({ configService, sessionStore: store, rateLimitGuard: guard, challenges, entitlementService, clock }),
  };
}

async function issueChallenge(h, { context, userId = "u" } = {}) {
  context.envelope.customId = Id.VERIFY;
  const result = await handleCaptchaVerify(context, realService({}), h.runtime());
  const session = h.store.get("g", userId);
  return { result, challenge: session?.challenge, session };
}

const answerFor = (challenge, value) => buildCaptchaChallengeCustomId({
  type: challenge.type,
  challengeId: challenge.id,
  value,
});
const wrongIndex = (challenge) => challenge.options.findIndex((_option, position) => position !== challenge.answerIndex);

async function answer(h, context, customId, options = {}) {
  context.envelope.customId = customId;
  return handleCaptchaVerify(context, options.service || realService(options.config || HIGH), h.runtime());
}

test("L3 Premium — le clic sur le panneau émet un challenge serveur dans la session", async () => {
  const h = harness();
  const { context, replies, defers } = buildContext();
  const { result, challenge, session } = await issueChallenge(h, { context });

  assert.equal(result.code, "CAPTCHA_CHALLENGE_ISSUED");
  assert.equal(result.pending, true);
  assert.equal(result.details.premiumFallback, false);
  assert.equal(challenge.type, CaptchaChallengeType.CHOICE, "HIGH : challenge par défaut = choix multiple");
  assert.equal(session.state, CaptchaSessionState.CHALLENGE);
  assert.equal(session.challengeId, challenge.id);
  assert.equal(session.expiresAt, h.clockState.now + 2 * 60_000, "expiration HIGH = 2 minutes (preset)");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].ephemeral, true);
  assert.equal(replies[0].view.components.length, 4, "un bouton par option");
  assert.ok(replies[0].view.components.every((component) => parseCaptchaChallengeCustomId(component.customId).challengeId === challenge.id));
  assert.equal(defers(), 1, "un seul accusé de réception");
  assert.equal(h.records.length, 1, "une seule création de session = un crédit P6");
});

test("L3 Free — un niveau Premium sans entitlement ne sert JAMAIS de challenge", async () => {
  const h = harness({ premium: false });
  const service = realService(HIGH);
  const { context, replies } = buildContext();
  const result = await handleCaptchaVerify(context, service, h.runtime());

  assert.equal(result.verified, true);
  assert.equal(result.code, "CAPTCHA_VERIFIED", "repli bouton : le membre est vérifié normalement");
  assert.equal(replies[0].view.components.length, 0, "aucun challenge émis");
  assert.equal(h.store.size, 0);
  assert.equal(service.assigned.length, 1);
  assert.equal(h.entitlementChecks.length, 1, "le droit a bien été vérifié avant tout repli");

  // Même résultat pour un mode challenge explicitement configuré.
  const modeOnly = harness({ premium: false, config: { [Key.ENABLED]: true, [Key.ROLE_ID]: "r", [Key.MODE]: CaptchaMode.CHALLENGE } });
  const again = buildContext();
  const second = await handleCaptchaVerify(again.context, realService(HIGH), modeOnly.runtime());
  assert.equal(second.code, "CAPTCHA_VERIFIED");
  assert.equal(again.replies[0].view.components.length, 0);
});

test("L3 Premium — réponse correcte : vérification par le service L1, DM, session purgée", async () => {
  const h = harness();
  const { context, replies, dms } = buildContext();
  const service = realService(HIGH);
  const { challenge } = await issueChallenge(h, { context });

  const result = await answer(h, context, answerFor(challenge, challenge.answerIndex), { service });

  assert.equal(result.verified, true);
  assert.equal(result.code, "CAPTCHA_VERIFIED");
  assert.deepEqual(service.assigned, ["r"], "attribution par le service L1 (aucun second système)");
  assert.deepEqual(dms, ["captcha.dmVerified"], "DM de statut « vérifié »");
  assert.equal(replies.at(-1).view.content, "captcha.CAPTCHA_VERIFIED");
  assert.equal(h.store.size, 0, "SUCCESS = terminal");
});

test("L3 Premium — mauvaise réponse : cooldown, tentatives conservées puis blocage (HIGH)", async () => {
  const h = harness({ config: HIGH });
  const { context, replies } = buildContext();
  const service = realService(HIGH);
  const { challenge } = await issueChallenge(h, { context });

  const first = await answer(h, context, answerFor(challenge, wrongIndex(challenge)), { service });
  assert.equal(first.code, "CAPTCHA_CHALLENGE_FAILED");
  assert.equal(replies.at(-1).view.content, "captcha.CAPTCHA_CHALLENGE_FAILED");
  let session = h.store.get("g", "u");
  assert.equal(session.state, CaptchaSessionState.FAILED);
  assert.equal(session.attempts, 1);
  assert.equal(session.nextAttemptAt, h.clockState.now + 30_000, "cooldown HIGH = 30 s");
  assert.equal(service.assigned.length, 0);

  // Nouveau clic pendant le cooldown : refus, aucune nouvelle tentative.
  context.envelope.customId = Id.VERIFY;
  const during = await handleCaptchaVerify(context, service, h.runtime());
  assert.equal(during.code, "CAPTCHA_COOLDOWN");
  assert.equal(h.store.get("g", "u").attempts, 1);

  // Après le cooldown : nouveau challenge DANS la même session (2 min > 30 s),
  // tentatives conservées.
  h.clockState.now += 30_001;
  const second = await issueChallenge(h, { context });
  assert.equal(second.result.code, "CAPTCHA_CHALLENGE_ISSUED");
  assert.notEqual(second.challenge.id, challenge.id, "nouveau challenge à chaque tentative");
  assert.equal(second.session.attempts, 1, "les tentatives ne sont jamais remises à zéro");

  // Tentative 2, puis tentative 3 = blocage (HIGH : 3 tentatives).
  const secondFail = await answer(h, context, answerFor(second.challenge, wrongIndex(second.challenge)), { service });
  assert.equal(secondFail.code, "CAPTCHA_CHALLENGE_FAILED");
  h.clockState.now += 30_001;
  const third = await issueChallenge(h, { context });
  const thirdFail = await answer(h, context, answerFor(third.challenge, wrongIndex(third.challenge)), { service });
  assert.equal(thirdFail.code, "CAPTCHA_CHALLENGE_FAILED");
  session = h.store.get("g", "u");
  assert.equal(session.state, CaptchaSessionState.BLOCKED);
  assert.equal(session.attempts, 3, "HIGH = 3 tentatives maximum");
  assert.equal(session.blockedUntil, h.clockState.now + 90_000, "blocage = cooldown × tentatives");
  assert.equal(replies.at(-1).view.content, "captcha.CAPTCHA_TOO_MANY_ATTEMPTS");

  context.envelope.customId = Id.VERIFY;
  const blocked = await handleCaptchaVerify(context, service, h.runtime());
  assert.equal(blocked.code, "CAPTCHA_TOO_MANY_ATTEMPTS");
  assert.equal(service.assigned.length, 0, "aucune sanction, aucune attribution");
});

test("RAID — correctif : les 2 tentatives sont réellement utilisables et le blocage s'arme", async () => {
  const h = harness({ config: RAID });
  const { context } = buildContext();
  const service = realService(RAID);
  const { challenge } = await issueChallenge(h, { context }); // t = 0

  let session = h.store.get("g", "u");
  assert.equal(session.expiresAt, 60_000, "fenêtre RAID = 1 min à la création");

  // Tentative 1 échouée : la session est prolongée d'une fenêtre APRÈS le
  // cooldown (sans quoi la 2e tentative serait impossible — défaut corrigé).
  const fail1 = await answer(h, context, answerFor(challenge, wrongIndex(challenge)), { service });
  assert.equal(fail1.code, "CAPTCHA_CHALLENGE_FAILED");
  session = h.store.get("g", "u");
  assert.equal(session.state, CaptchaSessionState.FAILED);
  assert.equal(session.attempts, 1);
  assert.equal(session.nextAttemptAt, 60_000, "cooldown RAID = 60 s");
  assert.equal(session.expiresAt, 120_000, "prolongation : fin du cooldown + une fenêtre complète");
  assert.equal(session.blockedUntil, 0, "aucune sanction automatique");

  // Pendant le cooldown : refus, aucune tentative consommée.
  context.envelope.customId = Id.VERIFY;
  assert.equal((await handleCaptchaVerify(context, service, h.runtime())).code, "CAPTCHA_COOLDOWN");
  assert.equal(h.store.get("g", "u").attempts, 1);

  // Fin du cooldown : la 2e tentative est RÉELLEMENT possible, dans la MÊME
  // session, avec le compteur conservé.
  h.clockState.now = 60_000;
  context.envelope.customId = Id.VERIFY;
  const second = await handleCaptchaVerify(context, service, h.runtime());
  assert.equal(second.code, "CAPTCHA_CHALLENGE_ISSUED", "2e tentative disponible dans la même session");
  session = h.store.get("g", "u");
  assert.equal(session.attempts, 1, "les tentatives ne sont jamais remises à zéro");
  assert.equal(session.state, CaptchaSessionState.CHALLENGE);

  // Tentative 2 échouée → blocage temporaire (les échecs répétés sont détectés).
  const fail2 = await answer(h, context, answerFor(session.challenge, wrongIndex(session.challenge)), { service });
  assert.equal(fail2.code, "CAPTCHA_CHALLENGE_FAILED");
  session = h.store.get("g", "u");
  assert.equal(session.state, CaptchaSessionState.BLOCKED);
  assert.equal(session.attempts, 2, "RAID = 2 tentatives maximum");
  assert.equal(session.blockedUntil, 180_000, "blocage temporaire = cooldown × tentatives");

  // Pendant le blocage : refus (clic panneau ET réponse de challenge).
  context.envelope.customId = Id.VERIFY;
  assert.equal((await handleCaptchaVerify(context, service, h.runtime())).code, "CAPTCHA_TOO_MANY_ATTEMPTS");
  assert.equal(
    (await answer(h, context, `${Id.VERIFY}:CHOICE:deadbeef:0`, { service })).code,
    "CAPTCHA_TOO_MANY_ATTEMPTS",
  );

  // Après le blocage : session neuve, vérification possible, aucune sanction.
  h.clockState.now = 180_001;
  context.envelope.customId = Id.VERIFY;
  const after = await handleCaptchaVerify(context, service, h.runtime());
  assert.equal(after.code, "CAPTCHA_CHALLENGE_ISSUED", "le blocage n'est jamais définitif");
  session = h.store.get("g", "u");
  assert.equal(session.attempts, 0, "session neuve après purge du blocage");
  const ok = await answer(h, context, answerFor(session.challenge, session.challenge.answerIndex), { service });
  assert.equal(ok.code, "CAPTCHA_VERIFIED");
  assert.deepEqual(service.assigned, ["r"], "une seule attribution : aucun ban/kick automatique");
  assert.equal(h.store.size, 0);
  assert.equal(h.records.length, 2, "2 sessions créées = 2 crédits P6 (la réutilisation ne crédite jamais)");
});

test("RAID — l'expiration reste effective au-delà de la fenêtre prolongée (P6 respecté)", async () => {
  const h = harness({ config: RAID });
  const { context } = buildContext();
  const service = realService(RAID);
  const { challenge } = await issueChallenge(h, { context });
  await answer(h, context, answerFor(challenge, wrongIndex(challenge)), { service });
  assert.equal(h.store.get("g", "u").expiresAt, 120_000);

  // Un clic au-delà de la fenêtre prolongée : session close, rien n'est crédité.
  h.clockState.now = 120_001;
  context.envelope.customId = Id.VERIFY;
  const expired = await handleCaptchaVerify(context, service, h.runtime());
  assert.equal(expired.code, "CAPTCHA_SESSION_EXPIRED");
  assert.equal(h.store.size, 0, "session expirée purgée");
  assert.equal(service.assigned.length, 0);

  // Une réponse tardive au challenge est refusée de la même façon.
  const late = await answer(h, context, answerFor(challenge, challenge.answerIndex), { service });
  assert.equal(late.code, "CAPTCHA_SESSION_EXPIRED");
  assert.equal(service.assigned.length, 0, "aucun contournement par une réponse tardive");

  // Nouvelle session propre : compteur neuf + nouveau crédit P6.
  const fresh = await issueChallenge(h, { context });
  assert.equal(fresh.result.code, "CAPTCHA_CHALLENGE_ISSUED");
  assert.equal(fresh.session.attempts, 0, "nouvelle session = compteur neuf");
  assert.equal(h.records.length, 2, "chaque création de session reste soumise au rate-limit P6");
  const ok = await answer(h, context, answerFor(fresh.challenge, fresh.challenge.answerIndex), { service });
  assert.equal(ok.code, "CAPTCHA_VERIFIED");
});

test("RAID — chemin bouton : la même mécanique prolonge après un échec d'attribution", async () => {
  const config = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r", [Key.LEVEL]: CaptchaLevel.RAID, [Key.MODE]: CaptchaMode.BUTTON };
  const h = harness({ config });
  const { context } = buildContext();
  const failer = realService(config, { failAssign: true });
  context.envelope.customId = Id.VERIFY;

  const first = await handleCaptchaVerify(context, failer, h.runtime());
  assert.equal(first.code, "CAPTCHA_ASSIGNMENT_FAILED");
  let session = h.store.get("g", "u");
  assert.equal(session.state, CaptchaSessionState.FAILED);
  assert.equal(session.attempts, 1);
  assert.equal(session.expiresAt, 120_000, "prolongation identique au chemin challenge");

  h.clockState.now = 60_000;
  const second = await handleCaptchaVerify(context, failer, h.runtime());
  assert.equal(second.code, "CAPTCHA_ASSIGNMENT_FAILED", "la 2e tentative atteint bien le service L1");
  session = h.store.get("g", "u");
  assert.equal(session.state, CaptchaSessionState.BLOCKED);
  assert.equal(session.attempts, 2);
  assert.equal(session.blockedUntil, 180_000);
  assert.equal(failer.calls.length, 2, "deux validations réelles, aucune boucle");
});

test("LOW/NORMAL/HIGH — aucune prolongation : l'expiration d'origine est conservée", async () => {
  // NORMAL (défauts L1) : échec d'attribution → fenêtre 5 min intacte.
  const config = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r" };
  const normal = harness({ config });
  const normalCtx = buildContext();
  normalCtx.context.envelope.customId = Id.VERIFY;
  const failed = await handleCaptchaVerify(normalCtx.context, realService(config, { failAssign: true }), normal.runtime());
  assert.equal(failed.code, "CAPTCHA_ASSIGNMENT_FAILED");
  assert.equal(normal.store.get("g", "u").expiresAt, 300_000, "NORMAL : expiration inchangée (5 min depuis la création)");
  normal.clockState.now = 300_001;
  assert.equal(
    (await handleCaptchaVerify(normalCtx.context, realService(config), normal.runtime())).code,
    "CAPTCHA_SESSION_EXPIRED",
    "la protection d'expiration L1 reste intacte",
  );

  // HIGH : cooldown 30 s < expiration 2 min → aucune prolongation non plus.
  const high = harness({ config: HIGH });
  const highCtx = buildContext();
  const service = realService(HIGH);
  const { challenge } = await issueChallenge(high, { context: highCtx.context });
  await answer(high, highCtx.context, answerFor(challenge, wrongIndex(challenge)), { service });
  assert.equal(high.store.get("g", "u").nextAttemptAt, 30_000);
  assert.equal(high.store.get("g", "u").expiresAt, 120_000, "HIGH : expiration inchangée (2 min depuis la création)");
});

test("L3 Premium — isolation stricte : le challenge d'un autre membre est inutilisable", async () => {
  const h = harness();
  const a = buildContext({ userId: "alice" });
  const b = buildContext({ userId: "bob" });
  const service = realService(HIGH);
  const { challenge } = await issueChallenge(h, { context: a.context, userId: "alice" });

  // Bob n'a aucune session : la réponse d'Alice ne peut pas la créer.
  const stolen = await answer(h, b.context, answerFor(challenge, challenge.answerIndex), { service });
  assert.equal(stolen.code, "CAPTCHA_SESSION_EXPIRED");
  assert.equal(service.assigned.length, 0);
  assert.equal(h.store.get("g", "alice").state, CaptchaSessionState.CHALLENGE, "la session d'Alice est intacte");
  assert.equal(h.store.get("g", "bob"), undefined);

  // Bob avec sa propre session ne peut pas valider le challenge d'Alice.
  const bobIssued = await issueChallenge(h, { context: b.context, userId: "bob" });
  const cross = await answer(h, b.context, answerFor(challenge, challenge.answerIndex), { service });
  assert.equal(cross.code, "CAPTCHA_CHALLENGE_STALE");
  assert.equal(service.assigned.length, 0);
  assert.equal(h.store.get("g", "bob").challengeId, bobIssued.challenge.id);

  // Puis Bob réussit SON challenge : l'isolation n'a rien cassé.
  const ok = await answer(h, b.context, answerFor(bobIssued.challenge, bobIssued.challenge.answerIndex), { service });
  assert.equal(ok.code, "CAPTCHA_VERIFIED");
  assert.deepEqual(service.assigned, ["r"]);
});

test("L3 Premium — expiration : réponse refusée, session purgée, rien n'est crédité", async () => {
  const h = harness();
  const { context } = buildContext();
  const service = realService(HIGH);
  const { challenge } = await issueChallenge(h, { context });

  h.clockState.now += 2 * 60_000 + 1; // au-delà de l'expiration HIGH
  const late = await answer(h, context, answerFor(challenge, challenge.answerIndex), { service });
  assert.equal(late.code, "CAPTCHA_SESSION_EXPIRED");
  assert.equal(h.store.size, 0, "session expirée purgée, jamais réutilisable");
  assert.equal(service.assigned.length, 0);

  // Le panneau reste la seule reprise : nouveau clic = nouvelle session.
  const restart = await issueChallenge(h, { context });
  assert.equal(restart.result.code, "CAPTCHA_CHALLENGE_ISSUED");
  assert.notEqual(restart.challenge.id, challenge.id);
});

test("L3 Premium — rejeu : un ancien challenge ne valide plus la session", async () => {
  const h = harness();
  const { context } = buildContext();
  const service = realService(HIGH);
  const { challenge: first } = await issueChallenge(h, { context });
  const firstAnswer = answerFor(first, first.answerIndex);

  // Échec sur le premier challenge, puis nouveau challenge après cooldown.
  await answer(h, context, answerFor(first, wrongIndex(first)), { service });
  h.clockState.now += 30_001;
  const { challenge: second } = await issueChallenge(h, { context });
  assert.notEqual(second.id, first.id);

  // Le bouton de l'ANCIEN challenge est rejoué : refus, aucun crédit.
  const replayed = await answer(h, context, firstAnswer, { service });
  assert.equal(replayed.code, "CAPTCHA_CHALLENGE_STALE");
  assert.equal(service.assigned.length, 0);
  const session = h.store.get("g", "u");
  assert.equal(session.state, CaptchaSessionState.CHALLENGE);
  assert.equal(session.challengeId, second.id, "le challenge courant n'est jamais remplacé par un rejeu");
  assert.equal(session.attempts, 1);

  // Le challenge courant, lui, fonctionne.
  const ok = await answer(h, context, answerFor(second, second.answerIndex), { service });
  assert.equal(ok.code, "CAPTCHA_VERIFIED");
});

test("L3 Premium — double clic ORDER : étape rejouée sans effet, fin unique", async () => {
  const h = harness({ config: { ...HIGH, [Key.CHALLENGE]: CaptchaChallengeType.ORDER } });
  const { context, replies } = buildContext();
  const service = realService(HIGH);
  const { challenge } = await issueChallenge(h, { context });
  assert.equal(challenge.type, CaptchaChallengeType.ORDER);
  assert.equal(challenge.answerOrder.length, 4);

  const firstStep = answerFor(challenge, challenge.answerOrder[0]);
  const progress = await answer(h, context, firstStep, { service });
  assert.equal(progress.code, "CAPTCHA_CHALLENGE_PROGRESS");
  assert.equal(progress.details.progress, 1);
  assert.equal(h.store.get("g", "u").challenge.progress, 1);

  // Double clic sur la même étape : ignoré, aucune progression perdue.
  const duplicate = await answer(h, context, firstStep, { service });
  assert.equal(duplicate.code, "CAPTCHA_CHALLENGE_DUPLICATE");
  assert.equal(replies.at(-1).view.content, "captcha.CAPTCHA_CHALLENGE_DUPLICATE");
  assert.equal(h.store.get("g", "u").challenge.progress, 1);
  assert.equal(h.store.get("g", "u").attempts, 0, "un double clic ne consomme jamais de tentative");

  // Suite du défi : les étapes restantes mènent à UNE vérification.
  let session = h.store.get("g", "u");
  for (const step of challenge.answerOrder.slice(1)) {
    const outcome = await answer(h, context, answerFor(session.challenge, step), { service });
    session = h.store.get("g", "u") || session;
    if (outcome.code === "CAPTCHA_VERIFIED") break;
    assert.equal(outcome.code, "CAPTCHA_CHALLENGE_PROGRESS");
  }
  assert.deepEqual(service.assigned, ["r"], "une seule attribution pour tout le défi");
  assert.equal(h.store.size, 0);
});

test("L3 Premium — doubles clics concurrents sur la bonne réponse : une seule attribution", async () => {
  const h = harness();
  const { context } = buildContext();
  const service = realService(HIGH);
  const { challenge } = await issueChallenge(h, { context });
  const correct = answerFor(challenge, challenge.answerIndex);

  context.envelope.customId = correct;
  const [first, second] = await Promise.all([
    handleCaptchaVerify(context, service, h.runtime()),
    handleCaptchaVerify(context, service, h.runtime()),
  ]);

  const codes = [first.code, second.code].sort();
  assert.equal(codes.filter((code) => code === "CAPTCHA_VERIFIED").length, 1, "un seul clic aboutit");
  assert.ok(
    codes.includes("CAPTCHA_SESSION_IN_PROGRESS") || codes.includes("CAPTCHA_SESSION_EXPIRED"),
    `le second clic est refusé sans crédit (codes: ${codes.join(", ")})`,
  );
  assert.equal(service.assigned.length, 1, "jamais deux attributions de rôle");
  assert.equal(service.calls.length, 1, "le service L1 n'est appelé qu'une fois");
  assert.equal(h.store.size, 0);
});

test("L3 Premium — doubles clics concurrents sur une mauvaise réponse : une seule tentative", async () => {
  const h = harness();
  const { context } = buildContext();
  const service = realService(HIGH);
  const { challenge } = await issueChallenge(h, { context });
  const wrong = answerFor(challenge, wrongIndex(challenge));

  context.envelope.customId = wrong;
  const results = await Promise.all([
    handleCaptchaVerify(context, service, h.runtime()),
    handleCaptchaVerify(context, service, h.runtime()),
  ]);

  const session = h.store.get("g", "u");
  assert.equal(session.attempts, 1, "un seul geste = une seule tentative consommée");
  assert.ok(results.some((result) => result.code === "CAPTCHA_CHALLENGE_FAILED"));
  assert.ok(
    results.every((result) => result.code === "CAPTCHA_CHALLENGE_FAILED" || result.code === "CAPTCHA_SESSION_IN_PROGRESS"),
    `le second clic est refusé sans crédit (codes: ${results.map((r) => r.code).join(", ")})`,
  );
  assert.equal(session.pendingFailure, false, "le verrou d'échec est levé après imputation");
  assert.equal(session.state, CaptchaSessionState.FAILED);
});

test("L3 Premium — entitlement retiré en cours de session : refus fail-closed", async () => {
  const h = harness();
  const { context } = buildContext();
  const service = realService(HIGH);
  const { challenge } = await issueChallenge(h, { context });
  assert.equal(h.store.get("g", "u").state, CaptchaSessionState.CHALLENGE);

  // Le droit Premium disparaît entre l'émission et la réponse.
  const revoked = { requireFeature: async () => ({ ok: true, granted: false, code: "PREMIUM_REQUIRED" }) };
  context.envelope.customId = answerFor(challenge, challenge.answerIndex);
  const result = await handleCaptchaVerify(context, service, { ...h.runtime(), entitlementService: revoked });

  assert.equal(result.code, "CAPTCHA_SESSION_EXPIRED");
  assert.equal(result.details.premiumRevoked, true);
  assert.equal(service.assigned.length, 0, "aucune vérification servie sans droit");
  assert.equal(h.store.size, 0);

  // Le membre reste libre : un nouveau clic repart en mode bouton (Free).
  context.envelope.customId = Id.VERIFY;
  const fallback = await handleCaptchaVerify(context, service, { ...h.runtime(), entitlementService: null });
  assert.equal(fallback.code, "CAPTCHA_VERIFIED", "repli bouton immédiat, aucune session incohérente");
});

test("L3 Premium — charge malformée : jamais de session créée implicitement", async () => {
  const h = harness();
  const { context, replies } = buildContext({ userId: "forger" });
  const service = realService(HIGH);

  for (const customId of [
    `${Id.VERIFY}:CHOICE:deadbeef:0:extra`,
    `${Id.VERIFY}:FOURTH:deadbeef:0`,
    `${Id.VERIFY}:CHOICE:DEADBEEF:0`,
    `${Id.VERIFY}:CHOICE:deadbeef:x`,
    `${Id.VERIFY}:`,
  ]) {
    context.envelope.customId = customId;
    const result = await handleCaptchaVerify(context, service, h.runtime());
    assert.equal(result.code, "CAPTCHA_CHALLENGE_INVALID", `${customId}: refus explicite`);
    assert.equal(result.details.malformedCustomId, true);
  }
  assert.equal(h.store.size, 0, "aucune session créée par un ID forgé");
  assert.equal(h.records.length, 0, "aucun crédit P6 consommé");
  assert.equal(service.assigned.length, 0);
  assert.ok(replies.every((reply) => reply.ephemeral === true));
});

test("L3 Premium — réponse invalide : la session reste utilisable, aucune tentative consommée", async () => {
  const h = harness();
  const { context } = buildContext();
  const service = realService(HIGH);
  const { challenge } = await issueChallenge(h, { context });

  const invalid = await answer(h, context, answerFor(challenge, 99), { service });
  assert.equal(invalid.code, "CAPTCHA_CHALLENGE_INVALID");
  assert.equal(h.store.get("g", "u").attempts, 0);
  assert.equal(h.store.get("g", "u").state, CaptchaSessionState.CHALLENGE);

  const unknownType = await answer(h, context, `civrat:v1:captcha:verify:ORDER:${challenge.id}:0`, { service });
  assert.equal(unknownType.code, "CAPTCHA_CHALLENGE_STALE", "un type incohérent avec la session est refusé");

  const ok = await answer(h, context, answerFor(challenge, challenge.answerIndex), { service });
  assert.equal(ok.code, "CAPTCHA_VERIFIED");
});

test("L3 Premium — P6 non contourné : pas de session, pas de challenge", async () => {
  const h = harness();
  const denying = { check: () => ({ allowed: false }), record: () => { throw new Error("aucun crédit attendu"); } };
  const { context } = buildContext();
  context.envelope.customId = Id.VERIFY;

  const result = await handleCaptchaVerify(context, realService(HIGH), { ...h.runtime(), rateLimitGuard: denying });
  assert.equal(result.code, "ratelimit.retry");
  assert.equal(h.store.size, 0, "aucune session, donc aucun challenge");
  assert.match(context.t("captcha.ratelimit.retry"), /ratelimit/);

  // Une réponse de challenge ne consomme jamais de crédit P6.
  const { context: second } = buildContext({ userId: "carol" });
  const { challenge } = await issueChallenge(h, { context: second, userId: "carol" });
  const recordsBefore = h.records.length;
  await answer(h, second, answerFor(challenge, challenge.answerIndex), { service: realService(HIGH) });
  assert.equal(h.records.length, recordsBefore, "le crédit ne concerne que la création de session");
});

test("L3 Premium — config indisponible : repli bouton, aucune erreur bloquante", async () => {
  const h = harness({ readThrows: true });
  const { context, replies } = buildContext();
  const result = await handleCaptchaVerify(context, realService(HIGH), h.runtime());

  assert.equal(result.verified, true);
  assert.equal(result.code, "CAPTCHA_VERIFIED");
  assert.equal(replies[0].view.components.length, 0, "aucun challenge sans config lue");
  assert.equal(h.entitlementChecks.length, 0, "aucun appel entitlement inutile");
});

test("L3 — registre : la route VERIFY (prefix) porte panneau et réponses, +3 selects", async () => {
  const registry = new InteractionRegistry();
  const service = { read: async () => ({ ...HIGH }), update: async (_g, patch) => patch };
  registerCaptcha({
    registry,
    service,
    verificationServiceFactory: () => ({ verify: async () => ({ verified: true, code: "CAPTCHA_VERIFIED", guildId: "g", memberId: "u", details: {} }) }),
    settingsHome: async () => {},
    entitlementService: null,
  });

  const panelRoute = registry.find({ kind: "button", customId: Id.VERIFY });
  const answerRoute = registry.find({ kind: "button", customId: `${Id.VERIFY}:CHOICE:deadbeef:2` });
  assert.ok(panelRoute, "le panneau officiel route toujours le clic simple");
  assert.equal(answerRoute, panelRoute, "les réponses de challenge passent par LA MÊME route (aucune route fictive)");
  assert.equal(panelRoute.matcher.type, "prefix");
  assert.deepEqual(panelRoute.permissions.allOf, [], "route permission-free inchangée (compteur de routes free stable)");

  for (const id of [Id.LEVEL, Id.MODE, Id.CHALLENGE]) {
    const route = registry.find({ kind: "select-menu", customId: id });
    assert.ok(route, `${id}: select enregistré`);
    assert.deepEqual(route.permissions.allOf, [PermissionName.MANAGE_GUILD], "réglages réservés aux admins");
  }

  // Le clic simple via le registre émet bien un challenge (mode HIGH + droit).
  const registryGranted = new InteractionRegistry();
  registerCaptcha({
    registry: registryGranted,
    service,
    verificationServiceFactory: () => ({ verify: async () => ({ verified: true, code: "CAPTCHA_VERIFIED", guildId: "g", memberId: "u", details: {} }) }),
    settingsHome: async () => {},
    entitlementService: { requireFeature: async () => ({ ok: true, granted: true, code: "ENTITLEMENT_GRANTED" }) },
  });
  const replies = [];
  const result = await registryGranted.find({ kind: "button", customId: Id.VERIFY }).execute({
    guildId: "g",
    userId: "u",
    t: (key) => key,
    envelope: {
      userId: "u",
      customId: Id.VERIFY,
      values: [],
      discordMember: { id: "u", guild: null, roles: { cache: new Map(), add: async () => {} }, user: { send: async () => {} } },
      transport: { deferUpdate: async () => {}, reply: async (payload) => { replies.push(payload); }, update: async () => {} },
    },
  });
  assert.equal(result.code, "CAPTCHA_CHALLENGE_ISSUED");
  assert.equal(replies[0].view.components.length, 4);
});
