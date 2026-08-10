"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { securityView } = require("../interactions/securityViews");
const { SecurityComponentId: Id } = require("../configuration/securityConstants");

test("security view reflects enabled state and components", () => {
  const t = (k) => k;
  const view = securityView({ t, config: { security_enabled: false, security_whitelist: [] } });
  assert.equal(view.title, "security.title");
  assert.equal(view.content, "security.disabled");
  const ids = view.components.map((c) => c.customId);
  assert.ok(ids.includes(Id.TOGGLE));
  assert.ok(ids.includes(Id.ANTI_RAID));
  assert.ok(ids.includes(Id.ANTI_BOT));
  assert.ok(ids.includes(Id.ANTI_NUKE));
  assert.ok(ids.includes(Id.WHITELIST_OPEN));
  assert.ok(ids.includes(Id.BACK));
});

test("security view marks enabled toggles with success and shows whitelist count", () => {
  const t = (k) => k;
  const view = securityView({ t, config: { security_enabled: true, security_anti_raid: true, security_whitelist: ["1", "2"] } });
  assert.equal(view.content, "security.enabled");
  const raid = view.components.find((c) => c.customId === Id.ANTI_RAID);
  assert.equal(raid.style, "success");
  const bot = view.components.find((c) => c.customId === Id.ANTI_BOT);
  assert.equal(bot.style, "secondary");
  const whitelist = view.components.find((c) => c.customId === Id.WHITELIST_OPEN);
  assert.ok(whitelist.label.includes("(2)"));
});
