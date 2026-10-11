"use strict";

// P-CAPT L3 — niveaux de sécurité, whitelists et séparation Free/Premium.
// Aucun accès Discord/Supabase : services et transports en mémoire.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CaptchaConfigKey: Key,
  CaptchaLevel,
  CaptchaMode,
  CaptchaChallengeType,
  CaptchaLevelPresets,
  CAPTCHA_LEVEL_LIST,
  CAPTCHA_MODE_LIST,
  CAPTCHA_CHALLENGE_TYPE_LIST,
  CAPTCHA_DURATION_PRESETS,
  CAPTCHA_LIMITS_PRESETS,
  CAPTCHA_DEFAULT_LEVEL,
  captchaLevelSelection,
  isCaptchaPremiumLevel,
  resolveCaptchaLevel,
  resolveCaptchaMode,
  resolveCaptchaChallengeType,
  resolveCaptchaRequestedPlan,
  resolveCaptchaPlan,
  resolveCaptchaSessionSettings,
} = require("../configuration/captchaConstants");
const { selectLevel, selectMode, selectChallenge } = require("../interactions/configureCaptcha");
const { EntitlementDecision, EntitlementFeature } = require("../../../core/entitlements");
const { resolveCaptchaEntitlement } = require("../services/captchaEntitlement");

/** EntitlementService factice : seule `requireFeature` est utilisée. */
function entitlement({ granted = false, throws = false } = {}) {
  return {
    requireFeature: async ({ feature }) => {
      if (throws) throw new Error("backend down");
      assert.equal(feature, EntitlementFeature.CAPTCHA_PREMIUM, "la bonne clé d'entitlement est demandée");
      return granted
        ? { ok: true, granted: true, code: EntitlementDecision.GRANTED }
        : { ok: true, granted: false, code: EntitlementDecision.PREMIUM_REQUIRED };
    },
  };
}

/** Contexte de réglages : config en mémoire + transport enregistreur. */
function settingsContext({ config = {}, entitlementService = null } = {}) {
  const state = { config: { ...config } };
  const views = [];
  const replies = [];
  return {
    state, views, replies,
    context: {
      guildId: "g",
      userId: "admin",
      t: (key, vars) => (vars ? `${key}(${Object.values(vars).join(",")})` : key),
      service: {
        read: async () => ({ ...state.config }),
        update: async (_guildId, updates) => { state.config = { ...state.config, ...updates }; return { ...state.config }; },
      },
      entitlementService,
      envelope: {
        values: [],
        transport: {
          update: async (payload) => { views.push(payload); },
          reply: async (payload) => { replies.push(payload); },
        },
      },
    },
  };
}

const withValues = (h, values) => ({ ...h.context, envelope: { ...h.context.envelope, values } });

test("L3 — les presets de niveaux respectent le plan validé", () => {
  assert.deepEqual(CAPTCHA_LEVEL_LIST, ["LOW", "NORMAL", "HIGH", "RAID"]);
  assert.equal(CAPTCHA_DEFAULT_LEVEL, CaptchaLevel.NORMAL);

  assert.deepEqual(CaptchaLevelPresets[CaptchaLevel.LOW], { mode: "BUTTON", expiryMinutes: 10, attempts: 5, cooldownSeconds: 5 });
  assert.deepEqual(CaptchaLevelPresets[CaptchaLevel.NORMAL], { mode: "BUTTON", expiryMinutes: 5, attempts: 3, cooldownSeconds: 10 });
  assert.deepEqual(CaptchaLevelPresets[CaptchaLevel.HIGH], { mode: "CHALLENGE", expiryMinutes: 2, attempts: 3, cooldownSeconds: 30 });
  assert.deepEqual(CaptchaLevelPresets[CaptchaLevel.RAID], { mode: "CHALLENGE", expiryMinutes: 1, attempts: 2, cooldownSeconds: 60 });

  // Premium = niveaux challenge et mode challenge uniquement.
  assert.deepEqual(CAPTCHA_LEVEL_LIST.filter(isCaptchaPremiumLevel), ["HIGH", "RAID"]);
  assert.ok(!isCaptchaPremiumLevel(CaptchaLevel.LOW));
  assert.ok(!isCaptchaPremiumLevel(CaptchaLevel.NORMAL));
});

