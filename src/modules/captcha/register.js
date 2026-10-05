"use strict";

const { PermissionName } = require("../../core/permissions");
const { CaptchaComponentId: Id } = require("./configuration/captchaConstants");
const { captchaView, captchaAdvancedView } = require("./interactions/captchaViews");
const { toggleCaptcha, selectCaptcha, resetCaptcha, selectDuration, selectLimits } = require("./interactions/configureCaptcha");
const { handleCaptchaVerify } = require("./interactions/captchaVerifyRoute");
const { previewCaptcha } = require("./interactions/captchaPreview");
const { CaptchaSessionStore } = require("./services/CaptchaSessionStore");

function registerCaptcha({ registry, service, verificationServiceFactory, settingsHome = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  // P-CAPT L1 — store mémoire partagé par toutes les routes CAPTCHA de ce
  // runtime (singleton de process, comme les autres runtimes du bot).
  const sessionStore = new CaptchaSessionStore();

  registry.registerButton({ customId: Id.SECTION, permissions, execute: async (c) => c.envelope.transport.update({ view: captchaView({ t: c.t, config: await service.read(c.guildId) }) }) });
  registry.registerButton({ customId: Id.TOGGLE, permissions, execute: async (c) => toggleCaptcha({ ...c, service }) });
  registry.registerSelectMenu({ customId: Id.CHANNEL, permissions, execute: async (c) => selectCaptcha({ ...c, service }) });
  registry.registerSelectMenu({ customId: Id.ROLE, permissions, execute: async (c) => selectCaptcha({ ...c, service }) });
  registry.registerButton({ customId: Id.PREVIEW, permissions, execute: async (c) => previewCaptcha({ ...c, service }) });
  registry.registerButton({ customId: Id.RESET, permissions, execute: async (c) => resetCaptcha({ ...c, service }) });
  // P-CAPT L1 — sous-vue Avancé + réglages (durée, tentatives/cooldown).
  registry.registerButton({ customId: Id.ADVANCED, permissions, execute: async (c) => c.envelope.transport.update({ view: captchaAdvancedView({ t: c.t, config: await service.read(c.guildId) }) }) });
  registry.registerSelectMenu({ customId: Id.DURATION, permissions, execute: async (c) => selectDuration({ ...c, service }) });
  registry.registerSelectMenu({ customId: Id.LIMITS, permissions, execute: async (c) => selectLimits({ ...c, service }) });
  registry.registerButton({ customId: Id.VERIFY, permissions: { allOf: [] }, execute: async (c) => handleCaptchaVerify(c, verificationServiceFactory(c), {
    configService: service,
    sessionStore,
    rateLimitGuard: c.rateLimitGuard ?? null,
  }) });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });

  return { id: Id.SECTION, permissions };
}

module.exports = { registerCaptcha };
