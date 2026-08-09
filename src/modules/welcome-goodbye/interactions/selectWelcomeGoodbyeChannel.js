"use strict";

const { ValidationError } = require("../../../core/errors");
const { WelcomeGoodbyeConfigKey: ConfigKey, WelcomeGoodbyeComponentId: ComponentId } = require("../configuration/welcomeGoodbyeConstants");
const { updateWelcomeSettings } = require("./updateWelcomeSettings");

const channelSettingByComponentId = Object.freeze({
  [ComponentId.WELCOME_CHANNEL]: ConfigKey.WELCOME_CHANNEL,
  [ComponentId.GOODBYE_CHANNEL]: ConfigKey.GOODBYE_CHANNEL,
});

async function selectWelcomeGoodbyeChannel(context) {
  const configKey = channelSettingByComponentId[context.envelope.customId];
  const channelId = context.envelope.values?.[0];

  if (!configKey || !channelId) {
    throw new ValidationError({ field: "channel", reason: "channel_selection_required" });
  }

  if (configKey === ConfigKey.WELCOME_CHANNEL) {
    return updateWelcomeSettings(context, { [configKey]: channelId });
  }

  return context.settings.update(context.guildId, { [configKey]: channelId });
}

function channelSelectView({ customId, placeholder }) {
  if (!channelSettingByComponentId[customId]) {
    throw new TypeError("Unsupported Welcome & Goodbye channel component.");
  }

  return Object.freeze({ type: "channel-select", customId, placeholder, channelTypes: [0] });
}

module.exports = { selectWelcomeGoodbyeChannel, channelSelectView, channelSettingByComponentId };
