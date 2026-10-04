const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { getAutoModRuntime } = require("../modules/automod/runtime/getAutoModRuntime");
const logger = require("../utils/logger");
module.exports = {
  name: "messageUpdate",
  once: false,
  async execute(oldMessage, newMessage) {
    // PHASE 3.1 (P1) — AutoMod sur les éditions : un membre ne doit pas pouvoir
    // contourner les règles en envoyant un message propre puis en le modifiant.
    // Isolé : un échec AutoMod ne doit jamais casser la suite (logs).
    try {
      if (newMessage && newMessage.guild && !(newMessage.author && newMessage.author.bot)) {
        await getAutoModRuntime().handleMessageEdited(oldMessage, newMessage);
      }
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé, l'échec est désormais visible.
      logger.warn("AutoMod edit processing failed", {
        event: "automod_edit_failed",
        guildId: newMessage?.guild?.id || null,
        error: error?.message || String(error),
      });
    }
    try {
      if (!newMessage.guild || newMessage.author?.bot) return;
      // Ne comparer le contenu que lorsque les deux messages sont complets
      // (non partiels) : pour un message partiel, `content` vaut null des deux
      // côtés et masquerait une édition réelle.
      if (!newMessage.partial && !oldMessage.partial && oldMessage.content === newMessage.content) return;
      // P1a — transmettre l'ancien message pour renseigner Avant/Après sans
      // aucun appel supplémentaire (les deux sont déjà disponibles ici).
      await getLogsRuntime().handleMessageUpdated(newMessage, oldMessage);
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("messageUpdate handling failed", { event: "message_update_failed", guildId: newMessage?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
