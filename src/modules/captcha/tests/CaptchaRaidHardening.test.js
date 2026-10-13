"use strict";

/**
 * P-CAPT L5 — durcissement pendant un raid.
 *
 * Réutilise le moteur anti-raid EXISTANT en lecture seule (`raidSignal` = peek
 * de `SecurityRaidService.check()`), activé par `security_anti_raid`.
 *
 * Ce fichier vérifie :
 *  • l'axe A — tous les serveurs (Free compris) : pendant un raid, limites du
 *    preset RAID (2 tentatives / 60 s / 1 min / blocage 120 s), règle MONOTONE
 *    (une configuration plus stricte n'est jamais assouplie) ;
 *  • l'axe B — Premium uniquement : niveau RAID (challenge) si l'entitlement
 *    est accordé, sinon repli standard fail-closed, jamais un challenge
 *    Premium sans droit ;
 *  • le retour AUTOMATIQUE et EXACT à la configuration dès la fin du raid ;
 *  • la sémantique d'une session ouverte AVANT le raid : expiration initiale
 *    conservée à l'identique, tentatives et cooldown durcis pendant l'incident,
 *    retour aux valeurs configurées ensuite — la durée d'une minute ne vaut que
 *    pour les sessions créées PENDANT le raid (aucune garantie rétroactive) ;
 *  • l'absence totale d'écriture de configuration, d'état persistant et de
 *    second moteur (aucune exception propagée, isolation par guild_id) ;
 *  • le câblage réel via `registerCaptcha` (route VERIFY).
 */

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
  CaptchaRaidHardening,
  hardenCaptchaSessionSettings,
  resolveCaptchaSessionSettings,
  buildCaptchaChallengeCustomId,
} = require("../configuration/captchaConstants");
const { registerCaptcha } = require("../register");
const { InteractionRegistry } = require("../../../core/interactions");

function seededRandomInt(seed = 5) {
  let state = seed >>> 0;
  return (min, max) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return min + (state % (max - min));
  };
}

function seededRandomBytes() {
  let counter = 0;
  return (size) => {
    const buffer = Buffer.alloc(size);
    buffer.writeUInt32BE(counter += 1, 0);
    return buffer;
  };
}