test("L3 — NORMAL est le défaut : valeurs absentes ou invalides ne contournent rien", () => {
  assert.equal(resolveCaptchaLevel({}), CaptchaLevel.NORMAL);
  assert.equal(resolveCaptchaLevel({ [Key.LEVEL]: "MAX" }), CaptchaLevel.NORMAL);
  assert.equal(resolveCaptchaLevel({ [Key.LEVEL]: 42 }), CaptchaLevel.NORMAL);
  assert.equal(resolveCaptchaLevel({ [Key.LEVEL]: null }), CaptchaLevel.NORMAL);
  assert.equal(resolveCaptchaMode({}), CaptchaMode.BUTTON);
  assert.equal(resolveCaptchaMode({ [Key.LEVEL]: CaptchaLevel.HIGH }), CaptchaMode.CHALLENGE, "mode dérivé du preset");
  assert.equal(resolveCaptchaMode({ [Key.MODE]: "MAGIC" }), CaptchaMode.BUTTON);
  assert.equal(resolveCaptchaChallengeType({ [Key.CHALLENGE]: "FOURTH" }), CaptchaChallengeType.CHOICE);

  // Valeurs invalides ⇒ plan NORMAL/bouton : jamais de mode inconnu.
  const plan = resolveCaptchaPlan({ [Key.LEVEL]: "MAX", [Key.MODE]: "MAGIC", [Key.CHALLENGE]: "?" }, { granted: true });
  assert.deepEqual(plan, {
    level: "NORMAL", mode: "BUTTON", challengeType: null, premium: false, requestedPremium: false, fellBack: false,
  });
});

test("L3 — les presets écrits restent compatibles avec les mécanismes du LOT 1", () => {
  for (const level of CAPTCHA_LEVEL_LIST) {
    const selection = captchaLevelSelection(level);
    assert.ok(selection, `${level}: sélection valide`);
    assert.deepEqual(Object.keys(selection).sort(), [
      "captcha_attempts", "captcha_cooldown_seconds", "captcha_expiry_minutes", "captcha_level", "captcha_mode",
    ], "le preset écrit UNIQUEMENT des clés existantes (L1 + niveau/mode)");

    // Les valeurs écrites sont acceptées par les whitelists L1 servies par l'UI…
    assert.ok(CAPTCHA_DURATION_PRESETS.includes(selection[Key.EXPIRY_MINUTES]), `${level}: durée dans la whitelist L1`);
    assert.ok(
      CAPTCHA_LIMITS_PRESETS.some((p) => p.attempts === selection[Key.ATTEMPTS] && p.cooldownSeconds === selection[Key.COOLDOWN_SECONDS]),
      `${level}: tentatives/cooldown dans la whitelist L1`,
    );
    // …et relues par le résolveur L1 sans altération (aucune mécanique parallèle).
    const settings = resolveCaptchaSessionSettings(selection);
    const preset = CaptchaLevelPresets[level];
    assert.equal(settings.expiryMs, preset.expiryMinutes * 60_000);
    assert.equal(settings.maxAttempts, preset.attempts);
    assert.equal(settings.cooldownMs, preset.cooldownSeconds * 1000);
  }
});

test("L3 — les valeurs hors whitelist sont refusées sans écriture", () => {
  assert.equal(captchaLevelSelection("MAX"), null);
  assert.equal(captchaLevelSelection(null), null);
  assert.equal(captchaLevelSelection("high"), null, "casse stricte");
  assert.deepEqual(CAPTCHA_MODE_LIST, ["BUTTON", "CHALLENGE"]);
  assert.deepEqual(CAPTCHA_CHALLENGE_TYPE_LIST, ["CHOICE", "ORDER", "PICK"], "exactement trois types (plan validé)");
});

