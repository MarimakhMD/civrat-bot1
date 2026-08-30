"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EntitlementDecision,
  EntitlementFeature,
  EntitlementService,
  premiumRequiredView,
} = require("../../src/core/entitlements");
const { dictionaries, I18nService } = require("../../src/core/i18n");

const GUILD_ID = "111111111111111111";

function service(findFeature) {
  return new EntitlementService({
    repository: { findFeature },
    now: () => new Date("2030-01-01T00:00:00.000Z"),
  });
}

test("requireFeature returns ENTITLEMENT_GRANTED for an active entitlement", async () => {
  const result = await service(async () => ({ status: "active", ends_at: "2031-01-01T00:00:00.000Z" }))
    .requireFeature({ guildId: GUILD_ID, feature: EntitlementFeature.TICKET_PREMIUM });
  assert.deepEqual(result, { ok: true, granted: true, code: EntitlementDecision.GRANTED });
});

test("requireFeature returns PREMIUM_REQUIRED for missing, inactive, or expired access", async () => {
  for (const record of [
    null,
    { status: "inactive", ends_at: null },
    { status: "active", ends_at: "2029-01-01T00:00:00.000Z" },
  ]) {
    const result = await service(async () => record)
      .requireFeature({ guildId: GUILD_ID, feature: EntitlementFeature.TICKET_PREMIUM });
    assert.deepEqual(result, { ok: true, granted: false, code: EntitlementDecision.PREMIUM_REQUIRED });
  }
});

test("requireFeature returns ENTITLEMENT_UNAVAILABLE when the repository cannot answer", async () => {
  const missingRepository = await new EntitlementService({ repository: null })
    .requireFeature({ guildId: GUILD_ID, feature: EntitlementFeature.WELCOME_IMAGE });
  assert.deepEqual(missingRepository, { ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE });

  const failedRepository = await service(async () => { throw new Error("offline"); })
    .requireFeature({ guildId: GUILD_ID, feature: EntitlementFeature.WELCOME_IMAGE });
  assert.deepEqual(failedRepository, { ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE });
});

test("central Premium views include support and ticket guidance in English and French", () => {
  const i18n = new I18nService({ dictionaries });
  for (const locale of ["en", "fr"]) {
    const t = i18n.forLocale(locale);
    for (const decision of [EntitlementDecision.PREMIUM_REQUIRED, EntitlementDecision.UNAVAILABLE]) {
      const view = premiumRequiredView(t, {
        decision,
        components: [{ type: "button", customId: "back", label: "Back", style: "secondary" }],
      });
      assert.match(view.content, /https:\/\/discord\.gg\/BA3aDFqtXr/);
      assert.match(view.content.toLowerCase(), /ticket/);
      assert.equal(view.components[0].customId, "back");
    }
  }
});
