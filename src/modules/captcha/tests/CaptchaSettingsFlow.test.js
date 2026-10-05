"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { toggleCaptcha, selectCaptcha, resetCaptcha } = require("../interactions/configureCaptcha");
const { CaptchaComponentId: Id } = require("../configuration/captchaConstants");

test("Captcha settings persist toggle channel and role", async () => {
  let config = { captcha_enabled: false };
  let updates = 0;
  const c = {
    guildId: "g",
    t: (k) => k,
    service: {
      read: async () => config,
      update: async (_g, p) => { config = { ...config, ...p }; return config; },
    },
    envelope: { transport: { update: async () => { updates += 1; }, reply: async () => {} } },
  };

  await toggleCaptcha(c);
  await selectCaptcha({ ...c, envelope: { customId: Id.CHANNEL, values: ["c"], transport: c.envelope.transport } });
  await selectCaptcha({ ...c, envelope: { customId: Id.ROLE, values: ["r"], transport: c.envelope.transport } });

  assert.deepEqual(config, { captcha_enabled: true, captcha_channel_id: "c", captcha_role_id: "r" });
  assert.equal(updates, 3);
});

test("Captcha reset clears enable channel role and session settings", async () => {
  let config = { captcha_enabled: true, captcha_channel_id: "c", captcha_role_id: "r", captcha_expiry_minutes: 15, captcha_attempts: 5, captcha_cooldown_seconds: 30 };
  let updates = 0;
  const c = {
    guildId: "g",
    t: (k) => k,
    service: {
      read: async () => config,
      update: async (_g, p) => { config = { ...config, ...p }; return config; },
    },
    envelope: { transport: { update: async () => { updates += 1; } } },
  };

  await resetCaptcha(c);

  // P-CAPT L1 : le reset remet aussi les réglages de session à leurs défauts
  // (colonnes présentes mais nulles ⇒ résolveur NORMAL).
  assert.deepEqual(config, {
    captcha_enabled: false,
    captcha_channel_id: null,
    captcha_role_id: null,
    captcha_expiry_minutes: null,
    captcha_attempts: null,
    captcha_cooldown_seconds: null,
  });
  assert.equal(updates, 1);
});