/** Contexte d'interaction minimal (member.guild absent ⇒ aucun log distant). */
function buildContext({ guildId = "g", userId = "u", customId = Id.VERIFY } = {}) {
  const replies = [];
  let defers = 0;
  const member = {
    id: userId,
    guild: null,
    roles: { cache: new Map(), add: async () => {} },
    user: { send: async () => {} },
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
  return { context, replies, defers: () => defers };
}

/** Service de vérification réel, transport en mémoire. */
function realService(config, opts = {}) {
  const transport = {
    getRole: async (id) => (opts.roleMissing ? null : { id, managed: false, position: 1 }),
    canManageRole: () => !opts.unmanageable,
    assignRole: async () => { if (opts.failAssign) throw new Error("assign failure"); },
  };
  return new CaptchaVerificationService({ configService: { read: async () => config }, transport });
}

const NORMAL_CONFIG = Object.freeze({ [Key.ENABLED]: true, [Key.ROLE_ID]: "r" });
const HIGH_CONFIG = Object.freeze({ [Key.ENABLED]: true, [Key.ROLE_ID]: "r", [Key.LEVEL]: CaptchaLevel.HIGH, [Key.MODE]: CaptchaMode.CHALLENGE });

function harness({ config = NORMAL_CONFIG, premium = null, raid = false, raidSignal = null, now = 0 } = {}) {
  const clockState = { now };
  const clock = () => clockState.now;
  const store = new CaptchaSessionStore({ clock });
  const records = [];
  const guard = { check: () => ({ allowed: true }), record: (args) => records.push(args) };
  const challenges = new CaptchaChallengeService({ randomInt: seededRandomInt(7), randomBytes: seededRandomBytes(), clock });
  const entitlementChecks = [];
  const entitlementService = premium === null
    ? null
    : {
        requireFeature: async () => {
          entitlementChecks.push(true);
          return premium
            ? { ok: true, granted: true, code: "ENTITLEMENT_GRANTED" }
            : { ok: true, granted: false, code: "PREMIUM_REQUIRED" };
        },
      };
  const raidState = { active: raid, calls: 0 };
  const updates = [];
  const configService = {
    read: async () => ({ ...config }),
    update: async (_guildId, patch) => { updates.push(patch); return { ...config, ...patch }; },
  };
  const signal = raidSignal || ((guildId) => { raidState.calls += 1; return guildId === "g-calme" ? false : raidState.active; });
  return {
    store,
    records,
    guard,
    challenges,
    entitlementChecks,
    entitlementService,
    raidState,
    updates,
    clockState,
    configService,
    runtime: () => ({
      configService,
      sessionStore: store,
      rateLimitGuard: guard,
      challenges,
      entitlementService,
      raidSignal: signal,
      clock,
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// Règle monotone du durcissement
// ─────────────────────────────────────────────────────────────

test("L5 — le durcissement applique exactement le preset RAID (2 / 60 s / 1 min / blocage 120 s)", () => {
  const normal = resolveCaptchaSessionSettings({ [Key.LEVEL]: CaptchaLevel.NORMAL });
  assert.deepEqual(
    { expiryMs: normal.expiryMs, maxAttempts: normal.maxAttempts, cooldownMs: normal.cooldownMs, blockMs: normal.blockMs },
    { expiryMs: 300_000, maxAttempts: 3, cooldownMs: 10_000, blockMs: 30_000 },
    "référence NORMAL non durcie",
  );

  const hardened = hardenCaptchaSessionSettings(normal);
  assert.equal(hardened.maxAttempts, CaptchaRaidHardening.ATTEMPTS);
  assert.equal(hardened.cooldownMs, CaptchaRaidHardening.COOLDOWN_SECONDS * 1000);
  assert.equal(hardened.expiryMs, CaptchaRaidHardening.EXPIRY_MINUTES * 60 * 1000);
  assert.equal(hardened.blockMs, 120_000, "cooldown × tentatives");
  assert.equal(hardened.hardened, true);
});

test("L5 — règle MONOTONE : une configuration plus stricte que le preset RAID est conservée", () => {
  const strict = hardenCaptchaSessionSettings({ expiryMs: 30_000, maxAttempts: 1, cooldownMs: 180_000, blockMs: 180_000 });
  assert.deepEqual(
    { expiryMs: strict.expiryMs, maxAttempts: strict.maxAttempts, cooldownMs: strict.cooldownMs },
    { expiryMs: 30_000, maxAttempts: 1, cooldownMs: 180_000 },
    "aucun assouplissement : min(cooldown) ni max(tentatives)",
  );
  assert.equal(strict.blockMs, 180_000, "blocage recalculé sur les valeurs conservées");

  const floored = hardenCaptchaSessionSettings({ expiryMs: 600_000, maxAttempts: 0, cooldownMs: 0, blockMs: 0 });
  assert.equal(floored.maxAttempts, 1, "jamais moins d'une tentative");
  assert.equal(floored.cooldownMs, 60_000);
  assert.equal(floored.expiryMs, 60_000);
  assert.equal(floored.blockMs, 60_000);
});

// ─────────────────────────────────────────────────────────────
// Axe A — tous les serveurs, Free compris
// ─────────────────────────────────────────────────────────────

test("L5 Free — pendant un raid : 2 tentatives, cooldown 60 s, expiration 1 min, blocage 120 s", async () => {
  const h = harness({ raid: true });
  const { context, replies } = buildContext();
  const service = realService(NORMAL_CONFIG, { failAssign: true });

  const first = await handleCaptchaVerify(context, service, h.runtime());
  assert.equal(first.code, "CAPTCHA_ASSIGNMENT_FAILED", "échec imputable (aucune faute d'admin)");
  const session = h.store.get("g", "u");
  assert.equal(session.state, CaptchaSessionState.FAILED);
  assert.equal(session.attempts, 1);
  assert.equal(session.nextAttemptAt, 60_000, "cooldown durci (60 s contre 10 s configurés)");
  assert.equal(session.expiresAt, 120_000, "prolongation bornée : cooldown + 1 min d'expiration");

  // Cooldown : un clic immédiat ne consomme rien.
  const during = await handleCaptchaVerify(context, service, h.runtime());
  assert.equal(during.code, "CAPTCHA_COOLDOWN");
  assert.equal(h.store.get("g", "u").attempts, 1, "aucune tentative consommée pendant le cooldown");

  // 2ᵉ tentative après le cooldown → blocage immédiat.
  h.clockState.now += 60_000;
  const second = await handleCaptchaVerify(context, service, h.runtime());
  assert.equal(second.blocked, true, "deuxième échec ⇒ blocage");
  const blocked = h.store.get("g", "u");
  assert.equal(blocked.state, CaptchaSessionState.BLOCKED);
  assert.equal(blocked.blockedUntil - h.clockState.now, 120_000, "blocage de 120 s");

  const whileBlocked = await handleCaptchaVerify(context, service, h.runtime());
  assert.equal(whileBlocked.code, "CAPTCHA_TOO_MANY_ATTEMPTS");
  assert.equal(replies.at(-1).view.content, "captcha.CAPTCHA_TOO_MANY_ATTEMPTS");

  // Aucune écriture de configuration, aucun état persistant hors store.
  assert.deepEqual(h.updates, [], "la configuration n'est JAMAIS écrite");
  assert.equal(h.entitlementChecks.length, 0, "serveur sans expérience Premium : aucun challenge tenté");
});

test("L5 Free — le bouton standard reste le seul chemin (aucun challenge imposé par le raid)", async () => {
  const h = harness({ raid: true });
  const { context } = buildContext();
  const service = realService(NORMAL_CONFIG);

  const result = await handleCaptchaVerify(context, service, h.runtime());

  assert.equal(result.verified, true);
  assert.equal(result.code, "CAPTCHA_VERIFIED", "vérification standard, jamais un challenge Premium");
  assert.equal(h.store.size, 0, "succès = session terminale");
});

test("L5 — hors raid, les limites configurées reprennent à l'identique (aucun durcissement résiduel)", async () => {
  const h = harness({ raid: false });
  const { context } = buildContext();
  const service = realService(NORMAL_CONFIG, { failAssign: true });

  await handleCaptchaVerify(context, service, h.runtime());
  const session = h.store.get("g", "u");

  assert.equal(session.nextAttemptAt, 10_000, "cooldown configuré (10 s)");
  assert.equal(session.expiresAt, 300_000, "expiration configurée (5 min)");

  // Blocage configuré : 10 s × 3 tentatives = 30 s.
  h.clockState.now += 10_000;
  await handleCaptchaVerify(context, service, h.runtime());
  h.clockState.now += 10_000;
  await handleCaptchaVerify(context, service, h.runtime());
  assert.equal(h.store.get("g", "u").blockedUntil - h.clockState.now, 30_000);
});

// ─────────────────────────────────────────────────────────────
// Axe B — entitlement (Premium uniquement)
// ─────────────────────────────────────────────────────────────

test("L5 Premium — pendant un raid, un serveur sans habitude Premium passe au niveau RAID", async () => {
  const h = harness({ raid: true, premium: true });
  const { context, replies } = buildContext();

  const result = await handleCaptchaVerify(context, realService(NORMAL_CONFIG), h.runtime());

  assert.equal(result.code, "CAPTCHA_CHALLENGE_ISSUED", "niveau RAID ⇒ challenge");
  assert.equal(result.details.level, CaptchaLevel.RAID);
  assert.equal(result.details.mode, CaptchaMode.CHALLENGE);
  assert.equal(result.details.premiumFallback, false, "entitlement accordé : aucun repli");
  assert.equal(h.store.get("g", "u").state, CaptchaSessionState.CHALLENGE);
  assert.ok(replies.at(-1).view.components.length > 0, "le challenge est bien présenté");
  assert.equal(h.entitlementChecks.length, 1, "un seul aller-retour Premium");
});

test("L5 Premium — entitlement refusé : repli standard, jamais de challenge sans droit", async () => {
  const h = harness({ raid: true, premium: false });
  const { context } = buildContext();
  const service = realService(HIGH_CONFIG, { failAssign: true });

  const result = await handleCaptchaVerify(context, service, h.runtime());

  assert.equal(result.code, "CAPTCHA_ASSIGNMENT_FAILED", "bouton standard, pas de challenge");
  assert.equal(h.store.get("g", "u").state, CaptchaSessionState.FAILED, "aucune session de challenge");
  // L'axe A protège quand même ce serveur : limites durcies malgré le repli.
  assert.equal(h.store.get("g", "u").nextAttemptAt, 60_000);
  assert.deepEqual(h.updates, [], "le refus Premium n'écrit rien dans la configuration");
});

test("L5 Premium — raid terminé : le niveau configuré (HIGH) revient, le challenge reste Premium", async () => {
  const h = harness({ config: HIGH_CONFIG, raid: false, premium: true });
  const { context } = buildContext();

  const result = await handleCaptchaVerify(context, realService(HIGH_CONFIG), h.runtime());

  assert.equal(result.code, "CAPTCHA_CHALLENGE_ISSUED");
  assert.equal(result.details.level, CaptchaLevel.HIGH, "niveau configuré, pas RAID");
  assert.equal(h.store.get("g", "u").challenge.type, "CHOICE");
});

test("L5 — hors raid et sans expérience Premium demandée, l'entitlement n'est jamais interrogé", async () => {
  const h = harness({ raid: false, premium: true });
  const { context } = buildContext();

  const result = await handleCaptchaVerify(context, realService(NORMAL_CONFIG), h.runtime());

  assert.equal(result.code, "CAPTCHA_VERIFIED");
  assert.equal(h.entitlementChecks.length, 0, "aucune régression de latence pour les serveurs Free");
});

// ─────────────────────────────────────────────────────────────
// Retour exact, raids successifs, isolation
// ─────────────────────────────────────────────────────────────

test("L5 — retour EXACT après raid : les valeurs configurées d'origine sont restaurées", async () => {
  const h = harness({ raid: true });
  const service = realService(NORMAL_CONFIG, { failAssign: true });

  // 1. Pendant le raid : cooldown durci.
  const during = buildContext({ userId: "pendant" });
  await handleCaptchaVerify(during.context, service, h.runtime());
  assert.equal(h.store.get("g", "pendant").nextAttemptAt, 60_000);

  // 2. Le raid se termine (la fenêtre glissante du moteur retombe à zéro).
  h.raidState.active = false;
  const after = buildContext({ userId: "apres" });
  await handleCaptchaVerify(after.context, service, h.runtime());
  const session = h.store.get("g", "apres");
  assert.equal(session.nextAttemptAt, 10_000, "cooldown configuré restauré (10 s)");
  assert.equal(session.expiresAt, 300_000, "expiration configurée restaurée (5 min)");
  assert.equal(h.store.get("g", "pendant").nextAttemptAt, 60_000, "session antérieure jamais réécrite");
  assert.deepEqual(h.updates, []);
});

test("L5 — session ouverte AVANT le raid : expiration initiale conservée, limites durcies pendant l'incident", async () => {
  const h = harness({ raid: false });
  const service = realService(NORMAL_CONFIG, { failAssign: true });

  // 1. Hors raid : le membre ouvre sa session avec les valeurs configurées.
  await handleCaptchaVerify(buildContext({ userId: "avant" }).context, service, h.runtime());
  const opened = h.store.get("g", "avant");
  assert.equal(opened.state, CaptchaSessionState.FAILED);
  assert.equal(opened.attempts, 1);
  assert.equal(opened.nextAttemptAt, 10_000, "cooldown configuré : 10 s");
  assert.equal(opened.expiresAt, 300_000, "expiration INITIALE : 5 min configurées");

  // 2. Le raid démarre alors que la session existe déjà ; le cooldown est écoulé.
  h.raidState.active = true;
  h.clockState.now += 10_000;
  const second = await handleCaptchaVerify(buildContext({ userId: "avant" }).context, service, h.runtime());
  const during = h.store.get("g", "avant");
  assert.equal(second.code, "CAPTCHA_ASSIGNMENT_FAILED");
  assert.equal(during.attempts, 2, "plafond durci atteint : 2 tentatives au lieu de 3");
  assert.equal(during.state, CaptchaSessionState.BLOCKED, "le durcissement mord sur la session préexistante");
  assert.equal(during.blockedUntil - h.clockState.now, 120_000, "blocage durci de 120 s");
  assert.equal(during.expiresAt, 300_000, "expiration INITIALE conservée : aucune réécriture rétroactive");
  assert.ok(during.blockedUntil < during.expiresAt, "le blocage durci tient dans la fenêtre d'origine");

  // 3. Pendant le blocage : aucun crédit de tentative supplémentaire.
  const blocked = await handleCaptchaVerify(buildContext({ userId: "avant" }).context, service, h.runtime());
  assert.equal(blocked.code, "CAPTCHA_TOO_MANY_ATTEMPTS");
  assert.equal(h.store.get("g", "avant").attempts, 2);

  // 4. Contraste : une session NÉE pendant le raid porte, elle, l'expiration durcie
  //    (1 min après le cooldown de 60 s, plus une prolongation bornée par tentative).
  await handleCaptchaVerify(buildContext({ userId: "pendant" }).context, service, h.runtime());
  const fresh = h.store.get("g", "pendant");
  assert.equal(fresh.state, CaptchaSessionState.FAILED);
  assert.equal(fresh.attempts, 1);
  assert.equal(fresh.nextAttemptAt - h.clockState.now, 60_000, "cooldown durci : 60 s");
  assert.equal(fresh.expiresAt - fresh.nextAttemptAt, 60_000, "expiration durcie : 1 min après le cooldown");
  assert.equal(fresh.expiresAt - h.clockState.now, 120_000, "création (1 min durcie) + une prolongation bornée");

  // 5. Fin de l'incident : les valeurs configurées reviennent, sans toucher aux sessions ouvertes.
  h.raidState.active = false;
  await handleCaptchaVerify(buildContext({ userId: "apres" }).context, service, h.runtime());
  assert.equal(h.store.get("g", "apres").nextAttemptAt - h.clockState.now, 10_000, "cooldown configuré restauré");
  assert.equal(h.store.get("g", "apres").expiresAt - h.clockState.now, 300_000, "expiration configurée restaurée");
  assert.equal(h.store.get("g", "avant").blockedUntil - h.clockState.now, 120_000, "blocage durci de la session d'origine intact");

  // 6. Le blocage purgé, le membre préexistant repart sur les valeurs configurées.
  h.clockState.now = 130_001;
  await handleCaptchaVerify(buildContext({ userId: "avant" }).context, service, h.runtime());
  const restarted = h.store.get("g", "avant");
  assert.equal(restarted.attempts, 1, "nouvelle session après le blocage durci");
  assert.equal(restarted.nextAttemptAt - h.clockState.now, 10_000);
  assert.equal(restarted.expiresAt - h.clockState.now, 300_000, "retour aux valeurs configurées");

  // 7. La fenêtre durcie d'une session née pendant le raid reste honorée jusqu'au bout.
  const expired = await handleCaptchaVerify(buildContext({ userId: "pendant" }).context, service, h.runtime());
  assert.equal(expired.code, "CAPTCHA_SESSION_EXPIRED");

  assert.deepEqual(h.updates, [], "aucune configuration écrite pendant tout le scénario");
});

test("L5 — raids successifs : chaque raid redurcit, aucune accumulation ni état persistant", async () => {
  const h = harness({ raid: true });
  const service = realService(NORMAL_CONFIG, { failAssign: true });
  const cooldowns = [];

  for (const [index, raidActive] of [true, false, true, false].entries()) {
    h.raidState.active = raidActive;
    const ctx = buildContext({ userId: `m${index}` });
    await handleCaptchaVerify(ctx.context, service, h.runtime());
    cooldowns.push(h.store.get("g", `m${index}`).nextAttemptAt);
  }

  assert.deepEqual(cooldowns, [60_000, 10_000, 60_000, 10_000], "durci / normal / durci / normal");
  assert.equal(h.store.size, 4, "seules les sessions des membres existent");
  assert.deepEqual(h.updates, [], "aucune configuration écrite, aucun état raid persisté");
});

test("L5 — isolation par guilde : un raid ne durcit jamais une autre guilde", async () => {
  const h = harness({ raid: true });
  const service = realService(NORMAL_CONFIG, { failAssign: true });

  await handleCaptchaVerify(buildContext({ guildId: "g", userId: "u1" }).context, service, h.runtime());
  await handleCaptchaVerify(buildContext({ guildId: "g-calme", userId: "u1" }).context, service, h.runtime());

  assert.equal(h.store.get("g", "u1").nextAttemptAt, 60_000, "guilde en raid durcie");
  assert.equal(h.store.get("g-calme", "u1").nextAttemptAt, 10_000, "guilde voisine intacte");
});

test("L5 — signal raid indisponible ou en erreur : jamais de blocage du membre (repli configuré)", async () => {
  const broken = harness({ raidSignal: () => { throw new Error("security runtime down"); } });
  const { context } = buildContext();
  const service = realService(NORMAL_CONFIG, { failAssign: true });

  const result = await handleCaptchaVerify(context, service, broken.runtime());

  assert.equal(result.code, "CAPTCHA_ASSIGNMENT_FAILED", "le flux va au bout");
  assert.equal(broken.store.get("g", "u").nextAttemptAt, 10_000, "limites configurées conservées");

  const missing = harness({ raidSignal: null });
  await handleCaptchaVerify(buildContext({ userId: "no-signal" }).context, service, missing.runtime());
  assert.equal(missing.store.get("g", "no-signal").nextAttemptAt, 10_000, "signal absent ⇒ aucun durcissement");
});

// ─────────────────────────────────────────────────────────────
// Réponses de challenge : mêmes limites effectives
// ─────────────────────────────────────────────────────────────

test("L5 Premium — une mauvaise réponse de challenge pendant un raid consomme le cooldown durci", async () => {
  const h = harness({ raid: true, premium: true });
  const { context } = buildContext();
  const service = realService(NORMAL_CONFIG);

  const issued = await handleCaptchaVerify(context, service, h.runtime());
  assert.equal(issued.code, "CAPTCHA_CHALLENGE_ISSUED");
  const challenge = h.store.get("g", "u").challenge;
  const wrong = challenge.options.findIndex((_o, index) => index !== challenge.answerIndex);

  context.envelope.customId = buildCaptchaChallengeCustomId({ type: challenge.type, challengeId: challenge.id, value: wrong });
  const failed = await handleCaptchaVerify(context, service, h.runtime());

  assert.equal(failed.code, "CAPTCHA_CHALLENGE_FAILED");
  assert.equal(h.store.get("g", "u").nextAttemptAt - h.clockState.now, 60_000, "cooldown durci aussi sur ce chemin");
});

// ─────────────────────────────────────────────────────────────
// Câblage réel via registerCaptcha
// ─────────────────────────────────────────────────────────────

test("L5 — la route VERIFY enregistrée reçoit bien le signal raid (et lui seul change le mode)", async () => {
  const buildRuntimeFor = (raidSignal) => {
    const registry = new InteractionRegistry();
    let config = { ...NORMAL_CONFIG };
    const updates = [];
    const service = {
      read: async () => ({ ...config }),
      update: async (_guildId, patch) => { updates.push(patch); config = { ...config, ...patch }; return { ...config }; },
    };
    registerCaptcha({
      registry,
      service,
      verificationServiceFactory: () => new CaptchaVerificationService({
        configService: service,
        transport: {
          getRole: async (id) => ({ id, managed: false, position: 1 }),
          canManageRole: () => true,
          assignRole: async () => {},
        },
      }),
      settingsHome: async () => {},
      // Entitlement Premium accordé : seul le signal raid peut décider du niveau.
      entitlementService: { requireFeature: async () => ({ ok: true, granted: true, code: "ENTITLEMENT_GRANTED" }) },
      raidSignal,
    });
    return { route: registry.find({ kind: "button", customId: Id.VERIFY }), updates };
  };

  // Raid signalé : un serveur configuré en NORMAL/bouton passe au niveau RAID.
  const raid = buildRuntimeFor(() => true);
  assert.ok(raid.route, "route VERIFY présente");
  const underRaid = await raid.route.execute(buildContext().context);
  assert.equal(underRaid.code, "CAPTCHA_CHALLENGE_ISSUED", "le signal raid atteint bien la route");
  assert.equal(underRaid.details.level, CaptchaLevel.RAID);
  assert.equal(underRaid.details.mode, CaptchaMode.CHALLENGE);
  assert.deepEqual(raid.updates, [], "aucune écriture de réglage");

  // Aucun raid : même configuration, même entitlement ⇒ bouton standard.
  const calm = buildRuntimeFor(() => false);
  const calmResult = await calm.route.execute(buildContext().context);
  assert.equal(calmResult.code, "CAPTCHA_VERIFIED", "sans raid, le bouton configuré est conservé");
  assert.deepEqual(calm.updates, []);
});
