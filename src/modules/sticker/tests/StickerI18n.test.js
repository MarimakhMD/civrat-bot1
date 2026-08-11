"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateTranslationParity, I18nService } = require("../../../core/i18n");
const en = require("../translations/en.json");
const fr = require("../translations/fr.json");

test("sticker translations parity", () => {
  assert.equal(validateTranslationParity({ en, fr }), true);
});

test("sticker translations interpolate", () => {
  const i18n = new I18nService({ dictionaries: { en, fr } });
  assert.equal(i18n.translate("en", "sticker.uploadSuccess", { name: "test" }), "Sticker uploaded: test");
  assert.equal(i18n.translate("fr", "sticker.limitReached", { count: 5, limit: 5 }), "Limite Free atteinte (5/5).");
});
