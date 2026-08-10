"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { I18nService, validateTranslationParity } = require("../../../core/i18n");
const autoModEn = require("../translations/en.json");
const autoModFr = require("../translations/fr.json");
const logsEn = require("../../logs/translations/en.json");
const logsFr = require("../../logs/translations/fr.json");

test("AutoMod translations have FR/EN parity and no fallback", () => {
  assert.equal(validateTranslationParity({ en: autoModEn, fr: autoModFr }), true);
});

test("AutoMod log translations interpolate correctly", () => {
  const i18n = new I18nService({ dictionaries: { en: autoModEn, fr: autoModFr } });
  const en = i18n.forLocale("en");
  const fr = i18n.forLocale("fr");
  assert.equal(en("automod.log.title"), "AutoMod");
  assert.equal(fr("automod.log.title"), "AutoMod");
  assert.equal(en("automod.log.description", { user: "<@123>", rule: "AUTOMOD_LINK", reason: "AutoMod: AUTOMOD_LINK" }), "User <@123> triggered AUTOMOD_LINK (AutoMod: AUTOMOD_LINK)");
  assert.equal(fr("automod.log.description", { user: "<@123>", rule: "AUTOMOD_LINK", reason: "AutoMod: AUTOMOD_LINK" }), "L'utilisateur <@123> a déclenché AUTOMOD_LINK (AutoMod: AUTOMOD_LINK)");
  // module-owned, no cross-language fallback: missing key throws
  assert.throws(() => i18n.translate("en", "automod.missingKey"), /Missing translation/);
});

test("Logs automod translation exists and parity holds", () => {
  assert.equal(validateTranslationParity({ en: logsEn, fr: logsFr }), true);
  const i18n = new I18nService({ dictionaries: { en: logsEn, fr: logsFr } });
  assert.equal(i18n.translate("en", "logs.automod"), "AutoMod");
  assert.equal(i18n.translate("fr", "logs.automod"), "AutoMod");
});

test("Global runtime dictionary parity still holds after AutoMod log keys", () => {
  const en = require("../../../core/i18n/locales/en.json");
  const fr = require("../../../core/i18n/locales/fr.json");
  const guildSettingsEn = require("../../guild-settings/translations/en.json");
  const guildSettingsFr = require("../../guild-settings/translations/fr.json");
  const welcomeEn = require("../../welcome-goodbye/translations/en.json");
  const welcomeFr = require("../../welcome-goodbye/translations/fr.json");
  const autoRoleEn = require("../../autorole/translations/en.json");
  const autoRoleFr = require("../../autorole/translations/fr.json");
  const captchaEn = require("../../captcha/translations/en.json");
  const captchaFr = require("../../captcha/translations/fr.json");
  const ticketEn = require("../../tickets/translations/en.json");
  const ticketFr = require("../../tickets/translations/fr.json");
  const moderationEn = require("../../moderation/translations/en.json");
  const moderationFr = require("../../moderation/translations/fr.json");
  const dictionaries = {
    en: { ...en, ...guildSettingsEn, ...welcomeEn, ...autoRoleEn, ...logsEn, ...captchaEn, ...ticketEn, ...moderationEn, ...autoModEn },
    fr: { ...fr, ...guildSettingsFr, ...welcomeFr, ...autoRoleFr, ...logsFr, ...captchaFr, ...ticketFr, ...moderationFr, ...autoModFr },
  };
  assert.equal(validateTranslationParity(dictionaries), true);
});
