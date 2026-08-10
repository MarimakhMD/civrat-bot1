"use strict";

const { getAutoModRuntime } = require("../modules/automod/runtime/getAutoModRuntime");

module.exports = {
  name: "messageCreate",
  once: false,
  async execute(message) {
    try {
      if (!message || !message.guild || (message.author && message.author.bot)) return;
      await getAutoModRuntime().handleMessage(message);
    } catch {
      /* AutoMod failures must never break message processing */
    }
  },
};
