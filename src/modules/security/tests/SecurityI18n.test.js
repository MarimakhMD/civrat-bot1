"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateTranslationParity, I18nService } = require("../../../core/i18n");
const secEn = require("../translations/en.json");
const secFr = require("../translations/fr.json");
const logsEn = require("../../logs/translations/en.json");
const logsFr = require("../../logs/translations/fr.json");

test("Security translations have FR/EN parity", () => {
  assert.equal(validateTranslationParity({ en: secEn, fr: secFr }), true);
});

test("Security log translations interpolate", () => {
  const i18n = new I18nService({ dictionaries: { en: secEn, fr: secFr } });
  const en = i18n.forLocale("en");
  const fr = i18n.forLocale("fr");
  assert.equal(en("security.log.raidTitle"), "Security: Raid detected");
  assert.equal(fr("security.log.raidTitle"), "Sécurité : Raid détecté");
  assert.equal(en("security.log.raidDescription", { count: 5, window: 15, threshold: 5 }), "Raid detected: 5 joins in 15s (threshold 5)");
  assert.equal(fr("security.log.botDescription", { user: "<@123>" }), "Bot non autorisé <@123> absent de la whitelist");
  assert.equal(en("security.log.nukeDescription", { action: "channelCreate", count: 10, threshold: 10, window: 15 }), "Nuke detected: channelCreate 10/10 in 15s");
});

test("Logs security translations parity", () => {
  assert.equal(validateTranslationParity({ en: logsEn, fr: logsFr }), true);
  const i18n = new I18nService({ dictionaries: { en: logsEn, fr: logsFr } });
  assert.equal(i18n.translate("en", "logs.security_raid"), "Security: Raid");
  assert.equal(i18n.translate("fr", "logs.security_bot"), "Sécurité : Bot");
});

test("Global runtime parity still holds with Security", () => {
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
  const logsEn2 = require("../../logs/translations/en.json");
  const logsFr2 = require("../../logs/translations/fr.json");
  const autoModEn = require("../../automod/translations/en.json");
  const autoModFr = require("../../automod/translations/fr.json");
  const dictionaries = {
    en: { ...en, ...guildSettingsEn, ...welcomeEn, ...autoRoleEn, ...logsEn2, ...captchaEn, ...ticketEn, ...moderationEn, ...autoModEn, ...secEn },
    fr: { ...fr, ...guildSettingsFr, ...welcomeFr, ...autoRoleFr, ...logsFr2, ...captchaFr, ...ticketFr, ...moderationFr, ...autoModFr, ...secFr },
  };
  assert.equal(validateTranslationParity(dictionaries), true);
});
