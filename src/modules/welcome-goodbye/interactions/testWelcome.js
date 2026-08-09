"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { ValidationError } = require("../../../core/errors");
async function testWelcome(context) {
  const config = await context.settings.get(context.guildId);
  if (!config[Key.WELCOME_ENABLED] || !config[Key.WELCOME_CHANNEL]) {
    throw new ValidationError({ field: "welcome", reason: "welcome_requires_enabled_channel" });
  }
  await context.envelope.transport.sendTestWelcome({
    channelId: config[Key.WELCOME_CHANNEL],
    content: config[Key.WELCOME_MESSAGE],
    embed: config[Key.WELCOME_EMBED]
      ? { color: config[Key.WELCOME_COLOR], description: config[Key.WELCOME_MESSAGE] }
      : null,
  });
  context.adminLogService?.record({ action: "welcome_test_sent", guildId: context.guildId, actorId: context.userId });
  await context.envelope.transport.reply({
    view: { content: context.t("welcomeGoodbye.testWelcomeSent"), components: [] },
    ephemeral: true,
  });
}
module.exports = { testWelcome };
