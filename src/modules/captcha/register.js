"use strict";

const { PermissionName } = require("../../core/permissions");
const { prefix } = require("../../core/interactions/routeMatchers");
const { CaptchaComponentId: Id } = require("./configuration/captchaConstants");
const { captchaView, captchaAdvancedView } = require("./interactions/captchaViews");
const {
  toggleCaptcha,
  selectCaptcha,
  resetCaptcha,
  selectDuration,
  selectLimits,
  selectUnverifiedRole,
  toggleForceExisting,
  selectLevel,
  selectMode,
  selectChallenge,
  resolveViewGrant,
} = require("./interactions/configureCaptcha");
const { handleCaptchaVerify } = require("./interactions/captchaVerifyRoute");
const { previewCaptcha } = require("./interactions/captchaPreview");
const { CaptchaSessionStore } = require("./services/CaptchaSessionStore");
const { CaptchaChallengeService } = require("./services/CaptchaChallengeService");

function registerCaptcha({ registry, service, verificationServiceFactory, settingsHome = null, entitlementService = null, logsRuntime = null, raidSignal = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  // P-CAPT L1 — store mémoire partagé par toutes les routes CAPTCHA de ce
  // runtime (singleton de process, comme les autres runtimes du bot).
  const sessionStore = new CaptchaSessionStore();
  // P-CAPT L3 — service de challenges partagé (historique anti-répétition par
  // membre) : une seule instance, aucune session parallèle.
  const challengeService = new CaptchaChallengeService();
  // P-CAPT L4 — runtime de journaux injecté (même singleton que le reste du
  // bot) : les interactions CAPTCHA journalisent sans dépendance circulaire.
  // P-CAPT L5 — `raidSignal` : peek LECTURE SEULE du moteur anti-raid (jamais
  // un second moteur, jamais un état persisté par le CAPTCHA).
  const context = (c) => ({ ...c, service, entitlementService, logsRuntime, raidSignal });

  // Vues : le `granted` n'est résolu que pour une expérience Premium demandée.
  const renderView = async (c, render) => {
    const config = await service.read(c.guildId);
    const granted = await resolveViewGrant({ config, guildId: c.guildId, entitlementService });
    await c.envelope.transport.update({ view: render({ t: c.t, config, granted }) });
  };

  registry.registerButton({ customId: Id.SECTION, permissions, execute: async (c) => renderView(c, captchaView) });
  registry.registerButton({ customId: Id.TOGGLE, permissions, execute: async (c) => toggleCaptcha(context(c)) });
  registry.registerSelectMenu({ customId: Id.CHANNEL, permissions, execute: async (c) => selectCaptcha(context(c)) });
  registry.registerSelectMenu({ customId: Id.ROLE, permissions, execute: async (c) => selectCaptcha(context(c)) });
  registry.registerButton({ customId: Id.PREVIEW, permissions, execute: async (c) => previewCaptcha(context(c)) });
  registry.registerButton({ customId: Id.RESET, permissions, execute: async (c) => resetCaptcha(context(c)) });
  // P-CAPT L1 — sous-vue Avancé + réglages (durée, tentatives/cooldown).
  registry.registerButton({ customId: Id.ADVANCED, permissions, execute: async (c) => renderView(c, captchaAdvancedView) });
  registry.registerSelectMenu({ customId: Id.DURATION, permissions, execute: async (c) => selectDuration(context(c)) });
  registry.registerSelectMenu({ customId: Id.LIMITS, permissions, execute: async (c) => selectLimits(context(c)) });
  // P-CAPT L2 — rôle non vérifié (force-existing est rendu dans la vue Avancé).
  registry.registerSelectMenu({ customId: Id.UNVERIFIED_ROLE, permissions, execute: async (c) => selectUnverifiedRole(context(c)) });
  registry.registerButton({ customId: Id.FORCE_EXISTING, permissions, execute: async (c) => toggleForceExisting(context(c)) });
  // P-CAPT L3 — niveau, mode et type de challenge (Premium sous entitlement).
  registry.registerSelectMenu({ customId: Id.LEVEL, permissions, execute: async (c) => selectLevel(context(c)) });
  registry.registerSelectMenu({ customId: Id.MODE, permissions, execute: async (c) => selectMode(context(c)) });
  registry.registerSelectMenu({ customId: Id.CHALLENGE, permissions, execute: async (c) => selectChallenge(context(c)) });
  // Panneau officiel : route permission-free existante, matcher `prefix` pour
  // router aussi les réponses de challenge (`VERIFY:<type>:<id>:<index>`)
  // SANS nouvelle route ni nouveau compteur.
  registry.registerButton({
    matcher: prefix(Id.VERIFY),
    permissions: { allOf: [] },
    execute: async (c) => handleCaptchaVerify(c, verificationServiceFactory(c), {
      configService: service,
      sessionStore,
      challenges: challengeService,
      entitlementService,
      raidSignal: c.raidSignal ?? raidSignal,
      rateLimitGuard: c.rateLimitGuard ?? null,
    }),
  });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });

  return { id: Id.SECTION, permissions };
}

module.exports = { registerCaptcha };
