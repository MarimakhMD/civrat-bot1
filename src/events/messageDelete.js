const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const logger = require("../utils/logger");
module.exports = {
  name: "messageDelete",
  once: false,
  async execute(message) {
    try {
      if (!message.guild || message.author?.bot) return;
      await getLogsRuntime().handleMessageDeleted(message);
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("messageDelete handling failed", { event: "message_delete_failed", guildId: message?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
