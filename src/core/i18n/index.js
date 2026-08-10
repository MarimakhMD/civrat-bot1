"use strict";

const en = require("./locales/en.json");
const fr = require("./locales/fr.json");
const { validateTranslationParity } = require("./translationValidator");

const dictionaries = Object.freeze({ en, fr });
validateTranslationParity(dictionaries);

module.exports = {
  dictionaries,
  ...require("./I18nService"),
  ...require("./locale"),
  ...require("./translationValidator"),
};