test("L3 — entitlement CAPTCHA_PREMIUM : fail-closed sur toutes les pannes", async () => {
  assert.deepEqual(await resolveCaptchaEntitlement({ guildId: "g", entitlementService: null }), {
    ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE,
  }, "service absent ⇒ refus");
  assert.deepEqual(await resolveCaptchaEntitlement({ guildId: "g", entitlementService: entitlement({ throws: true }) }), {
    ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE,
  }, "exception backend ⇒ refus");
  assert.equal((await resolveCaptchaEntitlement({ guildId: "g", entitlementService: entitlement({ granted: true }) })).granted, true);
  assert.equal((await resolveCaptchaEntitlement({ guildId: "g", entitlementService: entitlement({ granted: false }) })).granted, false);
});

test("L3 — plan effectif : une expérience Premium sans droit retombe sur NORMAL/bouton", () => {
  const premiumConfig = { [Key.LEVEL]: CaptchaLevel.HIGH, [Key.MODE]: CaptchaMode.CHALLENGE, [Key.CHALLENGE]: CaptchaChallengeType.ORDER };

  const requested = resolveCaptchaRequestedPlan(premiumConfig);
  assert.deepEqual(requested, { level: "HIGH", mode: "CHALLENGE", challengeType: "ORDER", premium: true });

  const denied = resolveCaptchaPlan(premiumConfig, { granted: false });
  assert.deepEqual(denied, {
    level: "NORMAL", mode: "BUTTON", challengeType: null, premium: false, requestedPremium: true, fellBack: true,
  }, "repli explicite, jamais une session Premium gratuite");

  const granted = resolveCaptchaPlan(premiumConfig, { granted: true });
  assert.deepEqual(granted, { level: "HIGH", mode: "CHALLENGE", challengeType: "ORDER", premium: true, requestedPremium: true, fellBack: false });

  // Niveau Premium en mode bouton forcé : reste Premium (donc protégé).
  assert.equal(resolveCaptchaPlan({ [Key.LEVEL]: CaptchaLevel.RAID, [Key.MODE]: CaptchaMode.BUTTON }, { granted: false }).fellBack, true);

  // Configuration Free : aucun repli (le mode bouton/LOW-NORMAL reste libre).
  assert.equal(resolveCaptchaPlan({ [Key.LEVEL]: CaptchaLevel.LOW }, { granted: false }).fellBack, false);
  assert.equal(resolveCaptchaPlan({}, { granted: false }).premium, false);
});

test("L3 — selectLevel : whitelist, gating Premium et écriture du preset complet", async () => {
  // Valeur invalide → aucune écriture, aucune réponse.
  const invalid = settingsContext({ config: { [Key.ENABLED]: true } });
  assert.equal(await selectLevel(withValues(invalid, ["MAX"])), null);
  assert.deepEqual(invalid.state.config, { [Key.ENABLED]: true });
  assert.equal(invalid.views.length + invalid.replies.length, 0);

  // Niveau Free → écriture sans même interroger l'entitlement.
  const free = settingsContext({ config: { [Key.ENABLED]: true } });
  await selectLevel(withValues(free, [CaptchaLevel.LOW]));
  assert.deepEqual(free.state.config, {
    [Key.ENABLED]: true,
    [Key.LEVEL]: "LOW",
    [Key.MODE]: "BUTTON",
    [Key.EXPIRY_MINUTES]: 10,
    [Key.ATTEMPTS]: 5,
    [Key.COOLDOWN_SECONDS]: 5,
  }, "preset LOW appliqué dans les clés L1");

  // Niveau Premium sans droit → refus localisé, configuration intacte.
  const denied = settingsContext({ config: { [Key.ENABLED]: true }, entitlementService: entitlement({ granted: false }) });
  await selectLevel(withValues(denied, [CaptchaLevel.HIGH]));
  assert.deepEqual(denied.state.config, { [Key.ENABLED]: true }, "la configuration n'est jamais modifiée par un refus");
  assert.equal(denied.replies.length, 1);
  assert.equal(denied.replies[0].view.content, "captcha.premiumRequired");
  assert.equal(denied.replies[0].ephemeral, true);
  assert.equal(denied.views.length, 1, "la vue courante est réaffichée");

  // Niveau Premium avec droit → écriture (mode challenge + limites HIGH).
  const granted = settingsContext({ config: { [Key.ENABLED]: true }, entitlementService: entitlement({ granted: true }) });
  await selectLevel(withValues(granted, [CaptchaLevel.HIGH]));
  assert.deepEqual(granted.state.config, {
    [Key.ENABLED]: true,
    [Key.LEVEL]: "HIGH",
    [Key.MODE]: "CHALLENGE",
    [Key.EXPIRY_MINUTES]: 2,
    [Key.ATTEMPTS]: 3,
    [Key.COOLDOWN_SECONDS]: 30,
  });
});

