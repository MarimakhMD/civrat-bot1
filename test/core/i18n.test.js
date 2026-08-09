"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { dictionaries, I18nService, TranslationMissingError, validateTranslationParity } = require("../../src/core/i18n");

test("i18n resolves each supported locale without cross-language fallback", () => {
  const i18n = new I18nService({ dictionaries });
  assert.equal(i18n.translate("fr", "errors.authorizationDenied"), "Vous n’avez pas la permission d’effectuer cette action.");
  assert.equal(i18n.translate("en", "errors.authorizationDenied"), "You do not have permission to perform this action.");
  assert.equal(i18n.translate("unknown", "errors.routeNotFound"), "Cette action n’est plus disponible.");
});

test("i18n interpolates variables and rejects missing keys", () => {
  const i18n = new I18nService({ dictionaries: { en: { greeting: "Hello, {{user}}." }, fr: { greeting: "Bonjour, {{user}}." } } });
  assert.equal(i18n.translate("en", "greeting", { user: "CIVRAT" }), "Hello, CIVRAT.");
  assert.throws(() => i18n.translate("fr", "missing"), TranslationMissingError);
});

test("translation parity rejects missing keys and mismatched variables", () => {
  assert.equal(validateTranslationParity(dictionaries), true);
  assert.throws(() => validateTranslationParity({ en: { x: "{{name}}" }, fr: { x: "{{user}}" } }), /variable parity/);
  assert.throws(() => validateTranslationParity({ en: { x: "ok" }, fr: {} }), /key parity/);
});
