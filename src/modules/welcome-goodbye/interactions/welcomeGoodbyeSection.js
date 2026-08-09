"use strict";

const { WelcomeGoodbyeComponentId } = require("../configuration/welcomeGoodbyeConstants");
const { Key } = require("../translations/translationKeys");

function createWelcomeGoodbyeSettingsSection(t) {
  return {
    type: "button",
    customId: WelcomeGoodbyeComponentId.SECTION,
    label: t(Key.SECTION),
    style: "secondary",
  };
}

module.exports = { createWelcomeGoodbyeSettingsSection };
