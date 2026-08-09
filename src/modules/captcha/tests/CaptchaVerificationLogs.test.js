"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { handleCaptchaEvent } = require("../../logs/events/handleCaptchaEvent");

test("captcha verification logs once with guild member role context", async () => {
  for (const action of ["captcha_verified", "captcha_verification_failed"]) {
    let calls = 0;
    const result = await handleCaptchaEvent({
      guild: { id: "g" },
      config: { logs_enabled: true, log_moderation_channel_id: "c" },
      action,
      memberId: "m",
      roleId: "r",
      mapper: { map: (entry) => entry },
      service: { resolveDestination: () => "c" },
      delivery: { deliver: async (entry) => { calls += 1; return { delivered: true, ...entry }; } },
    });
    assert.equal(calls, 1);
    assert.equal(result.guildId, "g");
    assert.equal(result.details.memberId, "m");
  }
});
