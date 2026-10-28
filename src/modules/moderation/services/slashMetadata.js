"use strict";
const fr = require("../translations/fr.json").moderation;
const en = require("../translations/en.json").moderation;
function descriptions(key) {
  return { fr: fr[key], "en-US": en[key], "en-GB": en[key] };
}
function withModerationMetadata(definition) {
  const key = `slash_${definition.name}`;
  return {
    ...definition,
    description: en[key],
    descriptionLocalizations: descriptions(key),
    options: (definition.options || []).map(option => {
      const optionKey = `slash_option_${option.name}`;
      return { ...option, description: en[optionKey], descriptionLocalizations: descriptions(optionKey) };
    }),
  };
}
module.exports = { withModerationMetadata };
