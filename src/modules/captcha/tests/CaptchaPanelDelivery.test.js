"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CaptchaPanelDeliveryService } = require("../services/CaptchaPanelDeliveryService");

const view = { title: "title", content: "content", components: [{ customId: "civrat:v1:captcha:verify", label: "verify" }] };

test("panel delivery sends once only when configuration is complete", async () => {
  const sent = [];
  const delivery = new CaptchaPanelDeliveryService({
    panelService: { build: async () => ({ ready: true, channelId: "channel", roleId: "role", view }) },
    transport: { sendPanel: async (...args) => sent.push(args) },
  });
  const result = await delivery.deliver("guild", (key) => key);
  assert.equal(result.delivered, true);
  assert.deepEqual(sent, [["channel", view]]);
});

test("panel delivery skips disabled or incomplete configuration without sending", async () => {
  for (const reason of ["captcha.disabled", "captcha.channelMissing", "captcha.roleMissing"]) {
    let sent = 0;
    const delivery = new CaptchaPanelDeliveryService({
      panelService: { build: async () => ({ ready: false, reason }) },
      transport: { sendPanel: async () => { sent += 1; } },
    });
    const result = await delivery.deliver("guild", (key) => key);
    assert.equal(result.delivered, false);
    assert.equal(result.reason, reason);
    assert.equal(sent, 0);
  }
});