test("L3 — selectMode / selectChallenge : whitelist stricte et Premium exigé", async () => {
  const invalidMode = settingsContext({ config: {} });
  assert.equal(await selectMode(withValues(invalidMode, ["MAGIC"])), null);
  assert.deepEqual(invalidMode.state.config, {});

  // BUTTON reste Free.
  const button = settingsContext({ config: {} });
  await selectMode(withValues(button, [CaptchaMode.BUTTON]));
  assert.equal(button.state.config[Key.MODE], "BUTTON");

  // CHALLENGE sans droit → refus, aucune écriture.
  const deniedMode = settingsContext({ config: {}, entitlementService: entitlement({ granted: false }) });
  await selectMode(withValues(deniedMode, [CaptchaMode.CHALLENGE]));
  assert.equal(deniedMode.state.config[Key.MODE], undefined);
  assert.equal(deniedMode.replies[0].view.content, "captcha.premiumRequired");

  // CHALLENGE avec droit → écriture.
  const grantedMode = settingsContext({ config: {}, entitlementService: entitlement({ granted: true }) });
  await selectMode(withValues(grantedMode, [CaptchaMode.CHALLENGE]));
  assert.equal(grantedMode.state.config[Key.MODE], "CHALLENGE");

  // Type de challenge : whitelist des trois types seulement.
  const invalidType = settingsContext({ config: {}, entitlementService: entitlement({ granted: true }) });
  assert.equal(await selectChallenge(withValues(invalidType, ["FOURTH"])), null);
  assert.deepEqual(invalidType.state.config, {});

  const deniedType = settingsContext({ config: {}, entitlementService: entitlement({ granted: false }) });
  await selectChallenge(withValues(deniedType, [CaptchaChallengeType.PICK]));
  assert.equal(deniedType.state.config[Key.CHALLENGE], undefined);
  assert.equal(deniedType.replies[0].view.content, "captcha.premiumRequired");

  const grantedType = settingsContext({ config: {}, entitlementService: entitlement({ granted: true }) });
  await selectChallenge(withValues(grantedType, [CaptchaChallengeType.PICK]));
  assert.equal(grantedType.state.config[Key.CHALLENGE], "PICK");
});

test("L3 — un serveur Free garde une configuration cohérente et un repli annoncé", async () => {
  // Le serveur a configuré HIGH (Premium) : sans droit, la vue le signale sans
  // casser la configuration, et le plan effectif reste bouton/NORMAL.
  const h = settingsContext({
    config: { [Key.ENABLED]: true, [Key.ROLE_ID]: "r", [Key.LEVEL]: CaptchaLevel.HIGH, [Key.MODE]: CaptchaMode.CHALLENGE },
    entitlementService: entitlement({ granted: false }),
  });
  await selectMode(withValues(h, [CaptchaMode.CHALLENGE]));
  assert.equal(h.state.config[Key.MODE], "CHALLENGE", "la configuration existante n'est pas altérée par le refus");
  assert.equal(h.state.config[Key.LEVEL], "HIGH");
  assert.ok(h.views.length >= 1, "la vue est réaffichée");
  assert.ok(!h.views.some((v) => v.view.components.some((c) => c.label === "captcha.premiumRequired")));
});
