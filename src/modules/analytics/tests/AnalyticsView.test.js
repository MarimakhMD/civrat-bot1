"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyticsView, analyticsSettingsView } = require("../interactions/analyticsViews");

test("analytics view renders overview with stats and top lists", () => {
  const t = (k, vars) => `${k} ${JSON.stringify(vars || {})}`;
  const view = analyticsView({
    t,
    stats: { messages: 10, members: 5 },
    topXP: [{ userId: "u1", xp: 100 }],
    topInvites: [{ userId: "u2", current: 3 }],
  });
  assert.ok(view.title.includes("analytics.title"));
  assert.ok(view.content.includes("10"));
  assert.ok(view.content.includes("u1"));
});

test("analytics settings view reflects enabled state", () => {
  const t = (k) => k;
  const view = analyticsSettingsView({ t, config: { analytics_enabled: true } });
  assert.equal(view.content, "analytics.enabled");
  const view2 = analyticsSettingsView({ t, config: { analytics_enabled: false } });
  assert.equal(view2.content, "analytics.disabled");
});
